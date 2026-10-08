/*
 * 每個掛載點的模型設定 + 對話中換模型。上游是假的 (不打真的 API)。
 *  - 不給新參數: /provider 的 provider / model 與 0.3.0 一樣 (只多了 providers)
 *  - 白名單: 掛載點各自的, 預設 model 自動放行, 沒帶 model 就填預設
 *  - 對話紀錄跨 provider 轉換後, 送出去的 body 配對仍完整
 *
 * 跑: node test/models.mjs
 */
import express from 'express';
import {createRequire} from 'node:module';
import {createSession as anthropic, thinkingFor} from '../client/runtime/providers/anthropic.js';
import {createSession as openai} from '../client/runtime/providers/openai.js';
import {toOpenAI, toAnthropic} from '../client/runtime/providers/convert.js';

const require = createRequire(import.meta.url);
const wagent = require('../api/index.js');
const proxy = require('../api/proxy.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`); }
};

for(const k of ['LLM_PROVIDER', 'ANTHROPIC_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_AUTH_TOKEN']) { delete process.env[k]; }
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.OPENAI_API_KEY = 'test-key';

console.log('\n[config]');
{
  const i = proxy.config({}).info();
  ok('預設: anthropic / claude-opus-4-8 (同 0.3.0)', i.provider === 'anthropic' && i.model === 'claude-opus-4-8', i);
  ok('舊的 proxy.info() 一樣', JSON.stringify(proxy.info()) === JSON.stringify(i));
  ok('providers 列出兩家', Object.keys(i.providers).join() === 'anthropic,openai');
  ok('預設白名單含 Claude 5', ['claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001']
    .every((m) => i.providers.anthropic.models.includes(m)));

  process.env.ANTHROPIC_MODEL = 'claude-opus-9';
  const e = proxy.config({}).info();
  ok('env 的 model 自動放行', e.model === 'claude-opus-9' && e.providers.anthropic.models.includes('claude-opus-9'));
  delete process.env.ANTHROPIC_MODEL;

  process.env.LLM_PROVIDER = 'openai';
  ok('LLM_PROVIDER 仍有效', proxy.config({}).info().provider === 'openai');
  ok('opt.provider 優先於 env', proxy.config({provider: 'anthropic'}).info().provider === 'anthropic');
  delete process.env.LLM_PROVIDER;

  const s = proxy.config({model: 'gpt-5-mini'}).info();
  ok('字串 model 找得到自己的 provider', s.providers.openai.model === 'gpt-5-mini' && s.providers.anthropic.model === 'claude-opus-4-8', s);
  const o = proxy.config({provider: 'openai', model: {openai: 'gpt-4.1', anthropic: 'claude-sonnet-5'}}).info();
  ok('物件 model 各自的預設', o.provider === 'openai' && o.model === 'gpt-4.1' && o.providers.anthropic.model === 'claude-sonnet-5', o);

  const d = proxy.config({models: {openai: false, anthropic: ['claude-sonnet-5']}}).info();
  ok('false 關掉 provider', !d.providers.openai);
  ok('白名單取代預設, 預設 model 補進去',
    d.providers.anthropic.models.join() === 'claude-opus-4-8,claude-sonnet-5', d.providers.anthropic.models);
  ok('擴充: wagent.models 可 concat', wagent.models.anthropic.includes('claude-opus-5-5'));

  delete process.env.OPENAI_API_KEY;
  ok('沒 key 的不列', !proxy.config({}).info().providers.openai);
  ok('指定的 provider 沒 key -> null (同 0.3.0)', proxy.config({provider: 'openai'}).info().provider === null);
  process.env.OPENAI_API_KEY = 'test-key';

  let err = null;
  try { wagent({provider: 'gemini'}); } catch(x) { err = x; }
  ok('打錯 provider: 掛載時就丟錯', !!err);
}

console.log('\n[proxy]');
{
  const seen = [];
  const up = express();
  up.use(express.json());
  up.post('/a', (req, res) => { seen.push(req.body); res.json({content: [], stop_reason: 'end_turn'}); });
  up.post('/o', (req, res) => { seen.push(req.body); res.json({choices: []}); });
  const u = await new Promise((r) => { const x = up.listen(0, () => r(x)); });
  proxy.providers.anthropic.url = `http://127.0.0.1:${u.address().port}/a`;
  proxy.providers.openai.url = `http://127.0.0.1:${u.address().port}/o`;

  const app = express();
  app.use(express.json());
  app.use('/plain', wagent({}));
  app.use('/custom', wagent({provider: 'openai', model: 'gpt-5-mini', models: {anthropic: ['claude-sonnet-5']}}));
  app.use('/only', wagent({models: {openai: false}}));
  const srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (path, body) => fetch(base + path, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)
  }).then((r) => r.status);
  const get = (path) => fetch(base + path).then((r) => r.json());

  const p1 = await get('/plain/provider');
  ok('/provider 預設', p1.provider === 'anthropic' && p1.model === 'claude-opus-4-8' && !!p1.providers.openai, p1);
  const p2 = await get('/custom/provider');
  ok('/provider 掛載點各自的', p2.provider === 'openai' && p2.model === 'gpt-5-mini' &&
    p2.providers.anthropic.models.join() === 'claude-opus-4-8,claude-sonnet-5', p2);

  ok('白名單內: 200', await post('/plain/llm/anthropic', {model: 'claude-sonnet-5', messages: []}) === 200);
  ok('白名單外: 400', await post('/plain/llm/anthropic', {model: 'claude-x', messages: []}) === 400);
  ok('別的掛載點的白名單不適用', await post('/custom/llm/anthropic', {model: 'claude-opus-5-5', messages: []}) === 400);
  seen.length = 0;
  await post('/custom/llm/openai', {messages: []});
  ok('沒帶 model: 填掛載點的預設', seen[0] && seen[0].model === 'gpt-5-mini', seen[0]);
  await post('/plain/llm/anthropic', {messages: []});
  ok('沒帶 model: anthropic 預設', seen[1] && seen[1].model === 'claude-opus-4-8', seen[1]);
  ok('關掉的 provider: 404', await post('/only/llm/openai', {model: 'gpt-5', messages: []}) === 404);
  ok('關掉的 provider 不出現在 /provider', !(await get('/only/provider')).providers.openai);

  srv.close(); u.close();
}

console.log('\n[thinking]');
{
  ok('opus 5.5 adaptive', !!thinkingFor('claude-opus-5-5'));
  ok('opus 4.8 adaptive', !!thinkingFor('claude-opus-4-8'));
  ok('sonnet 4.6 adaptive', !!thinkingFor('claude-sonnet-4-6'));
  ok('haiku 4.5 不送', thinkingFor('claude-haiku-4-5') === null && thinkingFor('claude-haiku-4-5-20251001') === null);
  ok('sonnet 4.5 不送', thinkingFor('claude-sonnet-4-5-20250929') === null);
}

// 每次呼叫回下一個罐頭回應, 並記下送出去的 body
function stubFetch(responses) {
  const sent = [];
  globalThis.fetch = (url, opt) => {
    sent.push({url, body: JSON.parse(opt.body)});
    const body = responses[sent.length - 1];
    return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(body)});
  };
  return sent;
}
const TOOLS = [{name: 'snapshot', description: 's', parameters: {type: 'object', properties: {}}}];
const IMG = {mediaType: 'image/png', data: 'AAAA'};

console.log('\n[同 provider 換模型]');
{
  const sent = stubFetch([
    {content: [{type: 'text', text: 'a'}], stop_reason: 'end_turn'},
    {content: [{type: 'text', text: 'b'}], stop_reason: 'end_turn'}
  ]);
  const s = anthropic({system: 'sys', tools: TOOLS, model: 'claude-opus-5-5', runTool: () => 'x'});
  await s.send('一');
  s.setModel('claude-haiku-4-5');
  await s.send('二');
  ok('第一輪用原本的', sent[0].body.model === 'claude-opus-5-5' && !!sent[0].body.thinking);
  ok('第二輪用新的, haiku 不帶 thinking', sent[1].body.model === 'claude-haiku-4-5' && !sent[1].body.thinking, sent[1].body.thinking);
  ok('對話沒清', sent[1].body.messages.length === 3, sent[1].body.messages.length);
}

console.log('\n[anthropic -> openai]');
{
  stubFetch([
    {content: [{type: 'thinking', thinking: '', signature: 's'}, {type: 'text', text: '看一下'},
      {type: 'tool_use', id: 'tu_1', name: 'snapshot', input: {image: true}}], stop_reason: 'tool_use'},
    {content: [{type: 'tool_use', id: 'tu_2', name: 'snapshot', input: {}}], stop_reason: 'tool_use'},
    {content: [{type: 'text', text: '好了'}], stop_reason: 'end_turn'}
  ]);
  const a = anthropic({system: 'sys', tools: TOOLS, model: 'claude-opus-5-5',
    runTool: () => ({text: 'report', image: IMG})});
  await a.send('畫一張圖', {context: '狀況'});
  const h = toOpenAI(a.getHistory());
  const sent = stubFetch([{choices: [{message: {role: 'assistant', content: 'ok'}, finish_reason: 'stop'}]}]);
  const o = openai({system: 'sys', tools: TOOLS, model: 'gpt-5', runTool: () => 'x', history: h});
  const r = await o.send('繼續');
  ok('openai 收尾', r.reply === 'ok');
  const m = sent[0].body.messages;
  ok('system 在最前, 只有一則', m[0].role === 'system' && m.filter((x) => x.role === 'system').length === 1);
  // 每個 tool_calls 後面緊接著它的 tool 訊息
  let paired = true;
  m.forEach((x, i) => {
    if(!x.tool_calls) { return; }
    x.tool_calls.forEach((c, j) => {
      const t = m[i + 1 + j];
      if(!t || t.role !== 'tool' || t.tool_call_id !== c.id) { paired = false; }
    });
  });
  ok('tool_calls 與 tool 訊息配對', paired, m.map((x) => x.role));
  ok('thinking 丟掉', !JSON.stringify(m).includes('signature'));
  const imgs = JSON.stringify(m).match(/image_url/g) || [];
  ok('圖只留最新一張', imgs.length === 2, imgs.length);   // type + key
  ok('context 佔位保留', JSON.stringify(m).includes('[application-context]'));
}

console.log('\n[openai -> anthropic]');
{
  stubFetch([
    {choices: [{message: {role: 'assistant', content: '', tool_calls: [
      {id: 'call_1', type: 'function', function: {name: 'snapshot', arguments: '{"image":true}'}},
      {id: 'call_2', type: 'function', function: {name: 'snapshot', arguments: '{}'}}
    ]}, finish_reason: 'tool_calls'}]},
    {choices: [{message: {role: 'assistant', content: '完成'}, finish_reason: 'stop'}]}
  ]);
  const o = openai({system: 'sys', tools: TOOLS, model: 'gpt-5', runTool: () => ({text: 'r', image: IMG})});
  await o.send('畫', {nudge: () => null});
  const h = toAnthropic(o.getHistory());
  const sent = stubFetch([{content: [{type: 'text', text: 'ok'}], stop_reason: 'end_turn'}]);
  const a = anthropic({system: 'sys', tools: TOOLS, model: 'claude-sonnet-5', runTool: () => 'x', history: h});
  await a.send('繼續');
  const m = sent[0].body.messages;
  ok('第一則是 user', m[0].role === 'user');
  ok('沒有 system role', !m.some((x) => x.role === 'system'));
  const ai = m.findIndex((x) => x.role === 'assistant' && x.content.some((b) => b.type === 'tool_use'));
  const ids = m[ai].content.filter((b) => b.type === 'tool_use').map((b) => b.id);
  const next = m[ai + 1];
  ok('tool_result 在下一則 user 的最前面',
    next.role === 'user' && ids.every((id, i) => next.content[i].type === 'tool_result' && next.content[i].tool_use_id === id),
    next.content.map((b) => b.type));
  ok('圖跟著過去 (只一張)', JSON.stringify(m).match(/"type":"image"/g).length === 1);
  ok('input 解回物件', m[ai].content.find((b) => b.type === 'tool_use').input.image === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
