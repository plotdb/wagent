// headless renderer 的煙霧測試。
//
// 跑法: node packages/wagent-headless/test.js
// 環境變數 PW_EXEC 可指定 chromium 執行檔 (playwright-core 沒下載瀏覽器時)。

const fs = require('fs');
const path = require('path');
const {createRenderer} = require('./index.js');

const PLAIN = `<div>
  <div class="box">hello</div>
  <style>
    .box { height: 200px; background: #2b6cb0; color: #fff; font: 40px sans-serif; padding: 20px; }
  </style>
  <script type="@plotdb/block">
    module.exports = {
      pkg: {name: 'plain', version: 'main', description: '純 DOM, 不需要任何函式庫'},
      init: function(opt) {
        opt.root.querySelector('.box').textContent = 'rows: ' + ((opt.data && opt.data.rows) || []).length;
      }
    };
  <\/script>
</div>`;

const BLANK = `<div>
  <div class="box"></div>
  <style>.box { height: 0; }</style>
  <script type="@plotdb/block">
    module.exports = {pkg: {name: 'blank', version: 'main'}, init: function() {}};
  <\/script>
</div>`;

// 應用層的 block: 需要 Chart.js (由 opt.scripts 注入 — wagent 不內建函式庫)
const CHART = `<div>
  <div class="wrap"><canvas></canvas></div>
  <style>.wrap { height: 400px; }</style>
  <script type="@plotdb/block">
    module.exports = {
      pkg: {name: 'bar', version: 'main', description: 'Chart.js 長條圖'},
      init: function(opt) {
        var rows = (opt.data && opt.data.rows) || [];
        this.chart = new Chart(opt.root.querySelector('canvas'), {
          type: 'bar',
          data: {
            labels: rows.map(function(r) { return r.label; }),
            datasets: [{label: 'value', data: rows.map(function(r) { return r.value; }), backgroundColor: '#2b6cb0'}]
          },
          options: {responsive: true, maintainAspectRatio: false, animation: false}
        });
      }
    };
  <\/script>
</div>`;

const ROWS = [{label: 'A', value: 10}, {label: 'B', value: 80}, {label: 'C', value: 30}];

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${name}${cond ? '' : '  <- ' + JSON.stringify(detail)}`);
  if(!cond) { failed++; }
}

(async function() {
  const r = await createRenderer({
    launch: process.env.PW_EXEC ? {executablePath: process.env.PW_EXEC} : {},
    scripts: ['https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js']
  });

  try {
    // 1. 純 DOM block: 有畫出來, 而且拿得到 Node 餵進去的資料
    const a = await r.snapshot({name: 'plain', source: PLAIN, data: {rows: ROWS}});
    check('plain 有渲染', a.report.rendered === true, a.report);
    check('plain 不是空白', a.report.blank === false, a.report);
    check('plain 讀到 Node 餵的 data', (a.report.text || '').indexOf('rows: 3') >= 0, a.report.text);

    // 2. 空白偵測仍然有效 (報告不能對空畫面說謊)
    const b = await r.snapshot({name: 'blank', source: BLANK});
    check('blank 被抓到', b.report.blank === true || !!b.report.hint, b.report);

    // 3. Chart.js: 應用層注入的函式庫可用, canvas 有東西
    const c = await r.snapshot({name: 'bar', source: CHART, data: {rows: ROWS}});
    check('chart 有渲染', c.report.rendered === true, c.report);
    check('chart canvas 有筆墨', c.report.canvas && c.report.canvas.inkRatio > 0.01, c.report.canvas);

    // 4. 出圖走 CDP: 真的拿到 jpeg
    const d = await r.snapshot({name: 'bar', source: CHART, data: {rows: ROWS}, image: true});
    const buf = d.image && Buffer.from(d.image.data, 'base64');
    check('image 是 jpeg', !!buf && buf[0] === 0xff && buf[1] === 0xd8, d.image && d.image.mediaType);
    check('image 有尺寸', !!(d.image && d.image.width > 0 && d.image.height > 0), d.image);
    if(buf) {
      const out = path.join(__dirname, 'test-out.jpg');
      fs.writeFileSync(out, buf);
      console.log(`      (圖寫到 ${out}, ${Math.round(buf.length / 1024)} KB)`);
    }

    // 5. 換資料 -> 畫面要跟著變 (renderer 每次都重掛, 不該留上一張)
    const e = await r.snapshot({name: 'bar', source: CHART, data: {rows: [{label: 'Z', value: 999}]}});
    check('換資料後畫面有變', e.report.changedSinceLast !== false, e.report);

    // 6. 尺寸: 窄螢幕
    const f = await r.snapshot({name: 'bar', source: CHART, data: {rows: ROWS}, width: 375, height: 600});
    check('窄螢幕有渲染', f.report.rendered === true && f.report.size.width <= 375, f.report.size);
  } finally {
    await r.close();
  }

  console.log(failed ? `\n${failed} 個失敗` : '\n全部通過');
  process.exit(failed ? 1 : 0);
})().catch(function(e) {
  console.error('測試本身炸了:', e);
  process.exit(1);
});
