// lderror 相容的錯誤形狀 (後端)。
//
// 不相依 lderror 套件, 而是用它自己 README 認可的 duck type:
//
//     Object.assign(new Error(), {id: 1000, name: 'lderror'})
//
// 理由: wagent 的另一半跑在瀏覽器 worker 裡, 而那邊是直接送原始 ES module 出去
// 的 (沒有打包步驟)。兩邊要用同一組 id, 所以取兩邊都成立的最小交集。
//
// **這份與 web/runtime/lderr.js 必須一致** — test/lderr.mjs 會檢查。
// 分成兩份是因為模組系統不同 (這裡 CJS, 那裡 ESM), 不是因為它們可以分岔。

// 100~599 保留給 http code; 1000~ 是 lderror 內建; 10000~29999 保留給自訂。
// 內建的能用就用內建的 — 那些 id 在整個 servebase 生態裡是同一個意思。
const ID = {
  QUOTA: 1004,        // lderror 內建 'quota exceeded'
  THROTTLED: 1024,    // lderror 內建 'limited by throttling'
  ABORT: 1047,        // lderror 內建 'abort'
  TRUNCATED: 10001    // wagent 自訂: 模型回應超過長度上限被截斷
};

const MESSAGE = {
  1004: 'quota exceeded',
  1024: 'limited by throttling',
  1047: 'abort',
  10001: 'response truncated'
};

// servebase 的 error-handler 用 490 表示「這是一個 lderror, 細節在 body」——
// lderror 的 id 空間跟 HTTP 4xx/5xx 沒有一對一關係, 硬要對應就會把好幾種不同
// 的情況擠進同一個 code。
const HTTP = 490;

function make(id, message) {
  const e = new Error(message || MESSAGE[id] || 'lderror');
  e.id = id;
  e.name = 'lderror';
  return e;
}

// 送給前端的 body。形狀與 lderror 物件本身一致, 所以前端拿到之後
// 可以直接 duck type 判斷, 不必比對訊息字串。
function body(id, message, extra) {
  return Object.assign({id: id, name: 'lderror', message: message || MESSAGE[id] || 'lderror'},
    extra || {});
}

module.exports = {ID, MESSAGE, HTTP, make, body};
