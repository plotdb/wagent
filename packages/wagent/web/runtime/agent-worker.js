// browser agent runtime: shell (esh) + agent loop 同在這個 worker 內。
// tool 執行完全不出 worker; 後端只被用來轉發 LLM 請求 (llm proxy)。
//
// 對外協定:
//  - esh 的 serveShell: {type: 'exec' | 'fs' | 'hello'}  (供 connectShell / esh-term 使用)
//  - 本檔的 chat 層:   {type: 'chat', id, text, block, session}
//                      -> {type: 'chat-delta' | 'chat-tool' | 'chat-done' | 'chat-error', id, ...}
//                      {type: 'chat-reset', session}
//  - host 層:          {type: 'host-tools', tools}   主執行緒註冊額外 tool
//                      {type: 'host-call', id, name, args} -> {type: 'host-result', id, ok, ...}
//                      非檔案系統的操作 (snapshot 等) 在主執行緒執行, 由此轉呼叫
import {tools, makeRunTool, ROOT} from './tools.js';
import {createSession as createOpenAI} from './providers/openai.js';
import {createSession as createAnthropic} from './providers/anthropic.js';

const params = new URL(self.location.href).searchParams;
const api = params.get('api') || '/api/agent';
const eshUrl = params.get('esh') || '/assets/lib/@plotdb/esh/main/esh.js';

const SEED = {
  'data/sales.csv': [
    'month,revenue,orders',
    '2026-01,128000,340',
    '2026-02,115200,301',
    '2026-03,142900,388',
    '2026-04,156300,411',
    '2026-05,149800,395',
    '2026-06,171400,455',
    ''
  ].join('\n'),
  'blocks/sample-bar/index.html': `<div>
  <div class="wrap"><canvas></canvas></div>
  <style>
    .wrap { height: 400px; }
  </style>
  <script type="@plotdb/block">
    module.exports = {
      pkg: {
        name: 'sample-bar',
        version: 'main',
        description: '每月營收長條圖 (Chart.js), 讀取 data/sales.csv'
      },
      init: function(opt) {
        var canvas = opt.root.querySelector('canvas');
        return opt.data.loadText('data/sales.csv').then(function(text) {
          var rows = d3.csvParse(text);
          new Chart(canvas, {
            type: 'bar',
            data: {
              labels: rows.map(function(r) { return r.month; }),
              datasets: [{
                label: 'Revenue',
                data: rows.map(function(r) { return +r.revenue; }),
                backgroundColor: '#2b6cb0'
              }]
            },
            options: {responsive: true, maintainAspectRatio: false}
          });
        });
      }
    };
  <\/script>
</div>
`
};

const esh = await import(eshUrl);

// ── device 檔案 ───────────────────────────────────────────────────────
// 應用層的文件狀態 (試算表之類) 以檔案形式呈現, agent 就能用它已經會的
// grep / wc / head 去查, 不必為每種資料再開一個 tool。
//
// 值必須是**同步**可讀的 (shell 的 readFileSync 依 stat size 配 buffer),
// 但真值在主執行緒。所以這裡持有一份鏡像, 由主執行緒在變更時推過來。
//
// 鏡像是這個專案反覆出事的形狀, 所以刻意限制:
//  - 單向 (主執行緒是唯一真相, worker 只讀)
//  - 唯讀 device (沒有 write callback -> 寫入回 EROFS)。寫入走 tool,
//    避免「worker 寫了但主執行緒還不知道」這種雙向分岔
// device 名單必須在建 shell 前就知道 (readdir 由它決定), 所以走 URL 參數。
const deviceNames = (params.get('devices') || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
const deviceValues = {};
function deviceFiles() {
  const files = {};
  deviceNames.forEach(function(n) {
    deviceValues[n] = '';
    files[n] = {read: function() { return deviceValues[n]; }};   // 無 write = 唯讀
  });
  return files;
}

const mounts = {'/home': {backend: 'opfs'}};
if(deviceNames.length) { mounts[`${ROOT}/dev`] = {backend: 'device', files: deviceFiles()}; }

let persist = 'in-memory';
let sh;
try {
  sh = await esh.createShell({mounts: mounts});
  persist = 'opfs';
} catch(e) {
  sh = await esh.createShell();
  persist = `in-memory (OPFS 掛載失敗: ${e.message})`;
}

// 首次使用才 seed (持久化資料不可蓋)
for(const [p, content] of Object.entries(SEED)) {
  const full = `${ROOT}/${p}`;
  const r = await sh.run(`test -e ${full}`);
  if(r.code !== 0) { await sh.io.writeFile(full, content); }
}
await sh.run(`cd ${ROOT}`);

// ── fs 變更事件 ───────────────────────────────────────────────────────
// 包在 shell 物件上, 而不是包在 tool 層 — 因為 agent 的 tool 與使用者的終端機
// 用的是同一個 sh (serveShell 內部也是呼叫 sh.run / sh.io.writeFile),
// 一個發射點就同時蓋住兩邊。
//
// 這裡只回報「動過什麼」, 不決定誰該重畫 — 那是 application 的事:
// 只有它知道現在畫的是哪個東西、編輯範圍到哪。
const READONLY = /^(ls|cat|grep|find|pwd|echo|wc|head|tail|test|help|which|env|date|sort|uniq|cut|tr|diff|stat)$/;
function mutates(cmdline) {
  if(/>/.test(cmdline)) { return true; }
  return String(cmdline).split(/\||;|&&/).some(function(seg) {
    const t = seg.trim().split(/\s+/)[0] || '';
    return t && !READONLY.test(t);
  });
}
(function watchFs() {
  const run = sh.run.bind(sh);
  const write = sh.io.writeFile.bind(sh.io);
  sh.run = function(cmdline) {
    return run(cmdline).then(function(r) {
      // esh 沒有 watch, shell 執行完並不知道自己動了什麼 — 只能說「可能變了」。
      // 寧可多報: 漏報是畫面停在舊的 (現在的行為), 多報只是多畫一次。
      if(mutates(cmdline)) { post({type: 'fs-change', paths: null}); }
      return r;
    });
  };
  sh.io.writeFile = function(p, c) {
    return write(p, c).then(function(r) {
      post({type: 'fs-change', paths: [p]});
      return r;
    });
  };
})();

esh.serveShell(sh, self, {persist: persist, root: ROOT});

// ── chat 層 ───────────────────────────────────────────────────────────
const post = function(o) { self.postMessage(o); };
const sessions = {};
let info = null;   // {provider, model}
let current = null;  // 進行中 request 的 id, 供 tool 事件標記

// ── host 層: 非檔案系統的 tool 在主執行緒執行 ─────────────────────────
// tool 清單 = 固定的 shell / content ops / snapshot + host 註冊的額外項目。
// session 建立時取一次; 之後才註冊的 tool 只對新 session 生效。
let hostTools = [];
let hostBrief = null;      // 靜態: 這是什麼應用 (併進 system prompt)
let hasHostContext = false;
const hostPending = {};
let hostSeq = 0;
const HOST_TIMEOUT = 20000;
const CONTEXT_TIMEOUT = 3000;   // 每輪都要等, 不能讓應用層拖住整個對話
const CONTEXT_LIMIT = 2000;     // 對照 blockState: 大小由應用層決定, 必須設界

function hostCall(name, args, opt) {
  opt = opt || {};
  const id = `h${++hostSeq}`;
  return new Promise(function(resolve, reject) {
    const timer = setTimeout(function() {
      delete hostPending[id];
      reject(new Error(`${name} timed out (no response from host)`));
    }, opt.timeout || HOST_TIMEOUT);
    hostPending[id] = {resolve: resolve, reject: reject, timer: timer};
    post({type: 'host-call', id: id, kind: opt.kind || 'tool', name: name, args: args || {}});
  });
}

// 每輪取一次應用層的狀況描述。
// 失敗不能默默略過 — 那會讓 agent 以為「沒有狀況」而照舊往下做。
// 拿不到就明講拿不到, 這跟 snapshot 的處理是同一個原則。
function turnContext() {
  if(!hasHostContext) { return Promise.resolve(null); }
  return hostCall('context', {}, {kind: 'context', timeout: CONTEXT_TIMEOUT})
    .then(function(v) {
      if(v == null) { return null; }
      const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1);
      if(s.length <= CONTEXT_LIMIT) { return s; }
      return s.slice(0, CONTEXT_LIMIT) +
        `\n…[truncated at ${CONTEXT_LIMIT} of ${s.length} chars — the application should summarise this]`;
    })
    .catch(function(e) {
      return `(unavailable: ${String((e && e.message) || e)}) ` +
        'the application state could not be read this turn — do not assume it is unchanged or empty.';
    });
}

function getInfo() {
  if(info) { return Promise.resolve(info); }
  return fetch(`${api}/provider`).then(function(r) { return r.json(); }).then(function(j) {
    info = j;
    return j;
  });
}

function getSession(key, block) {
  if(sessions[key]) { return Promise.resolve(sessions[key]); }
  return Promise.all([
    getInfo(),
    fetch(`${api}/prompt?mode=browser&block=${encodeURIComponent(block || '')}`)
      .then(function(r) { return r.json(); })
  ]).then(function(r) {
    const inf = r[0];
    // brief 是靜態的, 放 system prompt (快取前綴); 每輪會變的走 turnContext 附在尾端
    const system = hostBrief ? `${r[1].system}\n\n${hostBrief}` : r[1].system;
    const create = inf.provider === 'anthropic' ? createAnthropic : createOpenAI;
    const run = makeRunTool(sh, {
      log: function(name, input) {
        // start: dispatch 當下就發, 讓畫面即時顯示「正在做什麼」
        post({type: 'chat-tool', id: current, phase: 'start', tool: name, input: input, error: false});
      },
      host: hostCall
    });
    // end: 執行完再發一則。兩段是必要的 —
    //  - 失敗要能顯示成 ✗ (只有 start 的話全都是 ✓)
    //  - 寫檔造成的重新渲染必須等寫入真的完成, 否則 sandbox 會讀到舊檔
    const runTool = function(name, input) {
      const done = function(error, message) {
        post({
          type: 'chat-tool', id: current, phase: 'end', tool: name, input: input,
          error: !!error, message: message
        });
      };
      return Promise.resolve().then(function() { return run(name, input); })
        .then(function(out) { done(false); return out; })
        .catch(function(e) {
          done(true, String((e && e.message) || e));
          throw e;
        });
    };
    sessions[key] = create({
      system: system, tools: tools.concat(hostTools), runTool: runTool,
      api: api, model: inf.model
    });
    return sessions[key];
  });
}

// chat 請求序列化, 與 shell 共用同一份 workspace
let queue = Promise.resolve();
self.addEventListener('message', function(ev) {
  const msg = ev.data || {};
  if(msg.type === 'host-tools') {
    hostTools = msg.tools || [];
    return;
  }
  if(msg.type === 'device-set') {
    if(deviceNames.indexOf(msg.name) >= 0) { deviceValues[msg.name] = String(msg.value == null ? '' : msg.value); }
    return;
  }
  if(msg.type === 'host-info') {
    hostBrief = msg.brief || null;
    hasHostContext = !!msg.hasContext;
    return;
  }
  if(msg.type === 'host-result') {
    const p = hostPending[msg.id];
    if(!p) { return; }
    delete hostPending[msg.id];
    clearTimeout(p.timer);
    return msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
  }
  if(msg.type === 'chat-reset') {
    if(msg.session) { delete sessions[msg.session]; }
    else { Object.keys(sessions).forEach(function(k) { delete sessions[k]; }); }
    return;
  }
  if(msg.type !== 'chat') { return; }
  queue = queue.then(function() {
    current = msg.id;
    const key = msg.session || msg.block || 'default';
    return Promise.all([getSession(key, msg.block || null), turnContext()])
      .then(function(r) {
        return r[0].send(msg.text, {
          context: r[1],
          onDelta: function(t) { post({type: 'chat-delta', id: msg.id, text: t}); }
        });
      })
      .then(function(r) {
        post({type: 'chat-done', id: msg.id, reply: r.reply, events: r.events});
      })
      .catch(function(e) {
        post({type: 'chat-error', id: msg.id, error: String((e && e.message) || e)});
      })
      .then(function() { current = null; });
  });
});

post({type: 'agent-ready', persist: persist, root: ROOT});
