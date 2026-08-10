// browser agent runtime: shell (esh) + agent loop 同在這個 worker 內。
// tool 執行完全不出 worker; 後端只被用來轉發 LLM 請求 (llm proxy)。
//
// 對外協定:
//  - esh 的 serveShell: {type: 'exec' | 'fs' | 'hello'}  (供 connectShell / esh-term 使用)
//  - 本檔的 chat 層:   {type: 'chat', id, text, block, session}
//                      -> {type: 'chat-delta' | 'chat-tool' | 'chat-done' | 'chat-error', id, ...}
//                      {type: 'chat-reset', session}
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

let persist = 'in-memory';
let sh;
try {
  sh = await esh.createShell({mounts: {'/home': {backend: 'opfs'}}});
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

esh.serveShell(sh, self, {persist: persist, root: ROOT});

// ── chat 層 ───────────────────────────────────────────────────────────
const post = function(o) { self.postMessage(o); };
const sessions = {};
let info = null;   // {provider, model}
let current = null;  // 進行中 request 的 id, 供 tool 事件標記

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
    const system = r[1].system;
    const create = inf.provider === 'anthropic' ? createAnthropic : createOpenAI;
    const runTool = makeRunTool(sh, function(name, input) {
      post({type: 'chat-tool', id: current, tool: name, input: input, error: false});
    });
    sessions[key] = create({
      system: system, tools: tools, runTool: runTool,
      api: api, model: inf.model
    });
    return sessions[key];
  });
}

// chat 請求序列化, 與 shell 共用同一份 workspace
let queue = Promise.resolve();
self.addEventListener('message', function(ev) {
  const msg = ev.data || {};
  if(msg.type === 'chat-reset') {
    if(msg.session) { delete sessions[msg.session]; }
    else { Object.keys(sessions).forEach(function(k) { delete sessions[k]; }); }
    return;
  }
  if(msg.type !== 'chat') { return; }
  queue = queue.then(function() {
    current = msg.id;
    const key = msg.session || msg.block || 'default';
    return getSession(key, msg.block || null)
      .then(function(session) {
        return session.send(msg.text, {
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
