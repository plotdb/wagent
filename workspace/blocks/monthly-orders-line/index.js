module.exports = {
  pkg: {
    name: "@workspace/monthly-orders-line",
    description: "以 Chart.js 繪製各月訂單數長條圖（bar），來源 data/sales.csv"
  },
  init: function({root, ctx}) {
    root.innerHTML = "";
    if (!root.style.height) root.style.height = "400px";
    var canvas = document.createElement("canvas");
    root.appendChild(canvas);
    return ctx.loadText("data/sales.csv").then(function(txt) {
      var rows = ctx.d3.csvParse(txt);
      var labels = rows.map(function(d) { return d.month; });
      var data = rows.map(function(d) { return +d.orders; });
      var avg = data.length ? data.reduce(function(a, b) { return a + b; }, 0) / data.length : 0;
      new ctx.Chart(canvas, {
        type: "bar",
        data: {
          labels: labels,
          datasets: [{
            label: "訂單數",
            data: data,
            backgroundColor: "#3b82f6",
            borderColor: "#1d4ed8",
            borderWidth: 1
          }, {
            type: "line",
            label: "平均值",
            data: labels.map(function() { return avg; }),
            borderColor: "#6b7280",
            borderDash: [6, 6],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            title: { display: true, text: "各月訂單數（Bar）" },
            tooltip: {
              callbacks: {
                label: function(ctxp) {
                  return (ctxp.dataset && ctxp.dataset.label ? ctxp.dataset.label : "值") + ": " + ctxp.parsed.y;
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: "月份" },
              grid: { display: false }
            },
            y: {
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