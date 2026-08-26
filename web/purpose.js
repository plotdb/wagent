// 領域 prompt —— **應用層的東西**,由 server.js 以 wagent 的 `purpose` 代入。
//
// wagent 本身不認得任何領域: 沒給 purpose 就是一個純粹的 block 編輯環境。
// 這個 sample 想做的是「一個 block、看得到、可以改」, 所以這裡只說明
// 這個應用的目錄約定與資料怎麼來 —— 判準是「一個拿 wagent 做遊戲的人
// 用不到的東西, 就不該寫進 wagent」。
module.exports = `這個環境一次只編輯**一個** block。

Workspace 結構 (這個應用的約定; wagent 本身不規定目錄怎麼分):
 - index.html — 你要編輯的 block, 就這一個檔案。不要建別的 block。

資料: 執行環境會把 opt.data 注入給 block:
 - opt.data.rows: [{label, value}, ...] — 由應用層提供的示範資料

畫圖直接用 opt.data.rows, 不要 fetch、不要讀檔、不要假設任何檔案路徑 ——
這樣的 block 換個環境、換份資料就能跑。

執行環境已載入 window.Chart (Chart.js v4), 需要圖表時可以直接用;
純 DOM / SVG / canvas 的東西也完全可以, 不必勉強用函式庫。`;
