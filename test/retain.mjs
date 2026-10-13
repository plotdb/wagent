// 一輪中途失敗時保留已完成的步驟 ( turn-context.js 的〈一輪中途失敗〉 ).
//
// 情境: 第一次呼叫模型要求寫檔 ( tool_use ), 檔案寫了; 第二次呼叫被擋 ( 點數不足 ).
// 先前整輪退回: 檔案已經改了, 對話卻什麼都不記得, 使用者說「繼續」agent 接不上.
import express from 'express';
import assert from 'node:assert';
import {createSession as createAnthropic} from '../client/runtime/providers/anthropic.js';
import {createSession as createOpenAI} from '../client/runtime/providers/openai.js';

const ok = (m) => console.log(`  ✓ ${m}`);

let calls = 0;
let fail = null;   // 第二次呼叫回什麼錯: {status, body}
let seen = [];

const app = express();
app.use(express.json({limit: '10mb'}));
const deny = (res) => res.status(fail.status).json(fail.body);

app.post('/llm/anthropic', (req, res) => {
  calls++; seen.push(req.body.messages);
  if(calls === 1) {
    return res.json({stop_reason: 'tool_use', content: [
      {type: 'text', text: '先寫檔'},
      {type: 'tool_use', id: 't1', name: 'write_file', input: {path: 'a.txt'}}
    ]});
  }
  if(fail && calls === 2) { return deny(res); }
  res.json({stop_reason: 'end_turn', content: [{type: 'text', text: '好了'}]});
});

app.post('/llm/openai', (req, res) => {
  calls++; seen.push(req.body.messages);
  if(calls === 1) {
    return res.json({choices: [{finish_reason: 'tool_calls', message: {role: 'assistant', content: '先寫檔',
      tool_calls: [{id: 'c1', type: 'function', function: {name: 'write_file', arguments: '{"path":"a.txt"}'}}]}}]});
  }
  if(fail && calls === 2) { return deny(res); }
  res.json({choices: [{finish_reason: 'stop', message: {role: 'assistant', content: '好了'}}]});
});

const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const api = `http://127.0.0.1:${srv.address().port}`;
const tools = [{name: 'write_file', description: 'write', parameters: {type: 'object', properties: {}}}];
const runTool = () => Promise.resolve('written');
const flat = (m) => JSON.stringify(m);
const credits = {status: 490, body: {name: 'lderror', id: 11001, message: 'Not enough credits', payload: {need: 9, balance: 1}}};
const invalid = {status: 400, body: {error: {message: 'invalid request'}}};

console.log('retain');

for(const [label, create] of [['anthropic', createAnthropic], ['openai', createOpenAI]]) {
  // ── 可以重試的錯誤 ( 點數不足 ): 保留到最後一個完整的步驟 ─────────────
  calls = 0; seen = []; fail = credits;
  let s = create({system: 'sys', tools, runTool, api, model: 'm'});
  let err = null;
  await s.send('做一個檔案', {}).catch((e) => { err = e; });
  assert.ok(err && err.id === 11001, `${label}: 錯誤要照樣丟出 ( 帶 id )`);
  assert.ok(err.retained, `${label}: 標記為已保留`);
  let h = s.getHistory();
  const text = flat(h);
  assert.ok(text.indexOf('做一個檔案') >= 0, `${label}: 使用者的話要留著`);
  assert.ok(text.indexOf('written') >= 0, `${label}: 完成的 tool 結果要留著`);
  assert.equal(h[h.length - 1].role, 'assistant', `${label}: 最後一則是 assistant ( 紀錄維持一來一往 )`);
  assert.ok(text.indexOf('[interrupted]') >= 0, `${label}: 補上中斷說明`);
  ok(`${label}: 點數不足 → 保留使用者的話與完成的步驟, 補中斷說明`);

  // 接著說「繼續」: 送出去的紀錄裡要看得到前面那句與中斷說明
  fail = null; calls = 1; seen = [];
  const r = await s.send('繼續', {});
  assert.equal(r.reply, '好了');
  const sent = flat(seen[0]);
  assert.ok(sent.indexOf('做一個檔案') >= 0 && sent.indexOf('[interrupted]') >= 0 && sent.indexOf('繼續') >= 0,
    `${label}: 「繼續」時模型看得到原本的要求與中斷說明`);
  ok(`${label}: 之後說「繼續」, 模型看得到原本的要求`);

  // ── 不能重試的錯誤 ( 400 ): 照舊整輪退回 ───────────────────────────────
  calls = 0; seen = []; fail = invalid;
  s = create({system: 'sys', tools, runTool, api, model: 'm'});
  err = null;
  await s.send('做一個檔案', {}).catch((e) => { err = e; });
  assert.ok(err && !err.retained, `${label}: 400 不保留`);
  assert.equal(s.getHistory().length, 0, `${label}: 400 整輪退回`);
  ok(`${label}: 400 → 照舊整輪退回 ( 不讓壞掉的紀錄卡住之後每一輪 )`);
}

srv.close();
console.log('all ok');
