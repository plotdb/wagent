// 主執行緒 client: 建 agent worker, 以 esh connectShell 取得 shell/io,
// 並把 chat 協定包成 chat block 用的 transport。
const DEFAULTS = {
  api: '/api/agent',
  worker: '/assets/lib/@plotdb/wagent/main/runtime/agent-worker.js',
  esh: '/assets/lib/@plotdb/esh/main/esh.js',
  eshRemote: '/assets/lib/@plotdb/esh/main/src/remote.js',
  root: '/home/workspace'
};

export function createRuntime(opt) {
  const o = Object.assign({}, DEFAULTS, opt || {});
  // devices: 要以檔案形式提供給 agent 的應用層資料 (名單在建 shell 前就要定, readdir 由它決定)
  const devices = (o.devices || []).join(',');
  const url = `${o.worker}?api=${encodeURIComponent(o.api)}&esh=${encodeURIComponent(o.esh)}` +
    (devices ? `&devices=${encodeURIComponent(devices)}` : '') +
    (o.agentRoot ? `&root=${encodeURIComponent(o.agentRoot)}` : '');
  const worker = new Worker(url, {type: 'module'});
  const prefix = `c${Math.random().toString(36).slice(2, 8)}-`;
  let seq = 0;
  const pending = {};

  // host / 應用層對 agent 開的窗口 (見 context/project/host.md):
  //  - tools / run — 能做什麼 (非檔案系統的 tool; snapshot 一定要有)
  //  - brief       — 這是什麼應用、慣例是什麼 (靜態, 併進 system prompt)
  //  - context     — 現在是什麼狀況 (動態, 每輪取一次, 附在對話尾端)
  //
  // 少了 brief / context, agent 就只看得到檔案與畫面 — 應用自己的文件狀態
  // (composer 的 node tree、makechart 的 raw/bind) 對它是全盲的, 而它會用猜的。
  const host = {tools: [], run: null, brief: null, context: null};

  function registerHost(o) {
    o = o || {};
    host.tools = o.tools || [];
    host.run = o.run || null;
    host.brief = typeof o.brief === 'function' ? o.brief : (o.brief ? function() { return o.brief; } : null);
    host.context = typeof o.context === 'function' ? o.context : null;
    worker.postMessage({type: 'host-tools', tools: host.tools});
    Promise.resolve()
      .then(function() { return host.brief ? host.brief() : null; })
      .catch(function() { return null; })
      .then(function(brief) {
        worker.postMessage({
          type: 'host-info',
          brief: brief == null ? null : String(brief),
          hasContext: !!host.context
        });
      });
  }

  // fs 變更通知。worker 只說「動過什麼」, 由應用層決定要不要重畫 —
  // 它才知道現在畫的是哪個東西。paths 為 null 表示「可能變了但不知道哪些」
  // (shell 執行後, esh 無 watch)。
  const fsListeners = [];
  function onFsChange(fn) {
    if(typeof fn !== 'function') { return function() {}; }
    fsListeners.push(fn);
    return function() {
      const i = fsListeners.indexOf(fn);
      if(i >= 0) { fsListeners.splice(i, 1); }
    };
  }

  // worker 的 postMessage 是廣播: 一律以 id 過濾出自己的訊息
  worker.addEventListener('message', function(ev) {
    const msg = ev.data || {};
    if(msg.type === 'fs-change') {
      const info = {paths: msg.paths || null};
      fsListeners.forEach(function(fn) {
        try { fn(info); } catch(e) { console.error('fs-change listener failed', e); }
      });
      return;
    }
    if(msg.type === 'host-call') {
      // 一律回覆 (含失敗), 否則 worker 端的 agent loop 會空等到 timeout
      const done = function(ok, payload) {
        worker.postMessage({
          type: 'host-result', id: msg.id, ok: ok,
          result: ok ? payload : undefined,
          error: ok ? undefined : String((payload && payload.message) || payload)
        });
      };
      const fn = msg.kind === 'context'
        ? (host.context && function() { return host.context(); })
        : (host.run && function() { return host.run(msg.name, msg.args || {}); });
      if(!fn) { return done(false, `host ${msg.kind || 'tool'} not available: ${msg.name}`); }
      try {
        Promise.resolve(fn()).then(function(r) { done(true, r); }, function(e) { done(false, e); });
      } catch(e) { done(false, e); }
      return;
    }
    const p = msg.id && pending[msg.id];
    if(!p) { return; }
    if(msg.type === 'chat-delta') { return p.onDelta && p.onDelta(msg.text); }
    if(msg.type === 'chat-tool') { return p.onTool && p.onTool(msg); }
    if(msg.type === 'chat-done') {
      delete pending[msg.id];
      return p.resolve({reply: msg.reply, events: msg.events});
    }
    if(msg.type === 'chat-error') {
      delete pending[msg.id];
      return p.reject(new Error(msg.error));
    }
  });

  const transport = {
    send: function(text, cb) {
      cb = cb || {};
      const id = prefix + (++seq);
      return new Promise(function(resolve, reject) {
        pending[id] = {resolve: resolve, reject: reject, onDelta: cb.onDelta, onTool: cb.onTool};
        worker.postMessage({
          type: 'chat', id: id, text: text,
          block: cb.block || null, session: cb.session || null
        });
      });
    },
    reset: function(session) {
      worker.postMessage({type: 'chat-reset', session: session || null});
    }
  };

  return import(o.eshRemote)
    .then(function(remote) { return remote.connectShell(worker); })
    .then(function(sh) {
      function abs(p) {
        return (p || '').charAt(0) === '/' ? p : `${o.root}/${p}`;
      }
      // 泛用的檔案讀寫。**不提供「列出 block」** — 那需要知道 block 放在哪個目錄、
      // 檔名叫什麼, 而目錄形狀是應用層的約定 (單一 block 的應用根本沒有 blocks/)。
      // 應用要列清單就用 sh.run + io.loadText 自己組 (見 packages/dataviz/web/blocks.js)。
      const io = {
        loadText: function(p) { return sh.io.readFile(abs(p)); },
        loadJSON: function(p) { return sh.io.readFile(abs(p)).then(JSON.parse); },
        writeText: function(p, c) { return sh.io.writeFile(abs(p), c); }
      };
      return {
        worker: worker, sh: sh, io: io, transport: transport,
        registerHost: registerHost, onFsChange: onFsChange,
        // 更新 device 檔案的內容。應用層是真相, 這裡只是把值推給 worker 的鏡像。
        setDevice: function(name, value) {
          worker.postMessage({type: 'device-set', name: name, value: value});
        },
        devices: o.devices || [],
        // agent 的可見範圍。應用層決定 — 它才知道編輯對象是什麼。
        // 注意縮到單一 block 目錄後 agent 就建不了新 block、也看不到 workspace 層的 device。
        setAgentRoot: function(path) {
          worker.postMessage({type: 'agent-root', root: path});
        },
        root: o.root, workerUrl: url
      };
    });
}
