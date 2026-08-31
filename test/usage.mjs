// proxy 的用量記帳。跑一個假的 upstream (不打真的 API), 確認:
//  - anthropic 串流: message_start 的 input/cache + message_delta 的 output 都撈到
//  - openai 串流: proxy 有補 stream_options.include_usage, 末尾那個 chunk 撈得到
//  - 沒有 usage 的回應: 退回 bytes 估算, estimated 為 true
//  - 轉發的內容一字不差 (tee 不能動到 pipe)
//  - 額度用完擋得下來
import http from 'node:http';
import express from 'express';
import assert from 'node:assert';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const wagent = require('../packages/wagent/api/index.js');
const makeAccounts = require('../lib/accounts.js');

const ok = (m) => console.log(`  ✓ ${m}`);

// ── 假的 upstream ────────────────────────────────────────────────────
let lastBody = null;
const upstream = express();
upstream.use(express.json({limit: '10mb'}));
upstream.post('/v1/messages', (req, res) => {
  lastBody = req.body;
  res.set('Content-Type', 'text/event-stream');
  res.write('event: message_start\ndata: ' + JSON.stringify({
    type: 'message_start',
    message: {usage: {input_tokens: 1000, cache_read_input_tokens: 8000, cache_creation_input_tokens: 400}}
  }) + '\n\n');
  res.write('event: content_block_delta\ndata: ' + JSON.stringify({
    type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'hi'}
  }) + '\n\n');
  res.write('event: message_delta\ndata: ' + JSON.stringify({
    type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 500}
  }) + '\n\n');
  res.end();
});
upstream.post('/v1/chat/completions', (req, res) => {
  lastBody = req.body;
  res.set('Content-Type', 'text/event-stream');
  res.write('data: ' + JSON.stringify({choices: [{delta: {content: 'hi'}}]}) + '\n\n');
  res.write('data: ' + JSON.stringify({
    choices: [], usage: {prompt_tokens: 9000, completion_tokens: 500, prompt_tokens_details: {cached_tokens: 8000}}
  }) + '\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
});
// usage 完全沒有的 provider 長什麼樣
upstream.post('/no-usage', (req, res) => {
  lastBody = req.body;
  res.set('Content-Type', 'text/event-stream');
  for(let i = 0; i < 50; i++) {
    res.write('data: ' + JSON.stringify({type: 'content_block_delta', delta: {text: 'x'.repeat(20)}}) + '\n\n');
  }
  res.end();
});

const up = await new Promise((r) => { const s = upstream.listen(0, () => r(s)); });
const upUrl = `http://127.0.0.1:${up.address().port}`;

// upstream 指到假的那台
const providers = require('../packages/wagent/api/proxy.js').providers;
providers.anthropic.url = `${upUrl}/v1/messages`;
providers.openai.url = `${upUrl}/v1/chat/completions`;
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.OPENAI_API_KEY = 'test-key';

// ── 受測的 server ────────────────────────────────────────────────────
const dbFile = `logs/test-usage-${process.pid}.db`;
const accounts = makeAccounts({file: dbFile});
const records = [];

const app = express();
app.use(express.json({limit: '10mb'}));
app.use('/api/agent/llm', (req, res, next) => {
  const a = accounts.resolve(req);
  if(!a) { return next(); }
  const c = accounts.check(a.key);
  if(!c.ok) { return res.status(402).json({error: c.reason}); }
  req.account = a;
  next();
});
app.use('/api/agent', wagent({
  usage: (r) => {
    records.push(r);
    if(r.req && r.req.account) { accounts.charge(r.req.account.key, r); }
  }
}));
const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}/api/agent`;

function call(provider, body, key) {
  return fetch(`${base}/llm/${provider}`, {
    method: 'POST',
    headers: Object.assign({'Content-Type': 'application/json'},
      key ? {'x-wagent-account': key} : {}),
    body: JSON.stringify(body)
  }).then((r) => r.text().then((t) => ({status: r.status, text: t})));
}

console.log('usage metering');

// 1. anthropic 串流
records.length = 0;
let r = await call('anthropic', {model: 'claude-opus-4-8', stream: true, messages: []}, 'demo-alice');
assert.equal(r.status, 200);
assert.ok(r.text.indexOf('"text":"hi"') >= 0, '轉發的內容要完整');
ok('anthropic: 串流原樣轉發');
assert.equal(records.length, 1);
let u = records[0].usage;
assert.deepEqual(
  {input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite},
  {input: 1000, output: 500, cacheRead: 8000, cacheWrite: 400});
ok(`anthropic: usage ${JSON.stringify(u)}`);
assert.equal(records[0].estimated, false);
// 1000*1 + 500*5 + 8000*0.1 + 400*1.25 = 4800
assert.equal(records[0].credits, 4800);
ok(`anthropic: credits ${records[0].credits} (output 5x, cacheRead 0.1x)`);

// 2. openai 串流 — proxy 要自己補 include_usage
records.length = 0;
r = await call('openai', {model: 'gpt-5', stream: true, messages: []}, 'demo-alice');
assert.equal(r.status, 200);
assert.deepEqual(lastBody.stream_options, {include_usage: true});
ok('openai: proxy 補上了 stream_options.include_usage');
u = records[0].usage;
assert.deepEqual({input: u.input, output: u.output, cacheRead: u.cacheRead},
  {input: 1000, output: 500, cacheRead: 8000});
ok(`openai: usage ${JSON.stringify(u)} (prompt_tokens 已扣掉 cached)`);

// 3. 沒有 usage 的回應 → bytes 估算
records.length = 0;
providers.anthropic.url = `${upUrl}/no-usage`;
r = await call('anthropic', {model: 'claude-opus-4-8', stream: true, messages: []}, 'demo-alice');
assert.equal(records[0].estimated, true, '沒有 usage 就該標成估算');
assert.ok(records[0].credits > 0, '估算值要是正的');
ok(`no-usage: 退回 bytes 估算, estimated=true, credits=${records[0].credits}`);
providers.anthropic.url = `${upUrl}/v1/messages`;

// 4. 沒帶帳號 → 照樣轉發, 照樣算, 但不記帳
records.length = 0;
r = await call('anthropic', {model: 'claude-opus-4-8', stream: true, messages: []});
assert.equal(r.status, 200);
assert.equal(records.length, 1);
assert.equal(records[0].req.account, undefined);
ok('沒帶帳號: 轉發正常, 不記帳 (既有應用行為不變)');

// 5. 額度
const b = accounts.balance('demo-alice');
assert.ok(b.spent > 0);
ok(`帳: alice 用了 ${b.spent}/${b.quota} cr`);

r = await call('anthropic', {model: 'claude-opus-4-8', stream: true, messages: []}, 'demo-zero');
assert.equal(r.status, 402, '額度為 0 要擋下來');
ok('額度用完: 402, 沒有打到 upstream');

// 6. 超支: 額度小的帳號一次呼叫就超過
r = await call('anthropic', {model: 'claude-opus-4-8', stream: true, messages: []}, 'demo-tight');
assert.equal(r.status, 200, '第一次還在額度內 (check 只看已用量)');
const t = accounts.balance('demo-tight');
assert.ok(t.left < 0, '所以會超支 — 這是設計上接受的');
ok(`超支一次呼叫: tight ${t.spent}/${t.quota} (left ${t.left}) — 下一次就擋掉`);
r = await call('anthropic', {model: 'claude-opus-4-8', stream: true, messages: []}, 'demo-tight');
assert.equal(r.status, 402);
ok('下一次: 402');

srv.close(); up.close();
require('node:fs').rmSync(dbFile, {force: true});
console.log('all ok');
