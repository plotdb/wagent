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
  const url = `${o.worker}?api=${encodeURIComponent(o.api)}&esh=${encodeURIComponent(o.esh)}`;
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

  // worker 的 postMessage 是廣播: 一律以 id 過濾出自己的訊息
  worker.addEventListener('message', function(ev) {
    const msg = ev.data || {};
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
      const io = {
        loadText: function(p) { return sh.io.readFile(abs(p)); },
        loadJSON: function(p) { return sh.io.readFile(abs(p)).then(JSON.parse); },
        writeText: function(p, c) { return sh.io.writeFile(abs(p), c); },
        // block 清單: 目錄名 + 從原始碼取 description
        listBlocks: function() {
          return sh.run(`ls ${o.root}/blocks`).then(function(r) {
            const names = (r.stdout || '').split('\n')
              .map(function(s) { return s.trim(); })
              .filter(Boolean);
            return Promise.all(names.map(function(n) {
              return sh.io.readFile(`${o.root}/blocks/${n}/index.html`)
                .then(function(src) {
                  const m = src.match(/description:\s*(['"])((?:\\.|(?!\1).)*)\1/);
                  return {name: n, description: m ? m[2] : ''};
                })
                .catch(function() { return null; });
            })).then(function(list) { return list.filter(Boolean); });
          });
        }
      };
      return {
        worker: worker, sh: sh, io: io, transport: transport,
        registerHost: registerHost, root: o.root, workerUrl: url
      };
    });
}
