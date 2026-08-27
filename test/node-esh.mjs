/*
 * Node 端驗收: esh 0.5.0 的 node-zenfs entry —— chroot + passthrough + device
 * 三個一起。這是「wagent 跑在 Node 上」的地基: 同一份 runtime 語意, 只是 fs
 * 後端從 OPFS 換成真磁碟。
 *
 * 為什麼這三個要一起測: 它們各自都好用, 但組起來才是實際形狀 ——
 * agent 被關在 chroot 裡、workspace 是真磁碟的一個子目錄 (passthrough)、
 * 應用層資料以 device 檔案餵進去。任何一個在組合下破功, 這條路就不通。
 *
 * 跑: node test/node-esh.mjs
 */
import {createShell} from '@plotdb/esh/node-zenfs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if(cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra === undefined ? '' : ` — ${extra}`}`); }
};
const eq = (name, actual, expect) => ok(name, actual === expect, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expect)}`);

const disk = fs.mkdtempSync(path.join(os.tmpdir(), 'wagent-esh-'));
fs.mkdirSync(path.join(disk, 'workspace/blocks/hello'), {recursive: true});
fs.writeFileSync(path.join(disk, 'workspace/blocks/hello/index.html'), '<div>hi</div>');

// 應用層是真相, device 只是把值交出去 —— 跟瀏覽器端同一條規則
let sheet = {rows: 3};
const sh = await createShell({
  root: '/home/workspace',
  mounts: {
    '/home/workspace': {backend: 'passthrough', path: path.join(disk, 'workspace')},
    '/home/workspace/dev': {
      backend: 'device',
      files: {sheet: {read: () => JSON.stringify(sheet), write: (s) => { sheet = JSON.parse(s); }}}
    }
  }
});

console.log('\n[chroot]');
const pwd = await sh.run('pwd');
eq('root 就是 /', (pwd.stdout || '').trim(), '/');
const esc = await sh.run('ls /');
ok('/ 看到的是 workspace 的內容', /blocks/.test(esc.stdout || ''), esc.stdout);
const up = await sh.run('ls ../../..');
ok('.. 爬不出去 (內容仍是 root)', /blocks/.test(up.stdout || ''), up.stdout);
ok('chroot 外的真磁碟路徑看不到', !/wagent-esh-/.test(up.stdout || ''), up.stdout);

console.log('\n[passthrough]');
eq('讀得到預先放在磁碟的檔案', await sh.io.readFile('/blocks/hello/index.html'), '<div>hi</div>');
await sh.io.writeFile('/blocks/clock/index.html', '<div>clock</div>');
eq('shell 寫入真的落到磁碟',
  fs.readFileSync(path.join(disk, 'workspace/blocks/clock/index.html'), 'utf8'), '<div>clock</div>');
fs.writeFileSync(path.join(disk, 'workspace/blocks/hello/note.txt'), 'outside\n');
eq('磁碟端的變更 shell 立刻看得到', await sh.io.readFile('/blocks/hello/note.txt'), 'outside\n');
const app = await sh.run('echo more >> /blocks/hello/note.txt');
eq('append 不清空 (0.5.0 修的上游 bug)', (await sh.io.readFile('/blocks/hello/note.txt')).trim(), 'outside\nmore');
eq('append 的 exit code', app.code, 0);

console.log('\n[readdir / stat]');
const entries = await sh.io.readdir('/blocks', {withFileTypes: true});
const names = entries.map(e => e.name).sort();
eq('readdir 列出兩個 block', JSON.stringify(names), JSON.stringify(['clock', 'hello']));
ok('目錄標成目錄', entries.every(e => e.isDirectory));
fs.mkdirSync(path.join(disk, 'workspace/blocks/emptyone'));
const withEmpty = await sh.io.readdir('/blocks', {withFileTypes: true});
ok('空目錄不被誤判成檔案', withEmpty.find(e => e.name === 'emptyone')?.isDirectory === true);
const st = await sh.io.stat('/blocks/hello/index.html');
eq('stat.size', st.size, 13);
ok('stat 形狀是純 JSON', st.isFile === true && st.isDirectory === false && typeof st.mtimeMs === 'number');

console.log('\n[device]');
eq('device 讀到應用層的當下值', (await sh.io.readFile('/dev/sheet')).trim(), '{"rows":3}');
sheet = {rows: 7};
eq('應用層改了值, 下次讀就是新的', (await sh.io.readFile('/dev/sheet')).trim(), '{"rows":7}');
const cat = await sh.run('cat /dev/sheet');
eq('shell 指令也讀得到 device', (cat.stdout || '').trim(), '{"rows":7}');
await sh.io.writeFile('/dev/sheet', '{"rows":9}');
eq('寫 device 打回應用層', sheet.rows, 9);
// device 是 callback 支撐的, 值不該落到磁碟。掛載點目錄本身存在無妨 ——
// 有內容才是問題 (那代表寫進去的東西被 passthrough 接走了)。
const devOnDisk = path.join(disk, 'workspace/dev');
ok('device 的值不落到磁碟',
  !fs.existsSync(devOnDisk) || fs.readdirSync(devOnDisk).length === 0,
  fs.existsSync(devOnDisk) ? JSON.stringify(fs.readdirSync(devOnDisk)) : 'n/a');

console.log('\n[symlink 圍堵]');
const secret = path.join(disk, 'secret.txt');
fs.writeFileSync(secret, 'do not read');
fs.symlinkSync(secret, path.join(disk, 'workspace/blocks/leak'));
let leaked = null;
try { leaked = await sh.io.readFile('/blocks/leak'); } catch(e) { leaked = `ERR ${e.code || e.message}`; }
ok('指向 jail 外的 symlink 讀不到', !String(leaked).includes('do not read'), leaked);
const ln = await sh.run('ln -s /../../../etc/passwd /blocks/leak2');
ok('shell 內建立指外的 symlink 被擋或無效', ln.code !== 0 || !fs.existsSync(path.join(disk, 'workspace/blocks/leak2')), JSON.stringify(ln));

fs.rmSync(disk, {recursive: true, force: true});
console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
