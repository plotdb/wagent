// 主執行緒 client: 建 agent worker, 以 esh connectShell 取得 shell/io,
// 並把 chat 協定包成 chat block 用的 transport。
const DEFAULTS = {
  api: '/api/agent',
  worker: '/assets/lib/@plotdb/wagent/main/runtime/agent-worker.js',
  esh: '/assets/lib/@plotdb/esh/main/esh.js',
  eshRemote: '/assets/lib/@plotdb/esh/main/src/remote.js',
  // workspace 的位置。同一個 origin 上要並存好幾個互不干擾的 workspace 就換掉它 ——
  // 但注意這只換虛擬路徑, /home 背後仍是同一份 OPFS (要換儲存本身見 mounts)。
  root: '/home/workspace',
  // 打到 api 的請求要附的額外 header。嵌進既有站台時常常是必要的 ——
  // 例如 CSRF token 或 bearer: 那些站台的 api 前面就擋著這類檢查, 而 llm proxy
  // 是 POST, 逃不掉。預設空的, 純 wagent 的 sample 不需要。
  headers: null
};

export function createRuntime(opt) {
  const o = Object.assign({}, DEFAULTS, opt || {});
  // devices: 要以檔案形式提供給 agent 的應用層資料 (名單在建 shell 前就要定, readdir 由它決定)
  const devices = (o.devices || []).join(',');
  // mounts: fs 組態 — host 契約的第一塊, 由應用層決定資料存哪 (預設 /home -> OPFS)。
  //   {'/home': {backend: 'opfs'}}        瀏覽器持久化 (預設)
  //   {'/home': {backend: 'indexeddb'}}   OPFS 不可用時的替代
  //   {'/home': {backend: 'memory'}}      不落地 (測試 / 一次性)
  // 限制: 必須是**可 JSON 序列化的設定**。worker 是另一個 realm, 傳不了 backend class,
  // 所以要用 zenfs 的自訂 backend 物件得改在 worker 端註冊, 不能從這裡塞。
  // device mount 由 worker 自己併入 (它必須落在 agent root 之內, 順序不能反)。
  const mounts = o.mounts ? JSON.stringify(o.mounts) : '';
  const headers = o.headers ? JSON.stringify(o.headers) : '';
  // root 一定要傳過去。先前只有 client 這端用它做 abs(), worker 那邊還是常數 —
  // 設了 root 的話 io 讀寫一個路徑、agent 與 device 在另一個路徑, 而且不會報錯。
  // (參數名跟 agentRoot 分開: 一個是「東西放哪」, 一個是「agent 看得到哪一段」。)
  // worker 可能已經帶了 query ( 對資產加版本的站台就會 —— 沒有 cachestamp 的話
  // 改了 wagent 卻載到舊的, 而且完全沒有跡象 )。硬接 '?' 會拼出兩個問號, 整串
  // query 就廢了: api 讀不到而退回預設、headers 讀不到而少帶 CSRF —— 兩者都不會
  // 報錯, 只會在別的地方以別的面貌出現。
  const q = o.worker.indexOf('?') >= 0 ? '&' : '?';
  const url = `${o.worker}${q}api=${encodeURIComponent(o.api)}&esh=${encodeURIComponent(o.esh)}` +
    `&workspace=${encodeURIComponent(o.root)}` +
    (devices ? `&devices=${encodeURIComponent(devices)}` : '') +
    (mounts ? `&mounts=${encodeURIComponent(mounts)}` : '') +
    (headers ? `&headers=${encodeURIComponent(headers)}` : '') +
    (o.agentRoot ? `&agentRoot=${encodeURIComponent(o.agentRoot)}` : '');
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
  const host = {tools: [], run: null, snapshot: null, brief: null, context: null};

  // snapshot 的結果轉成 tool 回覆。形狀由契約定義 (report 必回, image 選用),
  // 所以放這裡 —— 先前每個應用都要自己 JSON.stringify 一次, 那是重複的樣板。
  function snapshotResult(r) {
    if(!r) { return 'snapshot returned nothing'; }
    const text = JSON.stringify(r.report, null, 1);
    return r.image ? {text: text, image: r.image} : text;
  }

  function registerHost(o) {
    o = o || {};
    host.tools = o.tools || [];
    host.run = o.run || null;
    // snapshot 是契約裡**唯一必要**的那塊 — 直接把 sandbox 的 snapshot 傳進來即可。
    host.snapshot = typeof o.snapshot === 'function' ? o.snapshot : null;
    // 沒接的話在**註冊當下**就喊, 而不是等 agent 呼叫時才回一個 tool 錯誤。
    // 讓 agent 去發現「我看不到自己畫的東西」是這個專案最貴的那種失敗。
    if(!host.snapshot && !host.run) {
      console.warn('[wagent] registerHost 沒有給 snapshot(也沒有 run)— ' +
        'agent 將無法檢查自己畫出來的東西。snapshot 是 host 契約的必要項: ' +
        'registerHost({snapshot: sb.snapshot, ...})');
    }
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
      let fn = null;
      if(msg.kind === 'context') {
        fn = host.context && function() { return host.context(); };
      } else if(msg.name === 'snapshot' && host.snapshot) {
        fn = function() {
          return Promise.resolve(host.snapshot(msg.args || {})).then(snapshotResult);
        };
      } else if(host.run) {
        fn = function() { return host.run(msg.name, msg.args || {}); };
      }
      if(!fn) { return done(false, `host ${msg.kind || 'tool'} not available: ${msg.name}`); }
      try {
        Promise.resolve(fn()).then(function(r) { done(true, r); }, function(e) { done(false, e); });
      } catch(e) { done(false, e); }
      return;
    }
    const p = msg.id && pending[msg.id];
    if(!p) { return; }
    if(msg.type === 'chat-delta') { return p.onDelta && p.onDelta(msg.text); }
    if(msg.type === 'chat-nudge-taken') { return p.onNudge && p.onNudge(msg.texts || []); }
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
        pending[id] = {
          resolve: resolve, reject: reject,
          onDelta: cb.onDelta, onTool: cb.onTool, onNudge: cb.onNudge
        };
        worker.postMessage({
          type: 'chat', id: id, text: text,
          block: cb.block || null, session: cb.session || null
        });
      });
    },
    // 執行中插話: 不開新的一輪, 排進 queue 讓正在跑的那一輪帶走。
    // 「現在是不是在跑」由應用層判斷 — 沒在跑的時候該用 send。
    nudge: function(text) {
      worker.postMessage({type: 'chat-nudge', text: text});
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
        writeText: function(p, c) { return sh.io.writeFile(abs(p), c); },
        // esh 0.5.0: 目錄列舉。回的是純 JSON 形狀 (名字, 或 {name, isDirectory}),
        // 不是 Dirent —— 因為要跨 worker 的 postMessage。
        readdir: function(p, opt) { return sh.io.readdir(abs(p), opt); },
        stat: function(p) { return sh.io.stat(abs(p)); }
      };
      return {
        worker: worker, sh: sh, io: io, transport: transport,
        registerHost: registerHost, onFsChange: onFsChange,
        // 更新 device 檔案的內容。應用層是真相, 這裡只是把值推給 worker 的鏡像。
        setDevice: function(name, value) {
          worker.postMessage({type: 'device-set', name: name, value: value});
        },
        // 換掉打到 api 的 header。token 會過期 (session 重生、CSRF 換一輪),
        // 所以不能只在建 runtime 時給一次。
        setHeaders: function(h) {
          worker.postMessage({type: 'headers-set', headers: h || {}});
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
