// api/lderr.js (CJS, 後端) 與 web/runtime/lderr.js (ESM, 前端) 必須一致。
//
// 分成兩份是因為模組系統不同 —— 後端是 CJS, 前端 runtime/ 是直接送原始 ES
// module 給瀏覽器 (沒有打包步驟)。不是因為它們可以分岔: id 分岔的話, 後端送
// 1004 而前端認 1005, 症狀是「額度用完但畫面顯示未知錯誤」, 而兩邊各自看起來
// 都對。所以這裡把它釘住。
import assert from 'node:assert';
import {createRequire} from 'node:module';
import * as web from '../packages/wagent/web/runtime/lderr.js';

const require = createRequire(import.meta.url);
const api = require('../packages/wagent/api/lderr.js');

const ok = (m) => console.log(`  ✓ ${m}`);
console.log('lderr');

assert.deepEqual(web.ID, api.ID, 'ID 表兩邊必須一致');
ok(`ID 一致: ${Object.entries(web.ID).map(([k, v]) => `${k}=${v}`).join(' ')}`);

assert.deepEqual(web.MESSAGE, api.MESSAGE, 'MESSAGE 表兩邊必須一致');
ok('MESSAGE 一致');

// duck type: lderror 套件用 name + id 判斷, 我們不相依它但要能被它認得
const e = api.make(api.ID.QUOTA);
assert.equal(e.name, 'lderror');
assert.equal(e.id, 1004);
assert.ok(e instanceof Error, '必須仍然是 Error — 丟出去要有 stack');
ok('make() 是 lderror duck type 且仍是 Error');

assert.equal(web.idOf(e), 1004);
assert.equal(web.idOf(new Error('plain')), 0, '不是 lderror 就回 0');
assert.equal(web.idOf(null), 0);
ok('idOf(): lderror 回 id, 其他一律 0');

const b = api.body(api.ID.QUOTA, '額度用完了', {balance: {left: -3}});
assert.equal(b.name, 'lderror');
assert.equal(b.id, 1004);
assert.deepEqual(b.balance, {left: -3}, 'extra 要帶得過去');
ok('body(): 形狀與 lderror 物件一致, 前端可直接 duck type');

// 490: lderror 的 id 空間跟 HTTP 4xx/5xx 沒有一對一關係
assert.equal(api.HTTP, 490);
ok('HTTP 490 (同 servebase 的 error-handler)');

console.log('all ok');
