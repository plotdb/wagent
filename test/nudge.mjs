/*
 * 執行中插話 (todo #2) 的插入點驗收。
 *
 * 這件事會壞在協定層而不是畫面上: tool_use 與 tool_result 必須成對,
 * 把使用者的話塞在中間, provider 會拒絕整個請求 —— 而且是在使用者已經
 * 講完話之後才炸, 最難查。所以直接檢查送出去的 request body。
 *
 * 跑: node test/nudge.mjs
 */
import {createSession as anthropic} from '../client/runtime/providers/anthropic.js';
import {createSession as openai} from '../client/runtime/providers/openai.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`); }
};

// 每次呼叫回下一個罐頭回應, 並記下送出去的 body
function stubFetch(responses) {
  const sent = [];
  globalThis.fetch = (url, opt) => {
    sent.push(JSON.parse(opt.body));
    const body = responses[sent.length - 1];
    return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(body)});
  };
  return sent;
}

const TOOLS = [{name: 'write_file', description: 'w', parameters: {type: 'object', properties: {}}}];

console.log('\n[anthropic]');
{
  // 第一輪回一個 tool_use, 第二輪就收尾 —— 插話應該落在這兩者之間
  const sent = stubFetch([
    {content: [{type: 'tool_use', id: 'tu_1', name: 'write_file', input: {path: 'a'}}], stop_reason: 'tool_use'},
    {content: [{type: 'text', text: 'done'}], stop_reason: 'end_turn'}
  ]);
  let served = false;
  const s = anthropic({
    system: 'sys', tools: TOOLS, api: '/api/agent', model: 'm',
    runTool: () => Promise.resolve('written')
  });
  const r = await s.send('做一個 block', {
    nudge: () => { if(served) { return null; } served = true; return ['順便改成藍色']; }
  });
  ok('對話正常收尾', r.reply === 'done', r.reply);

  const second = sent[1].messages;
  const last = second[second.length - 1];
  ok('插話落在 user message 裡', last.role === 'user', last.role);
  ok('tool_result 排在最前面', last.content[0].type === 'tool_result', last.content[0].type);
  ok('tool_use 有配到 tool_result',
    last.content[0].tool_use_id === 'tu_1', last.content[0].tool_use_id);
  const tail = last.content[last.content.length - 1];
  ok('插話接在 tool_result 之後', tail.type === 'text' && /順便改成藍色/.test(tail.text), JSON.stringify(tail));
  ok('插話標成使用者說的話', /\[user-interjection\]/.test(tail.text));
  // 沒被拿走就重複送 = 同一句講兩次
  const firstUser = second.find(m => m.role === 'user');
  ok('插話沒有混進原本那則發話',
    !JSON.stringify(firstUser.content).includes('順便改成藍色'));
}

console.log('\n[openai]');
{
  const sent = stubFetch([
    {choices: [{message: {role: 'assistant', content: null, tool_calls: [
      {id: 'c1', type: 'function', function: {name: 'write_file', arguments: '{"path":"a"}'}}
    ]}}]},
    {choices: [{message: {role: 'assistant', content: 'done'}}]}
  ]);
  let served = false;
  const s = openai({
    system: 'sys', tools: TOOLS, api: '/api/agent', model: 'm',
    runTool: () => Promise.resolve('written')
  });
  const r = await s.send('做一個 block', {
    nudge: () => { if(served) { return null; } served = true; return ['順便改成藍色']; }
  });
  ok('對話正常收尾', r.reply === 'done', r.reply);

  const msgs = sent[1].messages;
  const iTool = msgs.findIndex(m => m.role === 'tool');
  const iNudge = msgs.findIndex(m => m.role === 'user' && JSON.stringify(m.content).includes('順便改成藍色'));
  ok('每個 tool_call 都有對應的 tool 訊息',
    msgs.filter(m => m.role === 'tool').length === 1);
  ok('tool 訊息對得上 id', msgs[iTool].tool_call_id === 'c1', msgs[iTool].tool_call_id);
  ok('插話排在 tool 訊息之後', iNudge > iTool, `tool@${iTool} nudge@${iNudge}`);
  ok('插話標成使用者說的話', /\[user-interjection\]/.test(JSON.stringify(msgs[iNudge].content)));
}

console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
