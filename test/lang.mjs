/*
 * lang 的驗收: 掛載點 wagent({lang}) 決定 system prompt 與給前端看的錯誤訊息用哪個語言,
 * runtime 給模型看的執行環境說明跟著它。
 *
 * 會壞的方式都很安靜:
 *  - en 的 prompt 裡殘留中文 —— 模型多半照樣能讀, 但回話的語言、語氣會被帶偏, 沒有任何錯誤
 *  - 預設 ( zh ) 被動到 —— 既有應用的行為悄悄改變
 *  - lang 打錯字 —— 等到第一次對話才發現 ( 所以要在掛載時就丟 )
 *
 * 跑: node test/lang.mjs
 */
import express from 'express';
import {createRequire} from 'module';
import * as tc from '../client/runtime/turn-context.js';
import {summaryMessages} from '../client/runtime/compact.js';

const require = createRequire(import.meta.url);
const prompt = require('../api/prompt.js');
const wagent = require('../api/index.js');

const CJK = /[　-〿㐀-鿿＀-￯]/;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`); }
};
const cjkAt = (s) => { const m = CJK.exec(s); return m ? JSON.stringify(s.slice(Math.max(0, m.index - 30), m.index + 30)) : ''; };

console.log('\n[prompt]');
{
  for(const preset of Object.keys(prompt.PRESETS)) {
    for(const block of [null, 'clock']) {
      const s = prompt.compose('', block, preset, 'en');
      ok(`en ${preset} (block=${block}): 沒有中文`, !CJK.test(s), cjkAt(s));
    }
    // 不給 lang 就是 zh, 而且跟 0.7 一樣 ( 跟明講 zh 完全相同 )
    ok(`${preset}: 預設 === zh`, prompt.compose('P', 'b', preset) === prompt.compose('P', 'b', preset, 'zh'));
    ok(`${preset}: zh 與 en 不同`, prompt.compose('P', 'b', preset, 'zh') !== prompt.compose('P', 'b', preset, 'en'));
  }
  ok('en block: 含 block 格式與新增模式', /@plotdb\/block/.test(prompt.compose('', null, 'block', 'en')) &&
    /"new" mode/.test(prompt.compose('', null, 'block', 'en')));
  ok('en plain: 不提 block', !/block/i.test(prompt.compose('PURPOSE', 'bar', 'plain', 'en')));
  ok('en: purpose 原樣接上, 不翻譯', prompt.compose('目的', null, 'plain', 'en').endsWith('目的'));
  ok('PRESETS 與 PRESETS_EN 的 preset 名稱一致',
    Object.keys(prompt.PRESETS).join() === Object.keys(prompt.PRESETS_EN).join());

  let err = null;
  try { prompt.lang('fr'); } catch(e) { err = e; }
  ok('lang 打錯字: 丟錯並列出可用的', err && /zh, en/.test(err.message), err && err.message);
}

console.log('\n[mount]');
{
  let err = null;
  try { wagent({lang: 'english'}); } catch(e) { err = e; }
  ok('掛載時就丟 ( 不等第一次對話 )', err && /unknown lang "english"/.test(err.message), err && err.message);
  let none = null;
  try { wagent({}); wagent({lang: 'en'}); wagent({lang: 'zh'}); } catch(e) { none = e; }
  ok('zh / en / 不給 都可以掛', !none, none && none.message);

  // /provider 與 /prompt 回報 lang; 額度錯誤的 message 跟著語言 ( 送出前就擋下, 不會打到 upstream )
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  const app = express();
  app.use(express.json());
  app.use('/en', wagent({lang: 'en', budget: function() { return 0; }}));
  app.use('/zh', wagent({budget: function() { return 0; }}));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const pe = await (await fetch(`${base}/en/provider`)).json();
    const pz = await (await fetch(`${base}/zh/provider`)).json();
    ok('/provider 回報 lang', pe.lang === 'en' && pz.lang === 'zh', JSON.stringify([pe.lang, pz.lang]));
    const qe = await (await fetch(`${base}/en/prompt?block=clock`)).json();
    ok('/prompt 回報 lang, system 是英文', qe.lang === 'en' && !CJK.test(qe.system) && qe.system.includes('"clock"'));
    const qz = await (await fetch(`${base}/zh/prompt`)).json();
    ok('/prompt 預設 zh, 與 compose 預設相同', qz.lang === 'zh' && qz.system === prompt.compose('', null));
    const body = JSON.stringify({model: 'claude-opus-4-8', messages: [{role: 'user', content: 'hi'}]});
    const opt = {method: 'POST', headers: {'content-type': 'application/json'}, body: body};
    const ee = await (await fetch(`${base}/en/llm/anthropic`, opt)).json();
    const ez = await (await fetch(`${base}/zh/llm/anthropic`, opt)).json();
    ok('額度錯誤: en 的 message 沒有中文', ee.id === 1004 && !CJK.test(ee.message), JSON.stringify(ee));
    ok('額度錯誤: zh 照舊', ez.id === 1004 && ez.message === '額度不足以完成這次請求', JSON.stringify(ez));
  } finally {
    srv.close();
  }
}

console.log('\n[runtime]');
{
  const e = new Error('quota exceeded');
  const en = [
    tc.wrapContext('state', 'en'), tc.wrapNudge(['hi'], 'en'), tc.wrapLimit(20, 30, 'en'),
    tc.limitReply(30, 'en'), tc.wrapTruncated('en'), tc.interruptedNote(e, 'en'),
    tc.strings('en').truncatedReply, tc.strings('en').truncatedStop(2),
    JSON.stringify(tc.userContent('hi', 'state', 'en')),
    JSON.stringify(summaryMessages('S', 'anthropic', 'en')), JSON.stringify(summaryMessages('S', 'openai', 'en'))
  ];
  en.forEach(function(s, i) { ok(`en #${i}: 沒有中文`, !CJK.test(s), cjkAt(s)); });
  // 預設 ( 不給 lang ) 與 zh 一字不差
  ok('wrapContext 預設 === zh', tc.wrapContext('x') === tc.wrapContext('x', 'zh'));
  ok('wrapLimit 預設 === zh', tc.wrapLimit(1, 2) === tc.wrapLimit(1, 2, 'zh'));
  ok('interruptedNote 預設 === zh', tc.interruptedNote(e) === tc.interruptedNote(e, 'zh'));
  ok('summaryMessages 預設 === zh', JSON.stringify(summaryMessages('S', 'openai')) === JSON.stringify(summaryMessages('S', 'openai', 'zh')));
  ok('認不得的 lang 退回 zh', tc.wrapTruncated('fr') === tc.wrapTruncated());
  ok('標籤兩種語言共用', tc.wrapContext('x', 'en').startsWith(tc.CONTEXT_TAG) && tc.wrapTruncated('en').startsWith(tc.LIMIT_TAG));
}

console.log('\n[block strings]');
{
  // block 的 script 跟 @plotdb/block 一樣用 eval 包起來取 module.exports, 用假的 opt 驗 tr 的順序
  const fs = require('fs');
  const load = (f) => {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const code = /<script type="@plotdb\/block">([\s\S]*?)<\/script>/.exec(src)[1];
    return (new Function('module', code + ';return module.exports;'))({});
  };
  const base = load('client/block/chat/base.html');
  const view = load('client/block/chat/index.html');
  const sbBase = load('client/block/sandbox/base.html');
  const sbView = load('client/block/sandbox/index.html');
  const mk = (mod, data, t) => { const o = {}; mod.init.call(o, {data: data || {}, t: t}); return mod.interface.call(o); };
  // 假的 block i18n: 有的 key 回字串, 沒有的回 key 本身 ( 同 block 預設模組 )
  const fakeT = (table) => (k) => table[k] != null ? table[k] : k;

  const ZH = '前端渲染 block「clock」時發生錯誤:\nboom\n請 read_file 檢查並修正這個 block。';
  let itf = mk(base, {}, fakeT({}));
  ok('沒有設定且 block i18n 找不到: 內建 en', itf.tr('fixRequest', {name: 'clock', message: 'boom'}).startsWith('An error occurred while rendering block "clock"'));
  itf = mk(base, {}, fakeT({fixTrying: 'T {n}/{max}'}));
  ok('block i18n 有的: 用它, 並代入佔位', itf.tr('fixTrying', {n: 1, max: 2}) === 'T 1/2');
  itf = mk(base, {lang: 'zh'}, fakeT({fixRequest: 'nope'}));
  ok('data.lang: 直接用內建的, 不經 block i18n ( zh 與 0.7 一字不差 )', itf.tr('fixRequest', {name: 'clock', message: 'boom'}) === ZH);
  ok('data.lang zh-TW 與 zh 相同', mk(base, {lang: 'zh-TW'}).tr('compacted') === mk(base, {lang: 'zh'}).tr('compacted'));
  ok('data.lang 沒有的語言 ( fr ): 退回 en', mk(base, {lang: 'fr'}).tr('compacted') === base.pkg.i18n.en.compacted);
  itf = mk(base, {lang: 'zh', strings: {fixTrying: 'S {n}', compacted: () => 'F', fixGaveUp: (p) => 'P' + JSON.stringify(p)}}, fakeT({fixTrying: 'nope'}));
  ok('data.strings 字串優先 ( 佔位照樣代入 )', itf.tr('fixTrying', {n: 3}) === 'S 3');
  ok('data.strings 函式', itf.tr('compacted') === 'F' && itf.tr('fixGaveUp') === 'P{}');
  ok('值裡的 {x} 不會再被代換', mk(base, {lang: 'en'}).tr('compactFailed', {error: '{error}'}).includes('( {error} )'));

  // 視覺層用 base.translator(自己的資源), 順序一樣
  const tv = mk(base, {}, fakeT({send: 'X'})).translator(view.pkg.i18n);
  ok('視覺層: block i18n ( extend 覆寫 ) 生效', tv('send') === 'X' && tv('sendQueued') === 'Queue');
  ok('視覺層: 巢狀的 verb.*', tv('verb.write_file') === 'writing' && tv('verb.nope') === 'verb.nope');
  ok('視覺層: native() 告訴畫面哪些交給 block i18n', tv.native('send') && !mk(base, {strings: {send: 'a'}}).translator(view.pkg.i18n).native('send') &&
    !mk(base, {lang: 'en'}).translator(view.pkg.i18n).native('send'));
  const sv = mk(sbBase, {lang: 'zh', strings: {refresh: 'R'}}).translator(sbView.pkg.i18n);
  ok('sandbox: data.lang + data.strings', sv('refresh') === 'R' && sv('failed', {message: 'm'}) === '渲染失敗: m');

  // 每一份資源: en / zh / zh-TW 都有, 鍵一致, en 沒有中文
  const keys = (o, pre) => Object.keys(o).flatMap((k) => typeof o[k] === 'object' ? keys(o[k], pre + k + '.') : [pre + k]).sort().join();
  for(const [name, mod] of [['chat-base', base], ['chat', view], ['sandbox', sbView]]) {
    const r = mod.pkg.i18n;
    ok(`${name}: en / zh / zh-TW 鍵一致`, keys(r.en, '') === keys(r.zh, '') && keys(r.zh, '') === keys(r['zh-TW'], ''));
    ok(`${name}: en 沒有中文`, !CJK.test(JSON.stringify(r.en)), cjkAt(JSON.stringify(r.en)));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
