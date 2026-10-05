// 串流中途的額度守門。
//
// 這是「額度真的擋得住」與「只是事後記帳」的差別: 沒有這一段, check 只看已用
// 量, 一次大呼叫照樣衝過頭 (見 test/usage.mjs 的第 6 項)。
//
// 三件事要成立:
//  - 超出 budget 時上游被中止 (不是等它跑完才算帳)
//  - 前端收得到**可分辨**的原因 —— 而中途失敗沒有 HTTP status 可用, 只能帶內
//  - 已經流出去的內容仍然交給使用者 (中止不是回滾)
import express from 'express';
import assert from 'node:assert';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const wagent = require('../api/index.js');
const lderr = require('../api/lderr.js');

const ok = (m) => console.log(`  ✓ ${m}`);

// ── 假 upstream: 慢慢吐一大堆內容 ────────────────────────────────────
let aborted = false;
let sent = 0;
const upstream = express();
upstream.use(express.json({limit: '10mb'}));
upstream.post('/v1/messages', async (req, res) => {
  aborted = false; sent = 0;
  res.set('Content-Type', 'text/event-stream');
  // **res** 的 close 才是對面走了; req 的 close 在 body 讀完就發了
  res.on('close', () => { aborted = true; });
  res.write('event: message_start\ndata: ' + JSON.stringify({
    type: 'message_start', message: {usage: {input_tokens: 10}}
  }) + '\n\n');
  for(let i = 0; i < 200; i++) {
    if(aborted || res.destroyed || res.writableEnded) { break; }
    sent++;
    res.write('event: content_block_delta\ndata: ' + JSON.stringify({
      type: 'content_block_delta', index: 0,
      delta: {type: 'text_delta', text: '長條圖'.repeat(10)}   // 90 bytes
    }) + '\n\n');
    await new Promise((r) => setTimeout(r, 2));
  }
  try { res.end(); } catch(e) { /* 已經被中止 */ }
});

const up = await new Promise((r) => { const s = upstream.listen(0, () => r(s)); });
const providers = require('../api/proxy.js').providers;
providers.anthropic.url = `http://127.0.0.1:${up.address().port}/v1/messages`;
process.env.ANTHROPIC_API_KEY = 'test-key';

// ── 受測的 server ────────────────────────────────────────────────────
let budget = null;
const records = [];
const app = express();
app.use(express.json({limit: '10mb'}));
app.use('/api/agent', wagent({
  budget: () => budget,
  usage: (r) => records.push(r)
}));
const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}/api/agent`;

function call() {
  return fetch(`${base}/llm/anthropic`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model: 'claude-opus-4-8', stream: true, messages: [{role: 'user', content: 'go'}]})
  }).then((r) => r.text().then((t) => ({status: r.status, text: t})));
}

console.log('budget guard');

// 1. 不給 budget → 完全不守, 跑完 200 個 chunk
budget = null;
records.length = 0;
let r = await call();
assert.equal(r.status, 200);
assert.equal(sent, 200, `不給 budget 就不該中止 (只送了 ${sent})`);
const full = records[0].billable;
ok(`不給 budget: 跑完 200 chunk, billable ${full} (行為與先前一字不差)`);

// 2. budget 很小 → 中途中止
budget = Math.round(full / 10);
records.length = 0;
r = await call();
assert.equal(r.status, 200, '已經開始 pipe 了, status 改不了 — 這正是要帶內的理由');
assert.ok(sent < 200, `上游應該被中止 (送了 ${sent}/200)`);
ok(`budget ${budget}: 上游在第 ${sent} 個 chunk 被中止 (沒跑完 200)`);

// 3. 前端收得到可分辨的原因
const evt = r.text.split('\n\n').filter((x) => x.indexOf('"type":"error"') >= 0)[0];
assert.ok(evt, '要注入一則 error 事件, 不能讓串流無故斷掉');
const payload = JSON.parse(evt.split('data:')[1].trim());
assert.equal(payload.error.name, 'lderror', 'duck type 才分辨得出是誰說的');
assert.equal(payload.error.id, lderr.ID.QUOTA, `id 要是 ${lderr.ID.QUOTA}`);
assert.equal(payload.error.partial, true, '要讓前端知道內容是不完整的');
ok(`注入的 error: lderror ${payload.error.id} "${payload.error.message}"`);

// 4. 已經流出去的內容仍然交給使用者 —— 中止不是回滾
assert.ok(r.text.indexOf('長條圖') >= 0, '中止前的內容不能吞掉');
ok('中止前已產出的內容照樣交出去 (中止不是回滾)');

// 5. 中止的呼叫照樣記帳 —— 而且**只有 byte 是可信的**。
//    anthropic 的 input 在 message_start 就給了, 所以中止後 usage 看起來有值;
//    但 output 是在 message_delta (串流尾端) 才給的, 中止時根本還沒送出來。
//    也就是說被中止的呼叫, usage 是**一半的真相** —— 拿它計費會少收掉整個
//    output。這正是計價要用 byte 的理由。
assert.equal(records.length, 1, '中止也要記一筆');
assert.ok(records[0].billable > budget, '要記已經花掉的量');
assert.equal(records[0].usage.output, 0, '中止時 output usage 還沒送出來');
assert.ok(records[0].billable > records[0].cost,
  `byte 計價要蓋得住 (billable ${records[0].billable} vs 半殘的 cost ${records[0].cost})`);
ok(`中止仍記帳: billable ${records[0].billable}, 而 usage.output=0 (半殘) — ` +
   'byte 才是被中止時唯一可信的數字');

// 6. input 就超過 → 根本不送, 這時還能用 HTTP status
budget = 1;
records.length = 0;
sent = 0;
r = await call();
assert.equal(r.status, lderr.HTTP, `送出前擋掉要用 ${lderr.HTTP}`);
assert.equal(JSON.parse(r.text).id, lderr.ID.QUOTA);
assert.equal(sent, 0, '不該打到 upstream');
ok(`input 就超過: ${lderr.HTTP} + lderror ${lderr.ID.QUOTA}, 沒打到 upstream`);

srv.close(); up.close();
console.log('all ok');
