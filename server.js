const fs = require('fs');
const express = require('express');
const srcbuild = require('@plotdb/srcbuild');

// minimal .env loader (put ANTHROPIC_API_KEY=sk-... in .env)
if(fs.existsSync('.env')) {
  for(const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if(m && !(m[1] in process.env)) { process.env[m[1]] = m[2]; }
  }
}

const app = express();
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended: true}));

require('./api')({app});

// refactor-0809: router 封裝的 api 模組 + 前端 block 檔案 (待 @plotdb/wagent 驗證後移除)
app.use('/api/refactor-0809', require('./api/refactor-0809')());
app.use('/refactor-0809/block', express.static('web/src/pug/refactor-0809/block'));

// @plotdb/wagent (packages/wagent, npm workspace): 模組化後的正式版
// stream: 後端允許的最高即時等級 ('none' | 'tool' | 'token')
// purpose: 領域知識由應用層 (packages/dataviz) 提供 — wagent 本身不認得任何領域
app.use('/api/agent', require('@plotdb/wagent')({
  workspace: 'workspace',
  purpose: require('./packages/dataviz').purpose,
  log: require('./lib/log'),
  stream: 'token'
}));

app.use('/workspace', express.static('workspace'));
app.use('/', express.static('web/static'));

const port = process.env.PORT || 3000;

Promise.resolve()
  .then(() => new Promise((res, rej) => {
    const s = app.listen(port, (e) => {
      if(e) { return rej(e); }
      require('./lib/log')('server', `listening on port ${s.address().port}`);
      res(s);
    });
  }))
  .then(() => srcbuild.lsp({base: 'web'}));
