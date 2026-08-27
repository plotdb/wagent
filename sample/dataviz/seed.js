// workspace 的初始內容 —— **應用層的東西**。
//
// 這份原本在 packages/wagent 的 agent-worker 裡, 開機就種進每個 workspace。
// 但「新使用者第一次看到什麼」是領域決定:一個拿 wagent 做遊戲或 web component 的人
// 不需要一張長條圖。判準跟資料、跟 prompt 的 purpose 是同一條。
//
// 內容也順著改了:舊的範例讀 data/sales.csv (opt.data.loadText),
// 那是我們已經不再教的寫法。現在示範的是目前的資料流 —— 資料由應用層注入,
// block 只認 opt.data.rows,所以它一放進去就跟著試算表連動。

const SAMPLE = `<div>
  <div class="wrap"><canvas></canvas></div>
  <style>
    .wrap { height: 400px; }
  </style>
  <script type="@plotdb/block">
    module.exports = {
      pkg: {
        name: 'sample-bar',
        version: 'main',
        description: '長條圖範例 — 資料來自試算表 (opt.data.rows), 不讀檔'
      },
      init: function(opt) {
        var self = this;
        var canvas = opt.root.querySelector('canvas');
        this.draw = function(v) {
          var rows = (v && v.rows) || [];
          return {
            labels: rows.map(function(r) { return r.label; }),
            values: rows.map(function(r) { return r.value; })
          };
        };
        var d = this.draw(opt.data);
        this.chart = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: d.labels,
            datasets: [{label: 'value', data: d.values, backgroundColor: '#2b6cb0'}]
          },
          options: {responsive: true, maintainAspectRatio: false}
        });
      },
      // 資料變動時就地更新, 不必整個重建 (沒實作的話執行環境會 fallback 重掛)
      client: function() {
        var self = this;
        return {
          data: function(v) {
            var d = self.draw(v);
            self.chart.data.labels = d.labels;
            self.chart.data.datasets[0].data = d.values;
            self.chart.update();
          }
        };
      }
    };
  <\/script>
</div>
`;

// io: {loadText, writeText}。只在檔案不存在時種 —— 使用者既有的東西不可蓋。
export function seed(io) {
  return io.loadText('blocks/sample-bar/index.html')
    .then(function() { return {seeded: false}; })
    .catch(function() {
      return io.writeText('blocks/sample-bar/index.html', SAMPLE)
        .then(function() { return {seeded: true}; });
    });
}
