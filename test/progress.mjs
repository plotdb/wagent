/*
 * LLM 呼叫的進度回報 ( client/runtime/progress.js )。
 *
 * 用假的 SSE 串流 ( 不打真的 API ) 驗:
 *  - phase 轉換: waiting -> thinking -> text -> tool -> done
 *  - tool 名稱、從參數開頭抓到的 target
 *  - inTokens: 先估, 收到 usage 後換成實際值 ( anthropic 含快取 )
 *  - done 帶 API 回報的 output tokens; 失敗時送 error
 *  - 節流: delta 很密時事件數遠少於 delta 數
 *  - 進度不進歷史
 *
 * 跑: node test/progress.mjs
 */
import {createSession as anthropic} from '../client/runtime/providers/anthropic.js';
import {createSession as openai} from '../client/runtime/providers/openai.js';
import {createProgress, estimate, countChars, estimateRequest} from '../client/runtime/progress.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`); }
};

const sse = (events) => events.map((e) =>
  (e.event ? `event: ${e.event}\n` : '') + `data: ${typeof e === 'string' ? e : JSON.stringify(e.data)}\n\n`).join('');
// 每個 canned 回應是一段 SSE 字串, 或 {status, body} 表示錯誤
function stubFetch(responses) {
  let n = 0;
  globalThis.fetch = () => {
    const r = responses[n++];
    if(r == null) { return Promise.reject(new Error(`no canned response for call ${n}`)); }
    if(typeof r === 'object') { return Promise.resolve(new Response(r.body, {status: r.status})); }
    return Promise.resolve(new Response(r, {status: 200, headers: {'Content-Type': 'text/event-stream'}}));
  };
}
// 連續相同的 phase 合併, 看轉換順序
const phases = (evs) => evs.map((e) => e.phase).filter((p, i, a) => i === 0 || a[i - 1] !== p);

const TOOLS = [{name: 'write_file', description: 'w', parameters: {type: 'object', properties: {}}}];
const runTool = () => Promise.resolve('ok');

// ── anthropic ───────────────────────────────────────────────────────
const A = (type, data) => ({event: type, data: Object.assign({type}, data)});
const CHUNKS = 200;
const aTool = sse([
  A('message_start', {message: {usage: {input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 1}}}),
  A('content_block_start', {index: 0, content_block: {type: 'thinking', thinking: ''}}),
  A('content_block_delta', {index: 0, delta: {type: 'thinking_delta', thinking: '想一下'}}),
  A('content_block_delta', {index: 0, delta: {type: 'signature_delta', signature: 'sig'}}),
  A('content_block_stop', {index: 0}),
  A('content_block_start', {index: 1, content_block: {type: 'text', text: ''}}),
  A('content_block_delta', {index: 1, delta: {type: 'text_delta', text: 'ok, writing'}}),
  A('content_block_stop', {index: 1}),
  A('content_block_start', {index: 2, content_block: {type: 'tool_use', id: 'tu_1', name: 'write_file', input: {}}}),
  A('content_block_delta', {index: 2, delta: {type: 'input_json_delta', partial_json: '{"pa'}}),
  A('content_block_delta', {index: 2, delta: {type: 'input_json_delta', partial_json: 'th": "src/index.html", "content": "'}}),
  ...Array.from({length: CHUNKS}, () => A('content_block_delta', {index: 2, delta: {type: 'input_json_delta', partial_json: 'x'.repeat(40)}})),
  A('content_block_delta', {index: 2, delta: {type: 'input_json_delta', partial_json: '"}'}}),
  A('content_block_stop', {index: 2}),
  A('message_delta', {delta: {stop_reason: 'tool_use'}, usage: {output_tokens: 2345}}),
  A('message_stop', {})
]);
const aDone = sse([
  A('message_start', {message: {usage: {input_tokens: 5, cache_read_input_tokens: 1100, cache_creation_input_tokens: 0}}}),
  A('content_block_start', {index: 0, content_block: {type: 'text', text: ''}}),
  A('content_block_delta', {index: 0, delta: {type: 'text_delta', text: '完成'}}),
  A('content_block_stop', {index: 0}),
  A('message_delta', {delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 7}}),
  A('message_stop', {})
]);

console.log('\n[anthropic]');
{
  stubFetch([aTool, aDone]);
  const evs = [];
  let deltas = '';
  const s = anthropic({system: 'sys', tools: TOOLS, model: 'claude-opus-5-5', runTool});
  const r = await s.send('寫 index.html', {
    onDelta: (t) => { deltas += t; },
    onProgress: (p) => evs.push(p)
  });
  ok('回覆照常', r.reply === '完成' && deltas === 'ok, writing完成');
  const s1 = evs.filter((e) => e.step === 1), s2 = evs.filter((e) => e.step === 2);
  ok('phase 轉換 (step 1)', phases(s1).join() === 'waiting,thinking,text,tool,done', phases(s1).join());
  ok('phase 轉換 (step 2)', phases(s2).join() === 'waiting,text,done', phases(s2).join());
  ok('第一則是 waiting, 送出量是估計值', s1[0].phase === 'waiting' && s1[0].inEstimated === true && s1[0].inTokens > 0);
  ok('provider / model / startedAt', s1.every((e) => e.provider === 'anthropic' && e.model === 'claude-opus-5-5' && e.startedAt === s1[0].startedAt));
  const real = s1.find((e) => !e.inEstimated);
  ok('message_start 後改用實際送出量 (含快取)', real && real.inTokens === 1060 &&
    real.inDetail.cacheRead === 1000 && real.inDetail.cacheWrite === 50 && real.inDetail.input === 10, JSON.stringify(real));
  const tool = s1.filter((e) => e.phase === 'tool');
  ok('tool 名稱', tool.length && tool.every((e) => e.tool === 'write_file'));
  ok('target 從參數開頭抓到', tool.some((e) => e.target === 'src/index.html'), JSON.stringify(tool.map((e) => e.target)));
  const done = s1[s1.length - 1];
  const outChars = '想一下'.length + 'ok, writing'.length + '{"pa'.length +
    'th": "src/index.html", "content": "'.length + CHUNKS * 40 + 2;
  ok('done: outChars 是 text + thinking + tool 參數', done.phase === 'done' && done.outChars === outChars, `${done.outChars} vs ${outChars}`);
  ok('done: outTokens 是 API 回報的值', done.outTokens === 2345 && done.usage.output === 2345 && done.stopReason === 'tool_use');
  ok('outTokensEst 是估計 (ASCII ~4 字元/token)', done.outTokensEst > 1900 && done.outTokensEst < 2300, done.outTokensEst);
  ok('done 不帶 tool / target', done.tool === undefined && done.target === undefined);
  ok(`節流: ${CHUNKS} 個 delta 只送了 ${s1.length} 則`, s1.length < 15);
  ok('進度不進歷史', !JSON.stringify(s.getHistory()).includes('outChars'));
}

console.log('\n[anthropic: 失敗]');
{
  stubFetch([{status: 500, body: 'upstream down'}]);
  const evs = [];
  const s = anthropic({system: 'sys', tools: TOOLS, model: 'claude-opus-5-5', runTool});
  let err = null;
  await s.send('hi', {onProgress: (p) => evs.push(p)}).catch((e) => { err = e; });
  ok('send 照樣 reject', err && /500/.test(err.message));
  ok('送了 error, 帶訊息', phases(evs).join() === 'waiting,error' && /upstream down/.test(evs[evs.length - 1].error));
}

console.log('\n[anthropic: listener 丟例外不影響呼叫]');
{
  stubFetch([aDone]);
  const s = anthropic({system: 'sys', tools: TOOLS, model: 'claude-opus-5-5', runTool});
  const r = await s.send('hi', {onProgress: () => { throw new Error('ui bug'); }});
  ok('回覆照常', r.reply === '完成');
}

// ── openai ──────────────────────────────────────────────────────────
const O = (delta, extra) => ({data: Object.assign({choices: [{index: 0, delta}]}, extra || {})});
const oTool = sse([
  O({role: 'assistant', content: '好'}),
  O({tool_calls: [{index: 0, id: 'call_1', type: 'function', function: {name: 'write_file', arguments: ''}}]}),
  O({tool_calls: [{index: 0, function: {arguments: '{"path":"a\\/b.html",'}}]}),
  ...Array.from({length: 50}, () => O({tool_calls: [{index: 0, function: {arguments: 'y'.repeat(20)}}]})),
  {data: {choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}]}},
  {data: {choices: [], usage: {prompt_tokens: 900, completion_tokens: 321, prompt_tokens_details: {cached_tokens: 800}}}},
  '[DONE]'
]);
const oDone = sse([
  O({content: 'done'}),
  {data: {choices: [{index: 0, delta: {}, finish_reason: 'stop'}]}},
  '[DONE]'
]);

console.log('\n[openai]');
{
  stubFetch([oTool, oDone]);
  const evs = [];
  const s = openai({system: 'sys', tools: TOOLS, model: 'gpt-5', runTool});
  const r = await s.send('hi', {onDelta: () => {}, onProgress: (p) => evs.push(p)});
  ok('回覆照常', r.reply === 'done');
  const s1 = evs.filter((e) => e.step === 1);
  ok('phase 轉換', phases(s1).join() === 'waiting,text,tool,done', phases(s1).join());
  ok('tool 名稱與 target ( JSON 跳脫解開 )', s1.some((e) => e.tool === 'write_file' && e.target === 'a/b.html'));
  ok('整段呼叫期間 inTokens 是估計值', s1.filter((e) => e.phase !== 'done').every((e) => e.inEstimated));
  const done = s1[s1.length - 1];
  ok('done: 實際用量 ( prompt_tokens 含快取, 拆成 input + cacheRead )',
    done.inTokens === 900 && done.inDetail.input === 100 && done.inDetail.cacheRead === 800 &&
    done.outTokens === 321 && done.stopReason === 'tool_calls', JSON.stringify(done));
  const d2 = evs[evs.length - 1];
  ok('沒有 usage 的呼叫: done 仍送, inTokens 維持估計', d2.step === 2 && d2.phase === 'done' && d2.inEstimated && d2.outTokens === undefined);
}

// ── 估算與節流 ──────────────────────────────────────────────────────
console.log('\n[估算]');
{
  const c = countChars('abcd中文');
  ok('ASCII 4 字元 ≈ 1 token, CJK 1 字元 ≈ 1 token', estimate(c.ascii, c.other) === 3);
  const img = '"data":"' + 'A'.repeat(300000) + '"';
  ok('base64 圖不照字元算', estimateRequest(img) < 2000 && estimateRequest(img) >= 1600, estimateRequest(img));
}

console.log('\n[節流]');
{
  let t = 0;
  const evs = [];
  const p = createProgress({emit: (e) => evs.push(e), provider: 'x', model: 'm', now: () => t, interval: 250});
  p.begin();
  p.phase('text');
  for(let i = 0; i < 100; i++) { t += 10; p.out('abcd', 'text'); }   // 1 秒內 100 則
  ok(`1 秒 100 個 delta -> ${evs.length - 2} 則 (每 250ms 一則)`, evs.length - 2 === 4);
  p.out('x', 'thinking');
  ok('phase 改變立即送', evs[evs.length - 1].phase === 'thinking');
  p.done({output: 1});
  p.out('more', 'text');
  p.fail(new Error('late'));
  ok('done 之後不再送', evs[evs.length - 1].phase === 'done');
}

console.log(`\n${pass} passed, ${fail} failed`);
if(fail) { process.exit(1); }
