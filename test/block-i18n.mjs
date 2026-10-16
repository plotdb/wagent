/*
 * chat / sandbox block 的字串走 @plotdb/block 原生 i18n: 在真的瀏覽器裡用真的 block 驗。
 *
 *  - 沒有任何設定: block.i18n 的預設語言是 en -> 英文介面
 *  - host extend chat/index.html 並給自己的 pkg.i18n -> 子 block 的字串優先
 *  - data.strings 又優先於 extend 的 i18n; data.lang 直接用內建的那一份
 *  - block.i18n.changeLanguage('zh-TW') -> 靜態字串跟著換
 *
 * 需要 playwright-core 與裝好的 chromium; 開不起來就略過 ( exit 0, 印出原因 ), 不擋 npm test。
 * 跑: node test/block-i18n.mjs
 */
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import {fileURLToPath} from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(dir, '..');

let chromium;
try { ({chromium} = await import('playwright-core')); }
catch(e) { console.log(`skip: playwright-core not available (${e.message})`); process.exit(0); }

const HOST = `<div><script type="@plotdb/block">
module.exports = {
  pkg: {
    name: 'host-chat', version: 'main',
    extend: {name: '@plotdb/wagent', path: 'block/chat/index.html'},
    i18n: {en: {send: 'X-SEND', greetNew: 'X-HELLO {nothing}'}, 'zh-TW': {send: 'X-送'}}
  },
  init: function() {}
};
</script></div>`;

const app = express();
app.use('/assets/lib/@plotdb/wagent/main', express.static(path.join(repo, 'client')));
for(const m of ['@plotdb/block', '@plotdb/csscope', '@plotdb/rescope', '@plotdb/semver', 'proxise']) {
  app.use(`/assets/lib/${m}/main`, express.static(path.join(repo, 'node_modules', m)));
}
// chat 沒有 data.models 時會問 provider
app.get('/api/agent/provider', (req, res) => { res.json({provider: 'anthropic', model: 'm'}); });
app.get('/assets/lib/host-chat/main/index.html', (req, res) => { res.type('html').send(HOST); });
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><html><body>
<script src="/assets/lib/proxise/main/index.min.js"></script>
<script src="/assets/lib/@plotdb/semver/main/index.min.js"></script>
<script src="/assets/lib/@plotdb/csscope/main/index.min.js"></script>
<script src="/assets/lib/@plotdb/rescope/main/index.min.js"></script>
<script src="/assets/lib/@plotdb/block/main/index.min.js"></script>
<script>
var mgr = new block.manager({registry: function(o) {
  return '/assets/lib/' + o.name + '/' + (o.version || 'main') + '/' + (o.path || 'index.html');
}});
var transport = {send: function() { return Promise.resolve({reply: ''}); }, nudge: function() {}, reset: function() {}};
window.make = function(bid, data) {
  var root = document.createElement('div');
  document.body.appendChild(root);
  return mgr.get(bid).then(function(cls) {
    return cls.create({root: root, data: Object.assign({transport: transport}, data || {})});
  }).then(function() {
    return {
      send: root.querySelector('.rc-chat-input button').textContent,
      placeholder: root.querySelector('textarea').placeholder,
      autofix: root.querySelector('.rc-chat-autofix span').textContent,
      greet: root.querySelector('.rc-msg.assistant').textContent,
      title: root.querySelector('.rc-chat-title').textContent,
      id: (window._n = (window._n || 0) + 1)
    };
  }).then(function(r) { window['root' + r.id] = root; return r; });
};
window.read = function(id) {
  var root = window['root' + id];
  return {send: root.querySelector('.rc-chat-input button').textContent, placeholder: root.querySelector('textarea').placeholder};
};
window.makeSandbox = function(data) {
  var root = document.createElement('div');
  document.body.appendChild(root);
  return mgr.get({name: '@plotdb/wagent', path: 'block/sandbox/index.html'}).then(function(cls) {
    return cls.create({root: root, data: data || {}});
  }).then(function() {
    return {empty: root.querySelector('.rc-sandbox-empty').textContent, refresh: root.querySelector('button').title};
  });
};
</script></body></html>`);
});

const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
const url = `http://127.0.0.1:${srv.address().port}/`;

let browser;
try { browser = await chromium.launch(); }
catch(e) { console.log(`skip: chromium not available (${e.message.split('\n')[0]})`); srv.close(); process.exit(0); }

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`); }
};

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  const CHAT = {name: '@plotdb/wagent', path: 'block/chat/index.html'};
  const HOSTB = {name: 'host-chat'};

  const plain = await page.evaluate((b) => window.make(b), CHAT);
  ok('沒有設定: block i18n 預設 en -> 英文介面', plain.send === 'Send' && plain.autofix === 'Auto-fix errors' &&
    /^Type a message/.test(plain.placeholder) && plain.title === 'New block', plain);

  const host = await page.evaluate((b) => window.make(b), HOSTB);
  ok('extend 的 pkg.i18n 覆寫 ( 靜態 t 屬性 )', host.send === 'X-SEND', host);
  ok('extend 的 pkg.i18n 覆寫 ( 程式裡的字串, 佔位沒給就留著 )', host.greet === 'X-HELLO {nothing}', host);
  ok('extend 沒覆寫的 key 用 chat 自己的', host.autofix === 'Auto-fix errors', host);

  const over = await page.evaluate((b) => window.make(b, {strings: {send: 'S-SEND'}}), HOSTB);
  ok('data.strings 優先於 extend 的 i18n', over.send === 'S-SEND', over);

  const zh = await page.evaluate((b) => window.make(b, {lang: 'zh'}), HOSTB);
  ok('data.lang: 直接用內建的 zh ( extend 的覆寫不適用 )', zh.send === '送出' && zh.autofix === '出錯自動修', zh);

  const edit = await page.evaluate((b) => window.make(b, {lang: 'en', block: 'clock'}), CHAT);
  ok('佔位代入 ( greetEdit {name} )', edit.greet === 'Editing "clock". Tell me what you would like to change.', edit);

  // 換語言: 已經建好的跟著換 ( 靜態字串 ), 之後建的直接是新語言
  await page.evaluate(() => block.i18n.changeLanguage('zh-TW'));
  const after = await page.evaluate((id) => window.read(id), plain.id);
  ok('changeLanguage(zh-TW): 已建好的 chat 跟著換', after.send === '送出' && /^輸入訊息/.test(after.placeholder), after);
  const hostTw = await page.evaluate((b) => window.make(b), HOSTB);
  ok('zh-TW: extend 的 zh-TW 覆寫, 其餘用 chat 的 zh-TW', hostTw.send === 'X-送' && hostTw.autofix === '出錯自動修', hostTw);
  const zhOld = await page.evaluate((id) => window.read(id), zh.id);
  ok('data.lang 的不受 changeLanguage 影響', zhOld.send === '送出', zhOld);

  await page.evaluate(() => block.i18n.changeLanguage('ja'));
  const ja = await page.evaluate((b) => window.make(b), CHAT);
  ok('沒有資源的語言: 退回內建 en ( 不會顯示 key )', ja.send === 'Send' && ja.autofix === 'Auto-fix errors', ja);

  await page.evaluate(() => block.i18n.changeLanguage('en'));
  const sb = await page.evaluate(() => window.makeSandbox());
  ok('sandbox: 預設 en', /^Nothing here yet/.test(sb.empty) && sb.refresh === 'Re-render', sb);
  const sbz = await page.evaluate(() => window.makeSandbox({lang: 'zh-TW', strings: {refresh: 'R'}}));
  ok('sandbox: data.lang + data.strings', /^尚無內容/.test(sbz.empty) && sbz.refresh === 'R', sbz);

  ok('頁面沒有錯誤', !errors.length, errors);
} finally {
  await browser.close();
  srv.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
