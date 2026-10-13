// 對話壓縮 ( client/runtime/compact.js ).
import assert from 'node:assert';
import {compact, splitPoint, transcriptText, stripThinking, estimateTokens, SUMMARY_TAG} from '../client/runtime/compact.js';

const ok = (m) => console.log(`  ✓ ${m}`);
console.log('compact');

// anthropic 格式的三輪: 第二輪有 tool 呼叫與結果, 第三輪的回覆帶 thinking
const big = 'x'.repeat(4000);
const A = [
  {role: 'user', content: [{type: 'text', text: '第一輪：做一本焚風的書 ' + big}]},
  {role: 'assistant', content: [{type: 'text', text: '好'}]},
  {role: 'user', content: [{type: 'text', text: '第二輪：改顏色'}]},
  {role: 'assistant', content: [{type: 'tool_use', id: 't1', name: 'edit_file', input: {path: 'index.html'}}]},
  {role: 'user', content: [{type: 'tool_result', tool_use_id: 't1', content: 'ok'}]},
  {role: 'assistant', content: [{type: 'text', text: '改好了'}]},
  {role: 'user', content: [{type: 'text', text: '第三輪：加旁白'}]},
  {role: 'assistant', content: [{type: 'thinking', thinking: '...', signature: 's'}, {type: 'text', text: '加好了'}]}
];

// 切點落在一輪的開頭, 不會把 tool_use 與 tool_result 拆開
assert.equal(splitPoint(A, 'anthropic', 2), 2, '保留最後兩輪: 從第二輪的發話開始');
assert.equal(splitPoint(A, 'anthropic', 1), 6, '保留最後一輪: tool_result 不算一輪的開頭');
assert.equal(splitPoint(A, 'anthropic', 3), 0, '輪數不夠就不壓');
ok('切點落在一輪的開頭 ( tool_result 不算 ), 輪數不夠回 0');

const t = transcriptText(A, 'anthropic');
assert.ok(t.indexOf('called edit_file') >= 0 && t.indexOf('Tool result: ok') >= 0, 'tool 呼叫與結果寫進文字版');
assert.ok(t.indexOf('...') < 0 || t.indexOf('thinking') < 0, 'thinking 不進文字版');
ok('文字版紀錄: tool 呼叫與結果截短保留, thinking 略過');

const s = stripThinking(A.slice(6), 'anthropic');
assert.ok(!JSON.stringify(s).includes('"thinking"'), '保留的部分拿掉 thinking');
assert.equal(s[1].content[0].text, '加好了');
ok('保留的部分拿掉 thinking ( 前綴換了就作廢 )');

// 沒超過門檻: 不壓 ( 也不呼叫摘要模型 )
let called = 0;
const call = (body) => { called++; return Promise.resolve({content: [{type: 'text', text: '摘要：使用者在做焚風的書, 已改顏色'}]}); };
let r = await compact(A, 'anthropic', {at: 1e9, keep: 1, provider: 'anthropic', model: 'm', call});
assert.equal(r, null); assert.equal(called, 0);
ok('沒超過門檻: 不壓, 不花錢');

// 超過門檻: 舊的換成摘要 + 確認, 最後一輪原文保留
r = await compact(A, 'anthropic', {at: 10, keep: 1, provider: 'anthropic', model: 'm', call});
assert.equal(called, 1);
assert.ok(r[0].content[0].text.indexOf(SUMMARY_TAG) === 0 && r[0].content[0].text.indexOf('焚風') > 0, '開頭是摘要');
assert.equal(r[1].role, 'assistant', '摘要後接一則 assistant 確認 ( 一來一往 )');
assert.equal(r[2].content[0].text, '第三輪：加旁白', '最後一輪原文保留');
assert.ok(estimateTokens(r) < estimateTokens(A), '壓縮後比較短');
ok('超過門檻: 舊的換成摘要, 最後幾輪原文保留, 紀錄變短');

// openai 格式: 摘要模型的請求與回應形狀
const O = [
  {role: 'user', content: '一 ' + big}, {role: 'assistant', content: '好'},
  {role: 'user', content: '二'}, {role: 'assistant', content: null, tool_calls: [{id: 'c1', type: 'function', function: {name: 'edit_file', arguments: '{}'}}]},
  {role: 'tool', tool_call_id: 'c1', content: 'ok'}, {role: 'assistant', content: '完成'}
];
let sent = null;
r = await compact(O, 'openai', {at: 10, keep: 1, provider: 'openai', model: 'gpt-6-luna', call: (b) => { sent = b; return Promise.resolve({choices: [{message: {content: '摘要'}}]}); }});
assert.equal(sent.model, 'gpt-6-luna'); assert.equal(sent.messages[0].role, 'system');
assert.equal(r[0].role, 'user'); assert.equal(r[2].content, '二');
ok('openai 格式: 用指定的摘要模型, 保留最後一輪');

console.log('all ok');
