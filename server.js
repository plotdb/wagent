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

// wagent 的後端只做三件事: 轉發 LLM 請求、給 system prompt、報告 provider。
// workspace 與 agent loop 都在瀏覽器裡, 所以這裡沒有任何檔案系統設定。
//
// 沒有給 purpose —— 這個 sample 不指定領域, 就是一個純粹的 block 編輯環境。
// 有領域的應用 (資料視覺化、遊戲、表單...) 在這裡代入自己的 prompt;
// 至於「這個頁面長怎樣、檔案放哪」那種每輪都可能變的事, 走瀏覽器端的
// registerHost({brief, context}) — 見 web/src/pug/index.ls。
app.use('/api/agent', require('@plotdb/wagent')({
  log: require('./lib/log')
}));

app.use('/', express.static('web/static'));

// port 不寫死 —— 0 讓 OS 給一個沒人用的 port (同 @zbryikt/template 的作法:
// listen 之後從 server.address() 問實際的 port, 而不是印我們自己以為的那個)。
// 3000 這種常見的預設值在同時開好幾個專案時必然撞。要固定就給 PORT=xxxx。
const port = process.env.PORT || 0;
const server = app.listen(port, () => {
  const p = server.address().port;
  require('./lib/log')('server', `listening on http://localhost:${p}`);
  srcbuild.lsp({base: 'web'});
});
