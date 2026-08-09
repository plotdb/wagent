module.exports = {
  pkg: {
    name: "@workspace/monthly-orders-grouped-bar",
    description: "以 Chart.js 繪製各月訂單數群組長條圖，來源 data/orders_grouped.csv（三組/每月）"
  },
  init: function({root, ctx}) {
    root.innerHTML = "";
    if (!root.style.height) root.style.height = "420px";
    var canvas = document.createElement("canvas");
    root.appendChild(canvas);
    return ctx.loadText("data/orders_grouped.csv").then(function(txt) {
      var rows = ctx.d3.csvParse(txt);
      if (!rows || !rows.length) return Promise.resolve();
      var labels = rows.map(function(d) { return d.month; });
      var keys = Object.keys(rows[0]).filter(function(k) { return k !== 'month'; });
      var colors = ["#60a5fa", "#34d399", "#f59e0b", "#f87171", "#a78bfa", "#f472b6"];
      var labelMap = { g1: "群組 1", g2: "群組 2", g3: "群組 3" };
      var datasets = keys.map(function(k, i) {
        return {
          label: labelMap[k] || k,
          data: rows.map(function(r) { return +r[k]; }),
          backgroundColor: colors[i % colors.length],
          borderColor: colors[i % colors.length],
          borderWidth: 1
        };
      });
      new ctx.Chart(canvas, {
        type: "bar",
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            title: { display: true, text: "各月訂單數（群組長條圖）" },
            tooltip: {
              callbacks: {
                label: function(p) { return p.dataset.label + ": " + p.parsed.y; }
              }
            }
          },
          scales: {
            x: {
              stacked: false,
              title: { display: true, text: "月份" }
            },
            y: {
              stacked: false,
              beginAtZero: true,
              title: { display: true, text: "訂單數" }
            }
          }
        }
      });
      return Promise.resolve();
    });
  }
};