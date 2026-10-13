// browser agent runtime: shell (esh) + agent loop 同在這個 worker 內。
// tool 執行完全不出 worker; 後端只被用來轉發 LLM 請求 (llm proxy)。
//
// 對外協定:
//  - esh 的 serveShell: {type: 'exec' | 'fs' | 'hello'}  (供 connectShell / esh-term 使用)
//  - 本檔的 chat 層:   {type: 'chat', id, text, block, session}
//                      -> {type: 'chat-delta' | 'chat-tool' | 'chat-done' | 'chat-error', id, ...}
//                         {type: 'chat-progress', id, progress}  每次 LLM 呼叫的進度 ( 欄位見 progress.js ),
//                         已節流; 只給畫面用, 不進歷史
//                      {type: 'chat-reset', session}
//  - model 層:         {type: 'model-list' | 'model-set', id, ...} -> {type: 'model-result', id, ok, ...}
//                      切換成功另外廣播 {type: 'model-change', provider, model}
//  - host 層:          {type: 'host-tools', tools, timeout}   主執行緒註冊額外 tool
//                      {type: 'host-call', id, name, args} -> {type: 'host-result', id, ok, ...}
//                      非檔案系統的操作 (snapshot 等) 在主執行緒執行, 由此轉呼叫
import {toolsFor, makeRunTool, ROOT} from './tools.js';
import {createSession as createOpenAI} from './providers/openai.js';
import {createSession as createAnthropic} from './providers/anthropic.js';
import {convert} from './providers/convert.js';
import {createHostCaller, toolSchema} from './host-call.js';

const params = new URL(self.location.href).searchParams;
const api = params.get('api') || '/api/agent';
const eshUrl = params.get('esh') || '/assets/lib/@plotdb/esh/main/esh.js';
// 一輪之內的模型呼叫上限 (見 turn-context.js 的 wrapLimit)。應用層透過
// createRuntime 給; 0 / 沒給就用 provider 的預設。
const maxSteps = parseInt(params.get('maxSteps'), 10) || 0;
const softSteps = parseInt(params.get('softSteps'), 10) || 0;
// 歷史裡最多留幾張圖 (見 turn-context.js 的〈圖的上限〉); 0 / 沒給就用預設
const maxImages = parseInt(params.get('maxImages'), 10) || 0;
// 打到 api 的額外 header ( CSRF / bearer 之類 )。可變 —— token 會過期,
// 主執行緒用 setHeaders 換新的; provider 拿的是 getter 而不是當下的值。
let apiHeaders = {};
try { apiHeaders = JSON.parse(params.get('headers') || '{}') || {}; } catch(e) { apiHeaders = {}; }
const getHeaders = function() { return apiHeaders; };


const esh = await import(eshUrl);

// workspace 的位置。應用層可換 (createRuntime({root})), 省略就是 ROOT。
// 為什麼要可換: 同一個 origin 上的每個頁面共用同一份 OPFS, 全都用同一個常數
// 就會互相看到對方的檔案。換路徑是隔離的一半 —— 另一半是換掉 /home 背後的
// 儲存 (esh 的 mounts, 見 host.md), 兩者獨立。
//
// 注意這與 agentRoot 是兩件事: workspace 是「東西放哪」, agentRoot 是
// 「agent 看得到哪一段」(預設等於 workspace, 應用層可以再縮到單一 block)。
const WORKSPACE = params.get('workspace') || ROOT;

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

// fs 組態由應用層決定 (host 契約第一塊)。不給就是 OPFS —— 瀏覽器的合理預設。
// 只吃可 JSON 序列化的設定: worker 是另一個 realm, 傳不了 backend class。
let mounts = {'/home': {backend: 'opfs'}};
const mountsParam = params.get('mounts');
if(mountsParam) {
  try { mounts = JSON.parse(mountsParam); }
  catch(e) { console.warn('wagent: mounts 參數不是合法 JSON, 用預設值', e); }
}
// device 一定由這裡併入: 它必須落在 agent root 之內, 而且值的來源在主執行緒。
if(deviceNames.length) { mounts[`${WORKSPACE}/dev`] = {backend: 'device', files: deviceFiles()}; }

let persist = 'in-memory';
let sh;
try {
  sh = await esh.createShell({mounts: mounts});
  persist = (mounts['/home'] && mounts['/home'].backend) || 'mounted';
} catch(e) {
  sh = await esh.createShell();
  persist = `in-memory (掛載失敗: ${e.message})`;
}

// workspace 的初始內容由**應用層**植入 (見 sample/dataviz/seed.js):
// 種什麼範例、要不要種, 都是領域決定 — 一個拿 wagent 做遊戲的人不需要長條圖。
await sh.run(`mkdir -p ${WORKSPACE}`);
await sh.run(`cd ${WORKSPACE}`);

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
// rooted shell 的路徑相對於它自己的 root, 要補回絕對路徑應用層才比對得到。
// root 為 "/" 時 p 已經是絕對路徑, prefix 必須是空字串 — 給 "/" 會拼出 "//blocks/..."。
function normPrefix(root) {
  const s = String(root || '');
  return (!s || s === '/') ? '' : s.replace(/\/+$/, '');
}
// prefix 傳 function: root 會被 chroot 換掉 (setAgentRoot), 存快照的話
// 換過之後回報的路徑就是拿舊 root 拼的, 應用層比對必定落空 -> 畫面不重畫,
// 而 agent 那邊看到的是「檔案改了但畫面沒動」— 這專案最會說謊的那種狀況。
function watchFs(target, getPrefix) {
  const run = target.run.bind(target);
  const write = target.io.writeFile.bind(target.io);
  target.run = function(cmdline) {
    return run(cmdline).then(function(r) {
      // esh 沒有 watch, shell 執行完並不知道自己動了什麼 — 只能說「可能變了」。
      // 寧可多報: 漏報是畫面停在舊的 (先前的行為), 多報只是多畫一次。
      if(mutates(cmdline)) { post({type: 'fs-change', paths: null}); }
      return r;
    });
  };
  target.io.writeFile = function(p, c) {
    return write(p, c).then(function(r) {
      const prefix = getPrefix ? getPrefix() : '';
      post({type: 'fs-change', paths: [prefix && p.charAt(0) === '/' ? prefix + p : p]});
      return r;
    });
  };
}

// ── agent 專用的 rooted shell ─────────────────────────────────────────
// agent 與使用者的終端機用**不同的 shell、同一份 fs**:
//  - sh      未限縮, 給終端機與主執行緒的 io (應用層要看整棵樹: 列 block、讀原始碼)
//  - shAgent 關在 agentRoot 內 ("/" 即 agentRoot), cd .. / 絕對路徑 / glob 都穿不出去
//
// 為什麼要分開: 使用者仍想在整棵樹裡逛, agent 不該。共用同一個 sh 就只能二選一。
// 「人與 agent 操作同一份 working tree」這個性質不受影響 — 分的是視野, 不是資料。
//
// 預設 root 是 workspace。要縮到單一 block 目錄的話由應用層指定 —
// 但注意那會讓 agent 無法建立新 block, 也看不到掛在 workspace 層的 device,
// 所以那是「應用決定編輯對象」的嵌入情境才適用 (composer / makechart)。
let agentRoot = params.get('agentRoot') || WORKSPACE;
const shAgent = await esh.createShell({root: agentRoot});   // 不帶 mounts = 沿用已掛好的 fs
watchFs(sh, null);                                        // 終端機與主執行緒
watchFs(shAgent, function() { return normPrefix(agentRoot); });   // agent (root 可能被 chroot 換掉)

esh.serveShell(sh, self, {persist: persist, root: WORKSPACE});

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
const CONTEXT_TIMEOUT = 3000;   // 每輪都要等, 不能讓應用層拖住整個對話
const CONTEXT_LIMIT = 2000;     // 對照 blockState: 大小由應用層決定, 必須設界
// 逾時 (預設 20 秒, tool 可各自設) 與回覆配對見 host-call.js
const host = createHostCaller(post);
const hostCall = host.call;

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

// /provider: {provider, model, providers: {<name>: {model, models}}}。
// 0.3.0 的後端沒有 providers —— 補成「只有預設那一個」, 選單就只有它
function getInfo(refresh) {
  if(info && !refresh) { return Promise.resolve(info); }
  return fetch(`${api}/provider`, {headers: getHeaders()}).then(function(r) { return r.json(); }).then(function(j) {
    if(!j.providers) {
      j.providers = {};
      if(j.provider) { j.providers[j.provider] = {model: j.model, models: [j.model]}; }
    }
    info = j;
    return j;
  });
}

// ── 模型選擇 ──────────────────────────────────────────────────────────
// 應用層選的 {provider, model}; null = 用後端的預設。每輪開始時才套到 session
// (getSession), 所以跑到一半換, 生效的是下一輪, 不會一輪混兩個模型。
let selected = null;
function currentModel(inf) {
  return selected || {provider: inf.provider, model: inf.model};
}
// 在這裡驗是為了早點報錯; 真正的執行點仍是 proxy 的白名單
function pickModel(want) {
  return getInfo().then(function(inf) {
    if(!want || (!want.provider && !want.model)) { return null; }
    let provider = want.provider;
    if(!provider) {
      // 只給 model: 先找目前的 provider, 再找其他的
      const names = [currentModel(inf).provider].concat(Object.keys(inf.providers));
      provider = names.find(function(n) {
        return n && inf.providers[n] && inf.providers[n].models.indexOf(want.model) >= 0;
      });
      if(!provider) { throw new Error(`model not available: ${want.model}`); }
    }
    const p = inf.providers[provider];
    if(!p) { throw new Error(`provider not available: ${provider}`); }
    const model = want.model || p.model;
    if(p.models.indexOf(model) < 0) { throw new Error(`model not available: ${provider} / ${model}`); }
    return {provider: provider, model: model};
  });
}

const CREATE = {anthropic: createAnthropic, openai: createOpenAI};

// 把目前選的模型套到既有 session。同 provider 只換 model;
// 跨 provider 就把歷史轉成對方的格式, 以同一份 system / tools 重建 —— 對話不清
function applyModel(e, pick) {
  if(!pick.provider) { return e.s; }
  if(e.provider === pick.provider) {
    e.s.setModel(pick.model);
    return e.s;
  }
  e.s = e.make(pick.provider, pick.model, convert(e.s.getHistory(), e.s.format, pick.provider));
  e.provider = pick.provider;
  return e.s;
}

function getSession(key, block) {
  if(sessions[key]) {
    return getInfo().then(function(inf) { return applyModel(sessions[key], currentModel(inf)); });
  }
  return Promise.all([
    getInfo(),
    fetch(`${api}/prompt?mode=browser&block=${encodeURIComponent(block || '')}`)
      .then(function(r) { return r.json(); })
  ]).then(function(r) {
    const pick = currentModel(r[0]);
    // brief 是靜態的, 放 system prompt (快取前綴); 每輪會變的走 turnContext 附在尾端
    const system = hostBrief ? `${r[1].system}\n\n${hostBrief}` : r[1].system;
    const run = makeRunTool(shAgent, {
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
    // 建法留著: 跨 provider 換模型時要以同一份 system / tools 重建
    // host tool 只送 schema 那幾個欄位 (timeout 是給 runtime 的)
    const tools = toolsFor(r[1].preset).concat(hostTools.map(toolSchema));
    const make = function(provider, model, history) {
      return (CREATE[provider] || createOpenAI)({
        system: system, tools: tools, runTool: runTool,
        api: api, model: model, headers: getHeaders,
        maxSteps: maxSteps, softSteps: softSteps, maxImages: maxImages, history: history
      });
    };
    sessions[key] = {provider: pick.provider, s: make(pick.provider, pick.model), make: make};
    return sessions[key].s;
  });
}

// chat 請求序列化, 與 shell 共用同一份 workspace
let queue = Promise.resolve();

// ── 執行中插話 ──────────────────────────────────────────────────────
// 使用者不必等 agent 跑完才能講話。訊息先進這裡, provider 在「tool result
// 之後、下一輪 LLM 呼叫之前」來拿 — 那是唯一不會破壞 tool_use/tool_result
// 配對的插入點。
//
// 沒被拿走的不能丟: agent 可能這一輪就不再呼叫 tool 而直接結束, 使用者的話
// 就會靜靜消失。所以一輪結束後還有剩, 就用它們自動再跑一輪。
//
// 結束時不清空 queue: 「檢查有沒有剩」與「清空」之間有一個 tick 的窗口,
// 剛好落在那裡的訊息會被吃掉。寧可留著 (下一輪會帶走) 也不要靜靜丟掉 —
// 應用層本來就只在 busy 時才 nudge。reset 才清。
let nudges = [];
function takeNudges() {
  if(!nudges.length) { return null; }
  const taken = nudges;
  nudges = [];
  post({type: 'chat-nudge-taken', id: current, texts: taken});
  return taken;
}
self.addEventListener('message', function(ev) {
  const msg = ev.data || {};
  if(msg.type === 'host-tools') {
    hostTools = msg.tools || [];
    host.setTools(hostTools, msg.timeout);
    return;
  }
  if(msg.type === 'agent-root') {
    // 應用層改變 agent 的可見範圍 (host 端 API, shell 內呼叫不到)
    // 成功才更新 agentRoot — 失敗時 shell 的 root 沒變, prefix 也不該變
    try { shAgent.chroot(msg.root); agentRoot = msg.root; }
    catch(e) { post({type: 'agent-root-error', error: String(e.message || e)}); }
    return;
  }
  if(msg.type === 'device-set') {
    if(deviceNames.indexOf(msg.name) >= 0) { deviceValues[msg.name] = String(msg.value == null ? '' : msg.value); }
    return;
  }
  if(msg.type === 'headers-set') {
    // 整份換掉而不是 merge: 呼叫端才知道哪些還有效, 留著舊的等於送過期的 token
    apiHeaders = (msg.headers && typeof msg.headers === 'object') ? msg.headers : {};
    return;
  }
  if(msg.type === 'host-info') {
    hostBrief = msg.brief || null;
    hasHostContext = !!msg.hasContext;
    return;
  }
  if(msg.type === 'host-result') { return host.result(msg); }
  if(msg.type === 'chat-reset') {
    if(msg.session) { delete sessions[msg.session]; }
    else { Object.keys(sessions).forEach(function(k) { delete sessions[k]; }); }
    nudges = [];
    return;
  }
  if(msg.type === 'model-list' || msg.type === 'model-set') {
    const reply = function(ok, v) {
      post(Object.assign({type: 'model-result', id: msg.id, ok: ok},
        ok ? v : {error: String((v && v.message) || v)}));
    };
    if(msg.type === 'model-list') {
      getInfo(!!msg.refresh).then(function(inf) {
        reply(true, {
          current: currentModel(inf), default: {provider: inf.provider, model: inf.model},
          providers: inf.providers
        });
      }).catch(function(e) { reply(false, e); });
      return;
    }
    pickModel(msg.model).then(function(pick) {
      selected = pick;
      return getInfo().then(function(inf) {
        const cur = currentModel(inf);
        reply(true, {current: cur});
        post({type: 'model-change', provider: cur.provider, model: cur.model});
      });
    }).catch(function(e) { reply(false, e); });
    return;
  }
  if(msg.type === 'chat-nudge') {
    // 沒有在跑就不該進 queue — 那是一般的發話, 應用層自己判斷
    nudges.push(String(msg.text == null ? '' : msg.text));
    post({type: 'chat-nudge-queued', id: current, count: nudges.length});
    return;
  }
  if(msg.type !== 'chat') { return; }
  queue = queue.then(function() {
    current = msg.id;
    const key = msg.session || msg.block || 'default';

    // 一輪 = 一次 send。跑完若 queue 還有剩 (agent 沒呼叫 tool 就結束了),
    // 就把剩的當作新的一輪繼續 — 沿用同一個 id, 對畫面來說仍是同一次執行。
    function turn(text) {
      return Promise.all([getSession(key, msg.block || null), turnContext()])
        .then(function(r) {
          return r[0].send(text, {
            context: r[1],
            nudge: takeNudges,
            onDelta: function(t) { post({type: 'chat-delta', id: msg.id, text: t}); },
            onProgress: function(p) { post({type: 'chat-progress', id: msg.id, progress: p}); }
          });
        })
        .then(function(r) {
          const left = takeNudges();
          if(!left) { return r; }
          post({type: 'chat-delta', id: msg.id, text: '\n'});
          return turn(left.join('\n\n'));
        });
    }

    return turn(msg.text)
      .then(function(r) {
        post({type: 'chat-done', id: msg.id, reply: r.reply, events: r.events});
      })
      .catch(function(e) {
        // lderror 的 id / payload 一起送出去 ( worker 邊界只能傳可序列化的資料, Error 物件本身過不去 ),
        // client 那邊重建成 lderror —— 少了它, 畫面只拿得到給開發者看的英文 message, 也分不出是哪一種錯
        post({type: 'chat-error', id: msg.id, error: String((e && e.message) || e),
          errorId: (e && e.name === 'lderror' && !isNaN(+e.id)) ? +e.id : undefined,
          errorPayload: (e && e.payload) || undefined});
      })
      .then(function() { current = null; });
  });
});

post({type: 'agent-ready', persist: persist, root: WORKSPACE});
