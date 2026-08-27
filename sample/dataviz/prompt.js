// 資料視覺化的領域 prompt。以 @plotdb/wagent 的 `purpose` 代入。
//
// 這裡的內容之所以不能放進 wagent:它假設了執行環境載入了 d3 與 Chart.js、
// 假設了有一張試算表、假設了 label/value/series 這組維度 —
// 那全是「這個應用」的選擇。一個拿 wagent 做遊戲或 web component 的人,
// 這整段對他都是雜訊。
const PURPOSE = `目前的任務領域是資料視覺化 — block 的目的是把「執行環境餵進來的資料」畫成圖表。

Workspace 結構 (這個應用的約定; wagent 本身不規定目錄怎麼分):
 - blocks/<block-name>/index.html — 一個目錄一個 block, 新增時目錄名用簡短英文 kebab-case
 - dev/sheet — 試算表的唯讀鏡像 (csv), 見下方

資料從哪裡來:**不要讀檔**。使用者在頁面上的試算表裡編輯資料,
執行環境會把解析好的結果直接注入 opt.data:

 - opt.data.columns: 欄位定義 [{key, name, type, desc}]
 - opt.data.rows:    資料 [{label: '2026-01', value: 128, series: 'A'}, ...]
                     type 為 number 的欄位已經是 number, 不必自己轉

試算表的欄位是固定的 (label / value / series), 每一欄對應一個視覺化維度。
畫圖時直接用 opt.data.rows,不要 fetch、不要 loadText、不要假設任何檔案路徑 —
這樣的 block 換個環境、換份資料就能跑。

使用者改試算表時,執行環境會把新資料送過來。預設是整個 block 重新建立 —
簡單但會丟掉內部狀態 (動畫重來、選取狀態消失), 資料大也慢。

想要增量更新就實作 client 的 data:

    client: function() {
      return {
        data: function(v) {
          // v 與 opt.data 同格式 {columns, rows}; 更新既有的圖表即可
          // 回 Promise 的話執行環境會等它完成
        }
      };
    }

有實作就只呼叫它、不重建;沒實作就 fallback 重建, 兩種都能運作。

要看目前的資料:試算表以唯讀檔案 dev/sheet 呈現 (csv),用 run_shell 直接查:
cat dev/sheet、head -3 dev/sheet、wc -l dev/sheet、grep ... dev/sheet 都可以。
要改資料:用 write_sheet (整份 csv,第一列是表頭)。dev/sheet 是唯讀的,寫它會失敗。
使用者可能已經有自己的資料了,動手覆蓋前先看一眼。

執行環境已載入全域函式庫:
 - window.d3: d3 v7
 - window.Chart: Chart.js v4

視覺化規則:
 - 用 Chart.js 時,在 block HTML 裡放 <canvas>,init 時 opt.root.querySelector('canvas') 取得後 new Chart(canvas, config)。
 - 給 canvas 的外層容器固定高度 (例如 400px),Chart 設 maintainAspectRatio: false。
 - 用 d3 時直接在 opt.root 裡建 svg,寬度可用 opt.root.clientWidth。`;

module.exports = PURPOSE;
