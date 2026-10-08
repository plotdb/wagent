/*
 * 歷史 append-only 的驗收。
 *
 * 送出過的訊息一個 byte 都不能變: 變了, 從那裡之後的 prompt cache 全部失效
 * (每步重付整份前綴), 而現行 Claude 的 thinking block 綁著前綴, 會被拒 (400)。
 * 所以直接比對連續兩次 request body: 前一次的 messages 必須是後一次的前綴。
 *
 * 跑: node test/append-only.mjs
 */
import {createSession as anthropic} from '../client/runtime/providers/anthropic.js';
import {createSession as openai} from '../client/runtime/providers/openai.js';
import {CONTEXT_TAG, IMAGE_OMITTED} from '../client/runtime/turn-context.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`); }
};

function stubFetch(responses) {
  const sent = [];
  globalThis.fetch = (url, opt) => {
    sent.push(JSON.parse(opt.body));
    const body = responses[sent.length - 1];
    if(!body) { return Promise.reject(new Error(`no canned response for call ${sent.length}`)); }
    return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(body)});
  };
  return sent;
}

const J = (v) => JSON.stringify(v);
// 每一對連續的 request: system / tools 不變, 前一次的 messages 是後一次的前綴
function checkPrefix(label, sent, from) {
  let bad = null;
  for(let i = (from || 0) + 1; i < sent.length; i++) {
    const a = sent[i - 1], b = sent[i];
    if(J(a.system) !== J(b.system) || J(a.tools) !== J(b.tools)) { bad = `system/tools changed at call ${i}`; break; }
    if(b.messages.length < a.messages.length) { bad = `call ${i} is shorter`; break; }
    const k = a.messages.findIndex((m, j) => J(m) !== J(b.messages[j]));
    if(k >= 0) { bad = `call ${i}: messages[${k}] changed`; break; }
  }
  ok(`${label}: 每次 request 都是上一次的延伸 (前綴不變)`, !bad, bad);
}

const IMG = {mediaType: 'image/png', data: 'AAAA'};
const TOOLS = [{name: 'snapshot', description: 's', parameters: {type: 'object', properties: {}}, timeout: 60000}];
const runTool = () => Promise.resolve({text: 'report', image: IMG});

// anthropic 罐頭: 帶 thinking (簽章) 的 tool_use, 再收尾
const aTool = (id) => ({stop_reason: 'tool_use', content: [
  {type: 'thinking', thinking: '', signature: `sig-${id}`},
  {type: 'tool_use', id, name: 'snapshot', input: {image: true}}
]});
const aDone = (t) => ({stop_reason: 'end_turn', content: [
  {type: 'thinking', thinking: '', signature: `sig-${t}`}, {type: 'text', text: t}
]});

console.log('\n[anthropic]');
{
  const sent = stubFetch([aTool('tu_1'), aDone('one'), aTool('tu_2'), aTool('tu_3'), aDone('two')]);
  const s = anthropic({system: 'sys', tools: TOOLS, api: '/api/agent', model: 'claude-opus-5-5', runTool});
  await s.send('第一輪', {context: '狀況 1'});
  const before = J(s.getHistory());
  await s.send('第二輪', {context: '狀況 2'});
  const after = s.getHistory();
  ok('上一輪的歷史沒被動過', J(after.slice(0, JSON.parse(before).length)) === before);
  checkPrefix('anthropic', sent);

  const last = J(sent[sent.length - 1].messages);
  ok('舊的 context 留著 (沒換成佔位)', last.includes('狀況 1') && last.includes('狀況 2'));
  ok('兩份 context 都在, 各自標了 tag', last.split(`"text":"${CONTEXT_TAG}`).length - 1 === 2);
  ok('context 講明以最新一份為準', /以最新一份為準/.test(last));
  ok('舊圖沒被換掉', !last.includes(IMAGE_OMITTED) && (last.match(/"type":"image"/g) || []).length === 3);
  ok('thinking 原樣送回', last.includes('sig-tu_1') && last.includes('sig-one'));
  ok('top-level 自動快取', J(sent[0].cache_control) === J({type: 'ephemeral'}));
  ok('system 的快取點還在', sent[0].system[0].cache_control && sent[0].system[0].cache_control.type === 'ephemeral');
  ok('host tool 的 timeout 沒送上去', !J(sent[0].tools).includes('timeout'));
}

console.log('\n[anthropic: 圖的上限]');
{
  // maxImages 2: 第三張圖進來之後, 下一次呼叫前一次重建
  const sent = stubFetch([aTool('tu_1'), aTool('tu_2'), aTool('tu_3'), aTool('tu_4'), aDone('done')]);
  const s = anthropic({system: 'sys', tools: TOOLS, api: '/api/agent', model: 'claude-opus-5-5', runTool, maxImages: 2});
  const held = s.getHistory();
  await s.send('畫', {});
  const imgs = (i) => (J(sent[i].messages).match(/"type":"image"/g) || []).length;
  ok('上限內照常累積', imgs(1) === 1 && imgs(2) === 2, `${imgs(1)}, ${imgs(2)}`);
  ok('超過時重建成只留最新一張', imgs(3) === 1, imgs(3));
  ok('重建時舊圖換成佔位', J(sent[3].messages).includes(IMAGE_OMITTED));
  ok('重建時 thinking 全部丟掉 (綁著舊前綴)', !J(sent[3].messages).includes('"type":"thinking"'));
  ok('重建後又是 append-only', imgs(4) === 2);
  checkPrefix('重建之後', sent, 3);
  ok('重建不動原本的物件', J(held).includes('sig-tu_1'));
}

console.log('\n[openai]');
{
  const call = (id) => ({choices: [{message: {role: 'assistant', content: null, tool_calls: [
    {id, type: 'function', function: {name: 'snapshot', arguments: '{"image":true}'}}
  ]}}]});
  const done = (t) => ({choices: [{message: {role: 'assistant', content: t}}]});
  const sent = stubFetch([call('c1'), done('one'), call('c2'), call('c3'), done('two')]);
  const s = openai({system: 'sys', tools: TOOLS, api: '/api/agent', model: 'gpt-5', runTool});
  await s.send('第一輪', {context: '狀況 1'});
  const before = J(s.getHistory());
  await s.send('第二輪', {context: '狀況 2'});
  ok('上一輪的歷史沒被動過', J(s.getHistory().slice(0, JSON.parse(before).length)) === before);
  checkPrefix('openai', sent);
  const last = J(sent[sent.length - 1].messages);
  ok('舊的 context 留著', last.includes('狀況 1') && last.includes('狀況 2'));
  ok('舊圖沒被換掉', !last.includes(IMAGE_OMITTED) && (last.match(/image_url/g) || []).length === 6, (last.match(/image_url/g) || []).length);
  ok('host tool 的 timeout 沒送上去', !J(sent[0].tools).includes('timeout'));

  // 上限
  const sent2 = stubFetch([call('c1'), call('c2'), call('c3'), done('x')]);
  const o = openai({system: 'sys', tools: TOOLS, api: '/api/agent', model: 'gpt-5', runTool, maxImages: 2});
  await o.send('畫', {});
  const n = (i) => (J(sent2[i].messages).match(/"type":"image_url"/g) || []).length;
  ok('超過上限時重建成只留最新一張', n(2) === 2 && n(3) === 1, `${n(2)}, ${n(3)}`);
}

console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
