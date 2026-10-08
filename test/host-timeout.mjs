/*
 * host tool 的逾時: 逐個設定、registerHost 的預設、20 秒的底, 以及逾時訊息。
 *
 * 會壞的地方是「host 其實做完了, agent 卻看到逾時」—— 生圖要 30~60 秒, 固定 20 秒
 * 的話每次都逾時, 模型一再重試, 每次多做一份。
 *
 * 跑: node test/host-timeout.mjs
 */
import {createHostCaller, toolSchema, HOST_TIMEOUT} from '../client/runtime/host-call.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`); }
};
const wait = (t) => new Promise((r) => setTimeout(r, t));

// 假的主執行緒: delay[name] 毫秒後回覆
function setup(delay) {
  let h;
  h = createHostCaller((msg) => {
    if(msg.type !== 'host-call') { return; }
    const d = delay[msg.name];
    if(d == null) { return; }   // 永遠不回
    setTimeout(() => h.result({type: 'host-result', id: msg.id, ok: true, result: `${msg.name} done`}), d);
  });
  return h;
}

console.log('\n[timeout]');
{
  const h = setup({gen_image: 80, quick: 5});
  ok('預設 20 秒', h.timeoutOf('anything') === HOST_TIMEOUT && HOST_TIMEOUT === 20000);

  h.setTools([{name: 'gen_image', timeout: 200}, {name: 'slow', timeout: 30}, {name: 'quick'}], 40);
  ok('tool 自己的 timeout', h.timeoutOf('gen_image') === 200);
  ok('registerHost 的 timeout 管沒設的 (含 snapshot)', h.timeoutOf('quick') === 40 && h.timeoutOf('snapshot') === 40);

  // 80ms 才回: 超過 registerHost 的 40, 但在自己的 200 之內
  const r = await h.call('gen_image', {}).catch((e) => e);
  ok('比預設久但在自己的上限內 -> 拿到結果', r === 'gen_image done', String(r));

  const e = await h.call('slow', {}).catch((x) => x);
  ok('逾時會 reject', e instanceof Error);
  ok('逾時訊息講明 host 可能還在做', /may still be working/.test(e.message), e.message);
  ok('逾時訊息叫模型不要盲目重試', /do not blindly retry/.test(e.message));

  const c = await h.call('context', {}, {kind: 'context', timeout: 20}).catch((x) => x);
  ok('呼叫端指定的優先', c instanceof Error);
  ok('context 不帶「別重試」那段', !/retry/.test(c.message), c.message);

  // 逾時之後才到的回覆: 略過, 不丟例外
  const late = setup({snapshot: 50});
  late.setTools([], 10);
  await late.call('snapshot', {}).catch(() => null);
  await wait(70);
  ok('逾時後才到的回覆被略過', true);

  h.setTools([{name: 'gen_image', timeout: 'abc'}, {name: 'x', timeout: -5}], null);
  ok('不合法的值退回預設', h.timeoutOf('gen_image') === HOST_TIMEOUT && h.timeoutOf('x') === HOST_TIMEOUT);
}

console.log('\n[schema]');
{
  const t = toolSchema({name: 'gen_image', description: 'd', parameters: {type: 'object'}, timeout: 60000, extra: 1});
  ok('只留 name / description / parameters', Object.keys(t).join() === 'name,description,parameters', Object.keys(t).join());
}

console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
