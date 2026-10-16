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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
