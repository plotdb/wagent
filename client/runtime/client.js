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
  headers: null,
  // 一輪 (一次發話) 之內最多幾次模型呼叫。tool_use 會讓 agent 自己接下去,
  // 沒有上限的話「改檔 → 重畫 → 看畫面 → 再改」可以跑到天亮 —— 而 proxy 的
  // rate limit 數的是請求數, 每分鐘 60 次完全允許這件事。
  //   softSteps 到了會提醒模型收尾 (它還有 maxSteps - softSteps 步可以交代),
  //   maxSteps  到了由執行環境直接停止, 不再呼叫模型。
  // 預設是估的 —— 要調到對, 看 proxy 記下來的實際用量。
  maxSteps: 30,
  softSteps: 20,
  // 對話歷史裡最多留幾張圖。歷史是 append-only (改舊訊息會打掉 prompt cache, 也會讓
  // Claude 的 thinking 作廢), 所以圖不再逐張換佔位; 超過這個數時才一次重建、只留最新一張。
  // 不給就是 runtime 的預設 (20), 見 turn-context.js 的〈圖的上限〉。
  maxImages: 0,
  // 'zh' / 'en': 執行環境給模型看的說明 ( 每輪的 context、步數上限、中斷說明、壓縮摘要的開頭 ) 用哪個語言,
  // 也是 chat block 介面的預設語言 ( rt.lang )。不給就跟著掛載點 ( wagent({lang}) ) —— 多數情況不必設。
  // system prompt 永遠是掛載點的語言 ( 後端決定 ), 這裡改不動它
  lang: null
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
    (o.agentRoot ? `&agentRoot=${encodeURIComponent(o.agentRoot)}` : '') +
    (o.maxSteps ? `&maxSteps=${encodeURIComponent(o.maxSteps)}` : '') +
    (o.softSteps ? `&softSteps=${encodeURIComponent(o.softSteps)}` : '') +
    (o.maxImages ? `&maxImages=${encodeURIComponent(o.maxImages)}` : '') +
    (o.lang ? `&lang=${encodeURIComponent(o.lang)}` : '');
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
    // 逾時 (ms): tool 自己的 {timeout} > 這裡的 timeout ( snapshot 與其他沒設的 ) > 20 秒。
    // timeout 不會送給 LLM, worker 建 tool 定義時只取 name / description / parameters
    worker.postMessage({type: 'host-tools', tools: host.tools, timeout: o.timeout || 0});
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

  // 模型切換。worker 持有目前的選擇 (每輪開始時套用), 這裡只是請求與通知。
  const modelPending = {};
  const modelListeners = [];
  function modelCall(msg) {
    const id = prefix + 'm' + (++seq);
    return new Promise(function(resolve, reject) {
      modelPending[id] = {resolve: resolve, reject: reject};
      worker.postMessage(Object.assign({id: id}, msg));
    });
  }
  function onModelChange(fn) {
    if(typeof fn !== 'function') { return function() {}; }
    modelListeners.push(fn);
    return function() {
      const i = modelListeners.indexOf(fn);
      if(i >= 0) { modelListeners.splice(i, 1); }
    };
  }

  // 對話的保存 ( 見 agent-worker.js 的〈對話的保存與壓縮〉 ): 請求與回覆以 rid 配對
  const sessionPending = {};
  function sessionCall(msg) {
    const rid = prefix + 's' + (++seq);
    return new Promise(function(resolve) {
      sessionPending[rid] = resolve;
      worker.postMessage(Object.assign({rid: rid}, msg));
    });
  }
  const sessions = {
    // 這個 session 目前的對話 ( 送給模型的那份: {v, provider, model, format, history} ), 沒有回 null.
    // host 每輪結束後拿去存 ( 例如存到伺服器 ). opt.images: 副本只留最新幾張圖 ( 存檔小一點 )
    export: function(key, opt) {
      return sessionCall({type: 'session-export', key: key, opt: opt || null}).then(function(m) { return m.data || null; });
    },
    // 換成之前存的對話 ( 下一輪開始時套用; provider 不同會轉換格式 )
    import: function(key, data) { return sessionCall({type: 'session-import', key: key, data: data}).then(function() {}); }
  };
  // 壓縮條件 {at ( token 門檻 ), keep ( 保留幾輪 ), provider, model ( 摘要用 )}; null 關閉 ( 見 compact.js )
  function setCompact(c) { worker.postMessage({type: 'compact-set', opt: c || null}); }
  if(o.compact) { setCompact(o.compact); }

  // worker 的 postMessage 是廣播: 一律以 id 過濾出自己的訊息
  worker.addEventListener('message', function(ev) {
    const msg = ev.data || {};
    if((msg.type === 'session-data' || msg.type === 'session-imported') && sessionPending[msg.rid]) {
      const fn = sessionPending[msg.rid];
      delete sessionPending[msg.rid];
      return fn(msg);
    }
    if(msg.type === 'model-change') {
      const info = {provider: msg.provider || null, model: msg.model || null};
      modelListeners.forEach(function(fn) {
        try { fn(info); } catch(e) { console.error('model-change listener failed', e); }
      });
      return;
    }
    if(msg.type === 'model-result') {
      const mp = modelPending[msg.id];
      if(!mp) { return; }
      delete modelPending[msg.id];
      return msg.ok ? mp.resolve(msg) : mp.reject(new Error(msg.error));
    }
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
    // LLM 呼叫的進度 ( 欄位見 runtime/progress.js )
    if(msg.type === 'chat-progress') { return p.onProgress && p.onProgress(msg.progress); }
    // 這一輪開始前把對話壓縮了 ( 或壓縮失敗: msg.error )
    if(msg.type === 'chat-compacted') { return p.onCompact && p.onCompact({error: msg.error || null}); }
    if(msg.type === 'chat-done') {
      delete pending[msg.id];
      return p.resolve({reply: msg.reply, events: msg.events});
    }
    if(msg.type === 'chat-error') {
      delete pending[msg.id];
      const e = new Error(msg.error);
      // worker 送來的 lderror 資訊 ( 見 agent-worker.js ): 重建成 lderror 的形狀
      if(msg.errorId) { e.id = msg.errorId; e.name = 'lderror'; }
      if(msg.errorPayload) { e.payload = msg.errorPayload; }
      return p.reject(e);
    }
  });

  const transport = {
    send: function(text, cb) {
      cb = cb || {};
      const id = prefix + (++seq);
      return new Promise(function(resolve, reject) {
        pending[id] = {
          resolve: resolve, reject: reject,
          onDelta: cb.onDelta, onTool: cb.onTool, onNudge: cb.onNudge, onProgress: cb.onProgress, onCompact: cb.onCompact
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

  // 沒指定語言就問掛載點 ( /provider 會回報 lang )。問不到 ( 舊版後端、header 不對 ) 不擋, 就是 zh
  const langReady = o.lang ? Promise.resolve(o.lang) : fetch(`${o.api}/provider`, {headers: o.headers || {}})
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(j) { return (j && j.lang) || 'zh'; })
    .catch(function() { return 'zh'; });

  return Promise.all([import(o.eshRemote).then(function(remote) { return remote.connectShell(worker); }), langReady])
    .then(function(r) {
      const sh = r[0];
      const lang = r[1];
      // chat block 沒給 data.lang 時從 transport 拿 ( 見 block/chat/base.html )
      transport.lang = lang;
      function abs(p) {
        return (p || '').charAt(0) === '/' ? p : `${o.root}/${p}`;
      }
      // 泛用的檔案讀寫。**不提供「列出 block」** — 那需要知道 block 放在哪個目錄、
      // 檔名叫什麼, 而目錄形狀是應用層的約定 (單一 block 的應用根本沒有 blocks/)。
      // 應用要列清單就用 sh.run + io.loadText 自己組 (見 sample/dataviz/blocks.js)。
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
        worker: worker, sh: sh, io: io, transport: transport, sessions: sessions, setCompact: setCompact,
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
        // 對話中換模型 (見 README「模型切換」)。下一輪生效, 對話不清。
        //   listModels({refresh}) -> {current, default, providers: {<name>: {model, models}}}
        //   getModel()            -> {provider, model} 目前會用的
        //   setModel({provider, model}) -> {provider, model}; 只給 model 會自己找 provider,
        //                            只給 provider 用它的預設 model, null 回到後端預設。
        //                            不在後端白名單內就 reject
        //   onModelChange(fn)     -> 取消函式; fn({provider, model})
        listModels: function(opt) {
          return modelCall({type: 'model-list', refresh: !!(opt && opt.refresh)}).then(function(r) {
            return {current: r.current, default: r.default, providers: r.providers};
          });
        },
        getModel: function() {
          return modelCall({type: 'model-list'}).then(function(r) { return r.current; });
        },
        setModel: function(m) {
          return modelCall({type: 'model-set', model: m || null}).then(function(r) { return r.current; });
        },
        onModelChange: onModelChange,
        lang: lang,
        root: o.root, workerUrl: url
      };
    });
}
