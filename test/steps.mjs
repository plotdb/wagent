// 一輪之內的步數上限。用一個永遠回 tool_use 的假 provider —— 也就是最壞的
// 那個情況: agent 陷在「改檔 → 重畫 → 看畫面 → 再改」的迴圈裡出不來。
// 沒有上限的話這個測試會跑到天亮, 那正是要擋的東西。
import express from 'express';
import assert from 'node:assert';
import {createSession as createAnthropic} from '../client/runtime/providers/anthropic.js';
import {createSession as createOpenAI} from '../client/runtime/providers/openai.js';
import {LIMIT_TAG} from '../client/runtime/turn-context.js';

const ok = (m) => console.log(`  ✓ ${m}`);

let calls = 0;
let seen = [];   // 每次呼叫收到的 messages, 用來確認提醒有進到對話裡

const app = express();
app.use(express.json({limit: '10mb'}));
app.post('/llm/anthropic', (req, res) => {
  calls++; seen.push(req.body.messages);
  res.json({
    stop_reason: 'tool_use',
    content: [{type: 'tool_use', id: `t${calls}`, name: 'noop', input: {}}]
  });
});
app.post('/llm/openai', (req, res) => {
  calls++; seen.push(req.body.messages);
  res.json({choices: [{message: {
    role: 'assistant', content: '',
    tool_calls: [{id: `t${calls}`, type: 'function', function: {name: 'noop', arguments: '{}'}}]
  }}]});
});
const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const api = `http://127.0.0.1:${srv.address().port}`;

const tools = [{name: 'noop', description: 'noop', parameters: {type: 'object', properties: {}}}];
const runTool = () => Promise.resolve('done');

function flat(messages) { return JSON.stringify(messages); }

console.log('step limits');

for(const [label, create] of [['anthropic', createAnthropic], ['openai', createOpenAI]]) {
  calls = 0; seen = [];
  const s = create({system: 'sys', tools, runTool, api, model: 'm', maxSteps: 6, softSteps: 4});
  const r = await s.send('go', {});

  assert.equal(calls, 6, `${label}: 應該剛好 6 次呼叫就停 (實際 ${calls})`);
  ok(`${label}: hard limit 擋住了無限迴圈 — 6 次呼叫後停止`);

  assert.ok(r.limited, `${label}: 要標記成被限制`);
  assert.ok(r.reply.indexOf('步數上限') >= 0, `${label}: 要給使用者一則說明`);
  ok(`${label}: 回覆有交代 — "${r.reply.split('\n')[0]}"`);

  assert.equal(r.events.length, 6, `${label}: 做過的事要照常回報 (實際 ${r.events.length})`);
  ok(`${label}: events 完整 (${r.events.length} 筆) — 使用者看得到做了什麼`);

  // soft limit: 第 4 步之後注入, 所以第 5 次呼叫看得到, 第 4 次看不到
  assert.ok(flat(seen[3]).indexOf(LIMIT_TAG) < 0, `${label}: 第 4 次呼叫還不該有提醒`);
  assert.ok(flat(seen[4]).indexOf(LIMIT_TAG) >= 0, `${label}: 第 5 次呼叫該看到提醒`);
  ok(`${label}: soft limit 在第 4 步後注入 ${LIMIT_TAG}`);

  // 只提醒一次 —— 每輪都附一遍是在燒 token 叫模型省 token
  const last = flat(seen[5]);
  const n = last.split(LIMIT_TAG).length - 1;
  assert.equal(n, 1, `${label}: 提醒只該出現一次 (實際 ${n})`);
  ok(`${label}: 提醒只注入一次`);

  // 不能被當成使用者說的話
  assert.ok(last.indexOf('[user-interjection]') < 0, `${label}: 不該混進 nudge`);
  ok(`${label}: 沒有偽裝成使用者發言 (與 wrapNudge 分開)`);
}

// 預設值
calls = 0;
const d = createAnthropic({system: 'sys', tools, runTool, api, model: 'm'});
await d.send('go', {});
assert.equal(calls, 30, `預設 maxSteps 應為 30 (實際 ${calls})`);
ok('預設 30 步');

srv.close();
console.log('all ok');
