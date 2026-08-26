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
// purpose = 領域 prompt, 由應用層提供 (見 web/src/pug/index.pug 的說明)。
app.use('/api/agent', require('@plotdb/wagent')({
  purpose: require('./web/purpose'),
  log: require('./lib/log')
}));

app.use('/', express.static('web/static'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  require('./lib/log')('server', `listening on ${port}`);
  srcbuild.lsp({base: 'web'});
});
