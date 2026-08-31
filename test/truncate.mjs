// 回應被截斷 (撞 max_tokens) 的處理。
//
// 先前這是個靜靜改壞檔案的洞: anthropic 的 stop_reason 收了卻沒人檢查, 而
// tool input 的 partial JSON 解不開時會變成 {} —— 於是 edit_file({}) 就送出去。
// max_tokens 16000 很少撞到所以沒露出來, 但串流中途中止會讓它變成常態。
import express from 'express';
import assert from 'node:assert';
import {createSession as createAnthropic} from '../packages/wagent/web/runtime/providers/anthropic.js';
import {createSession as createOpenAI} from '../packages/wagent/web/runtime/providers/openai.js';
import {ID} from '../packages/wagent/web/runtime/lderr.js';
import {LIMIT_TAG} from '../packages/wagent/web/runtime/turn-context.js';

const ok = (m) => console.log(`  ✓ ${m}`);

let mode = 'truncate';
let calls = 0;
let seen = [];
const ran = [];

const app = express();
app.use(express.json({limit: '10mb'}));

app.post('/llm/anthropic', (req, res) => {
  calls++; seen.push(req.body.messages);
  if(mode === 'truncate' || (mode === 'once' && calls === 1)) {
    // tool_use 的參數打到一半就沒了
    return res.json({
      stop_reason: 'max_tokens',
      content: [
        {type: 'text', text: '我來改這個檔案'},
        {type: 'tool_use', id: 't1', name: 'edit_file', input: {}, bad: true}
      ]
    });
  }
  res.json({stop_reason: 'end_turn', content: [{type: 'text', text: '改好了'}]});
});

app.post('/llm/openai', (req, res) => {
  calls++; seen.push(req.body.messages);
  if(mode === 'truncate' || (mode === 'once' && calls === 1)) {
    return res.json({choices: [{finish_reason: 'length', message: {role: 'assistant', content: '我來改這'}}]});
  }
  res.json({choices: [{finish_reason: 'stop', message: {role: 'assistant', content: '改好了'}}]});
});

const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const api = `http://127.0.0.1:${srv.address().port}`;

const tools = [{name: 'edit_file', description: 'edit', parameters: {type: 'object', properties: {}}}];
const runTool = (name, input) => { ran.push({name, input}); return Promise.resolve('done'); };
const flat = (m) => JSON.stringify(m);

console.log('truncation');

for(const [label, create] of [['anthropic', createAnthropic], ['openai', createOpenAI]]) {
  // ── 截斷一次就恢復: 應該自己接下去, 不吵到使用者 ──────────────
  mode = 'once'; calls = 0; seen = []; ran.length = 0;
  let s = create({system: 'sys', tools, runTool, api, model: 'm'});
  let r = await s.send('go', {});
  assert.equal(r.reply, '改好了', `${label}: 恢復後要拿到完整的回覆`);
  assert.equal(calls, 2, `${label}: 應該重試一次 (實際 ${calls})`);
  ok(`${label}: 截斷一次 → 自動重試 → 正常完成`);

  assert.equal(ran.length, 0, `${label}: 截斷的 tool 絕不能被執行 (跑了 ${ran.length} 次)`);
  ok(`${label}: 截斷的 tool 沒有被執行 — 先前這裡會送出 edit_file({})`);

  const note = flat(seen[1]);
  assert.ok(note.indexOf(LIMIT_TAG) >= 0, `${label}: 要告訴模型它被截斷了`);
  assert.ok(note.indexOf('拆小') >= 0, `${label}: 要給它可執行的下一步`);
  assert.ok(note.indexOf('[user-interjection]') < 0, `${label}: 不能偽裝成使用者發言`);
  ok(`${label}: 附上 ${LIMIT_TAG} 說明, 且沒有偽裝成使用者發言`);

  // ── 一直截斷: 要停, 而且是 lderror ────────────────────────────
  mode = 'truncate'; calls = 0; seen = [];
  s = create({system: 'sys', tools, runTool, api, model: 'm'});
  let err = null;
  await s.send('go', {}).catch((e) => { err = e; });
  assert.ok(err, `${label}: 連續截斷要丟例外, 不能靜靜回一個截斷的答案`);
  assert.equal(err.name, 'lderror', `${label}: 要是 lderror duck type`);
  assert.equal(err.id, ID.TRUNCATED, `${label}: id 要是 ${ID.TRUNCATED}`);
  ok(`${label}: 連續截斷 → lderror ${err.id} "${err.message}"`);
  assert.ok(calls <= 4, `${label}: 重試要有上限 (實際打了 ${calls} 次)`);
  ok(`${label}: 重試有上限 (${calls} 次呼叫)`);
}

srv.close();
console.log('all ok');
