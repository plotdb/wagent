// lderror 相容的錯誤形狀 (前端)。
//
// 不相依 lderror 套件, 而是用它自己 README 認可的 duck type:
//
//     Object.assign(new Error(), {id: 1000, name: 'lderror'})
//
// 這一份跑在 worker 裡, 而 runtime/ 是直接以原始 ES module 送出去的 (沒有打包
// 步驟), 所以多一個相依就多一個要處理的載入路徑。
//
// **這份與 api/lderr.js 必須一致** — test/lderr.mjs 會檢查。
// 分成兩份是因為模組系統不同, 不是因為它們可以分岔。

export const ID = {
  QUOTA: 1004,        // lderror 內建 'quota exceeded'
  THROTTLED: 1024,    // lderror 內建 'limited by throttling'
  ABORT: 1047,        // lderror 內建 'abort'
  TRUNCATED: 10001    // wagent 自訂: 模型回應超過長度上限被截斷
};

export const MESSAGE = {
  1004: 'quota exceeded',
  1024: 'limited by throttling',
  1047: 'abort',
  10001: 'response truncated'
};

export function make(id, message) {
  const e = new Error(message || MESSAGE[id] || 'lderror');
  e.id = id;
  e.name = 'lderror';
  return e;
}

// 從任意錯誤 / 已解析的 body 取出 id。不是 lderror 就回 0 —— 與 lderror 套件的
// lderror.id() 同一個約定, 呼叫端不必先判斷型別。
export function idOf(e) {
  return (e && e.name === 'lderror' && !isNaN(+e.id)) ? +e.id : 0;
}
