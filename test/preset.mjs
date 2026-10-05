/*
 * preset 的驗收: 「這是哪一種應用」只在 api 決定一次, prompt 與 tool 兩邊要對得上。
 *
 * 會壞的方式都很安靜:
 *  - block 的 prompt 被動到 —— 既有應用的行為悄悄改變, 沒有任何錯誤
 *  - plain 裡殘留 block 的字眼 —— 模型會以為自己該寫 HTML (這正是 preset 要解的問題)
 *  - api 回的 preset 名稱在 worker 查不到 —— 退回 block 的 snapshot, 模型去傳 host 不認得的參數
 *
 * 跑: node test/preset.mjs
 */
import {createRequire} from 'module';
import {toolsFor, SNAPSHOT_TOOLS, snapshotTool, plainSnapshotTool, tools} from '../client/runtime/tools.js';

const require = createRequire(import.meta.url);
const prompt = require('../api/prompt.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`); }
};

console.log('\n[prompt]');
{
  // 不給 preset 就是 block, 而且跟明講 block 完全一樣
  for(const [pur, blk] of [['', null], ['P', null], ['P', 'bar']]) {
    ok(`default === block (${JSON.stringify([pur, blk])})`, prompt.compose(pur, blk) === prompt.compose(pur, blk, 'block'));
  }
  const b = prompt.compose('PURPOSE', null, 'block');
  ok('block: 含 block 格式', b.includes('@plotdb/block'));
  ok('block: 含新增模式', b.includes('「新增」模式'));
  ok('block: 以 IO_BROWSER 結尾前接 purpose', b.indexOf('PURPOSE') > b.indexOf(prompt.IO_BROWSER));

  const p = prompt.compose('PURPOSE', 'bar', 'plain');
  ok('plain: 不提 block', !/block/i.test(p), p.match(/.{0,20}block.{0,20}/i));
  ok('plain: 沒有新增/編輯模式', !p.includes('模式'));
  ok('plain: 有檔案操作', p.includes(prompt.SHELL));
  ok('plain: purpose 在最後', p.endsWith('PURPOSE'));

  let err = null;
  try { prompt.preset('blocks'); } catch(e) { err = e; }
  ok('打錯字: 丟錯並列出可用的', err && /block, plain/.test(err.message), err && err.message);
}

console.log('\n[tools]');
{
  // api 那邊有的每個 preset, worker 都要找得到對應的 snapshot
  for(const k of Object.keys(prompt.PRESETS)) {
    ok(`SNAPSHOT_TOOLS 有 ${k}`, !!SNAPSHOT_TOOLS[k]);
  }
  const names = (list) => list.map((t) => t.name).join(',');
  ok('toolsFor(block) === 舊的 tools', JSON.stringify(toolsFor('block')) === JSON.stringify(tools));
  ok('toolsFor(undefined) 退回 block', toolsFor(undefined).includes(snapshotTool));
  ok('toolsFor(plain) 換掉 snapshot', toolsFor('plain').includes(plainSnapshotTool) && !toolsFor('plain').includes(snapshotTool));
  ok('兩者 tool 名稱相同', names(toolsFor('plain')) === names(toolsFor('block')));
  ok('plain snapshot 只有 image', Object.keys(plainSnapshotTool.parameters.properties).join() === 'image');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
