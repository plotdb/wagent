// 資料視覺化的領域 prompt。以 @plotdb/wagent 的 `purpose` 代入。
//
// 這裡的內容之所以不能放進 wagent:它假設了執行環境載入了 d3 與 Chart.js,
// 而那是「這個應用」的選擇。一個拿 wagent 做遊戲或 web component 的人,
// 這整段對他都是雜訊。
const PURPOSE = `目前的任務領域是資料視覺化 — block 的目的是讀取資料檔並繪製圖表。

執行環境已載入全域函式庫:
 - window.d3: d3 v7 (CSV 解析可用 d3.csvParse)
 - window.Chart: Chart.js v4

視覺化規則:
 - 用 Chart.js 時,在 block HTML 裡放 <canvas>,init 時 opt.root.querySelector('canvas') 取得後 new Chart(canvas, config)。
 - 給 canvas 的外層容器固定高度 (例如 400px),Chart 設 maintainAspectRatio: false。
 - 用 d3 時直接在 opt.root 裡建 svg,寬度可用 opt.root.clientWidth。`;

module.exports = PURPOSE;
