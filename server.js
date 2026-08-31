const fs = require('fs');
const express = require('express');
const srcbuild = require('@plotdb/srcbuild');

// .env: ANTHROPIC_API_KEY=sk-... 或 OPENAI_API_KEY=sk-...
if(fs.existsSync('.env')) {
  for(const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if(m && !(m[1] in process.env)) { process.env[m[1]] = m[2]; }
  }
}

const app = express();
app.use(express.json({limit: '10mb'}));

// ── 帳戶與用量 (應用層) ──────────────────────────────────────────────
// wagent 只把每次呼叫的用量算出來交給 opt.usage; 誰在用、額度多少、存在哪,
// 全部在這裡決定。見 lib/accounts.js。
const accounts = require('./lib/accounts')({log: require('./lib/log')});

// 額度檢查掛在 llm proxy 之前。沒帶帳號就放行 —— 這是 demo, 讓沒設定帳號的
// 用法跟以前一模一樣; 真實系統這裡應該是 401。
function guard(req, res, next) {
  const a = accounts.resolve(req);
  if(!a) { return next(); }
  const c = accounts.check(a.key);
  if(!c.ok) { return res.status(402).json({error: `額度用完了: ${c.reason}`, balance: c.balance}); }
  req.account = a;
  next();
}
app.use('/api/agent/llm', guard);
app.use('/api/dataviz/llm', guard);

// 用量查詢也是應用層的 —— wagent 沒有這個 endpoint, 因為它不知道帳存在哪。
app.get('/api/usage', (req, res) => {
  const key = req.get('x-wagent-account') || req.query.key;
  if(!key) { return res.json({accounts: accounts.list()}); }
  res.json({balance: accounts.balance(key), recent: accounts.recent(key, 20)});
});

// proxy 每次呼叫結束後回報。沒帶帳號的呼叫不記帳 (但仍然轉發)。
const usage = function(record) {
  const a = record.req && record.req.account;
  if(!a) { return; }
  accounts.charge(a.key, record);
};

// wagent 的後端只做三件事: 轉發 LLM 請求、給 system prompt、報告 provider。
// workspace 與 agent loop 都在瀏覽器裡, 所以這裡沒有任何檔案系統設定。
//
// 沒有給 purpose —— 這個 sample 不指定領域, 就是一個純粹的 block 編輯環境。
// 有領域的應用 (資料視覺化、遊戲、表單...) 在這裡代入自己的 prompt;
// 至於「這個頁面長怎樣、檔案放哪」那種每輪都可能變的事, 走瀏覽器端的
// registerHost({brief, context}) — 見 web/src/pug/index.ls。
app.use('/api/agent', require('@plotdb/wagent')({
  log: require('./lib/log'),
  usage: usage
}));

// 第二個 mount, 代入 dataviz 的 purpose。一台 server 上可以有好幾個應用,
// 每個有自己的領域 prompt —— 這也是 purpose 唯一該出現的地方。
app.use('/api/dataviz', require('@plotdb/wagent')({
  log: require('./lib/log'),
  purpose: require('./sample/dataviz/prompt'),
  usage: usage
}));

// sample/ 是「應用」不是「頁面」: 不經 srcbuild, 直接以 ES module 交出去。
// 頁面在 web/src/pug/ 下, 跟另外兩個 sample 一樣。
app.use('/sample', express.static('sample'));
app.use('/', express.static('web/static'));

// port 不寫死 —— 0 讓 OS 給一個沒人用的 port (同 @zbryikt/template 的作法:
// listen 之後從 server.address() 問實際的 port, 而不是印我們自己以為的那個)。
// 3000 這種常見的預設值在同時開好幾個專案時必然撞。要固定就給 PORT=xxxx。
const port = process.env.PORT || 0;
const server = app.listen(port, () => {
  // listen 失敗 (指定的 PORT 被佔走) 時 address() 是 null —— 不擋的話這裡會
  // 丟一個看不出原因的 TypeError, 把真正的 EADDRINUSE 蓋掉。
  const addr = server.address();
  if(!addr) { return; }
  const p = addr.port;
  const url = `http://localhost:${p}`;
  require('./lib/log')('server', `listening on ${url}`);
  require('./lib/log')('usage', `帳號: ${accounts.accounts.join(', ')} — ` +
    `用 x-wagent-account header 指定 (createRuntime 的 headers), 查詢 ${url}/api/usage`);
  srcbuild.lsp({base: 'web'});
  // port 是隨機的, 所以順手把瀏覽器開起來 —— 不然每次都得回頭看 log。
  // NO_OPEN=1 關掉 (在 CI、或用 --inspect 這種只要 server 的場合)。
  if(!process.env.NO_OPEN) { openBrowser(url); }
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE'
    ? `port ${port} 已經有人在用了 — 換一個 PORT, 或不指定 PORT 讓系統挑`
    : e);
  process.exit(1);
});

// 不引 open 套件: 它現在是 ESM-only, 在 CommonJS 這裡要 dynamic import,
// 為了三行平台判斷不值得多一個相依。開不起來就算了 —— log 裡有網址。
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  const child = require('child_process')
    .spawn(cmd, [url], {stdio: 'ignore', detached: true, shell: process.platform === 'win32'});
  child.on('error', () => {});
  child.unref();
}
