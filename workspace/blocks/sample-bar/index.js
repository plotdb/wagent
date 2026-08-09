module.exports = {
  pkg: {
    name: "@workspace/sample-bar",
    description: "每月銷售額長條圖 (Chart.js), 讀取 data/sales.csv"
  },
  init: function({root, ctx}) {
    return ctx.loadText('data/sales.csv').then(function(text) {
      var rows = ctx.d3.csvParse(text);
      var canvas = document.createElement('canvas');
      canvas.style.maxHeight = '400px';
      root.appendChild(canvas);
      new ctx.Chart(canvas, {
        type: 'bar',
        data: {
          labels: rows.map(function(r) { return r.month; }),
          datasets: [{
            label: 'Revenue',
            data: rows.map(function(r) { return +r.revenue; }),
            backgroundColor: '#2b6cb0'
          }]
        },
        options: {responsive: true, maintainAspectRatio: false}
      });
    });
  }
};
