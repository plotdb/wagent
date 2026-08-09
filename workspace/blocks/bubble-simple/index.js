module.exports = {
  pkg: {
    name: "@workspace/bubble-simple",
    description: "Read data/sales.csv and draw a bubble chart: x=month, y=revenue, size=orders"
  },
  init: function({root, ctx}) {
    var d3 = ctx.d3;
    root.innerHTML = "";
    var canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "400px";
    root.appendChild(canvas);

    return ctx.loadText("data/sales.csv").then(function(txt) {
      var rows = d3.csvParse(txt);
      var months = [];
      var points = [];
      var ordersList = [];
      rows.forEach(function(r, i) {
        var m = r.month;
        var rev = +r.revenue;
        var ord = +r.orders;
        months.push(m);
        ordersList.push(ord);
        points.push({x: m, y: rev, _orders: ord});
      });

      var minO = Math.min.apply(null, ordersList);
      var maxO = Math.max.apply(null, ordersList);
      var rMin = 6, rMax = 26;
      points = points.map(function(p) {
        var r = 12;
        if (maxO !== minO) {
          r = rMin + (p._orders - minO) * (rMax - rMin) / (maxO - minO);
        }
        return {x: p.x, y: p.y, r: r, _orders: p._orders};
      });

      var chart = new ctx.Chart(canvas, {
        type: "bubble",
        data: {
          labels: months,
          datasets: [{
            label: "Revenue vs Orders by Month",
            data: points,
            backgroundColor: "rgba(54, 162, 235, 0.4)",
            borderColor: "rgba(54, 162, 235, 1)",
            borderWidth: 1,
            hoverBackgroundColor: "rgba(54, 162, 235, 0.7)"
          }]
        },
        options: {
          maintainAspectRatio: false,
          plugins: {
            title: {display: true, text: "Monthly Revenue (Y) & Orders (Bubble Size)"},
            tooltip: {
              callbacks: {
                label: function(ctx2) {
                  var p = ctx2.raw || {};
                  var rev = p.y;
                  var ord = p._orders;
                  var m = p.x;
                  var revFmt = (rev || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                  return m + ": $" + revFmt + " revenue, " + ord + " orders";
                }
              }
            },
            legend: {display: false}
          },
          scales: {
            x: {
              type: "category",
              title: {display: true, text: "Month"}
            },
            y: {
              beginAtZero: true,
              title: {display: true, text: "Revenue"},
              ticks: {
                callback: function(value) {
                  var v = +value;
                  if (v >= 1000) {
                    return "$" + (v/1000).toFixed(0) + "k";
                  }
                  return "$" + v;
                }
              }
            }
          }
        }
      });

      return Promise.resolve(chart);
    });
  }
};
