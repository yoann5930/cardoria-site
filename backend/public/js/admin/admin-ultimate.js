(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function drawLineChart(canvas, series, labelKey, valueKey) {
    if (!canvas || !series.length) return;
    var ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height, pad = 40;
    var vals = series.map(function (s) { return Number(s[valueKey] || 0); });
    var max = Math.max.apply(null, vals.concat([1]));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(212,175,55,.25)";
    ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
    ctx.strokeStyle = "#d4af37"; ctx.lineWidth = 2; ctx.beginPath();
    vals.forEach(function (v, i) {
      var x = pad + i * ((w - 2 * pad) / Math.max(vals.length - 1, 1));
      var y = h - pad - (v / max) * (h - 2 * pad);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  function renderDashboard(data) {
    var d = data.dashboard || {};
    var k = d.kpis || {};
    var charts = d.charts || {};

    A.qs("#ultKpi").innerHTML =
      "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>Visiteurs (jour)</label><strong>" + (k.visitorsToday || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Ventes (jour)</label><strong>" + (k.salesToday || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>CA (jour)</label><strong>" + A.euro(k.revenueToday) + "</strong></div>" +
      "<div class='admin-kpi'><label>CA Marketplace</label><strong>" + A.euro(k.marketplaceRevenueToday) + "</strong></div>" +
      "<div class='admin-kpi'><label>Bénéfice (30j est.)</label><strong>" + A.euro(k.profitMonthEstimate) + "</strong></div>" +
      "<div class='admin-kpi'><label>Marge</label><strong>" + (k.marginPercent || 0) + " %</strong></div>" +
      "<div class='admin-kpi'><label>Estimations (jour)</label><strong>" + (k.estimationsToday || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Scans (jour)</label><strong>" + (k.scansToday || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Contrefaçons</label><strong>" + (k.counterfeitsDetected || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Temps moy. est.</label><strong>" + (k.avgEstimationMs || 0) + " ms</strong></div>" +
      "<div class='admin-kpi'><label>Conversion</label><strong>" + (k.conversionRate || 0) + " %</strong></div>" +
      "</div>";

    var revCanvas = A.qs("#ultRevChart");
    drawLineChart(revCanvas, charts.revenueVisitors || [], "period", "revenue");

    var lic = (d.tops && d.tops.licenses) || [];
    A.qs("#ultLicenses").innerHTML = lic.map(function (l) {
      return "<tr><td>" + l.license + "</td><td>" + l.volume + "</td></tr>";
    }).join("") || "<tr><td colspan='2'>—</td></tr>";

    var trends = (d.tops && d.tops.trendingCards) || [];
    A.qs("#ultTrends").innerHTML = trends.map(function (t) {
      return "<tr><td>" + (t.cardName || t.cardId) + "</td><td>" + (t.label || t.signalType) + "</td><td>" + (t.changePercent || 0) + " %</td></tr>";
    }).join("") || "<tr><td colspan='3'>—</td></tr>";
  }

  function load(refresh) {
    A.adminFetch("/api/admin/ultimate/dashboard" + (refresh ? "?refresh=1" : "")).then(function (d) {
      if (!d.ok) { A.qs("#ultKpi").innerHTML = d.error || "Erreur"; return; }
      renderDashboard(d);
    });
  }

  A.renderShell("ultimate", "Cardoria Ultimate Enterprise",
    "Pilotage premium — visiteurs, CA, marges, tendances, conversion",
    "<div id='ultKpi'></div>" +
    "<div class='admin-filters' style='margin:12px 0'>" +
    "<button class='btn btn-primary' type='button' id='ultRefresh'>Recalculer</button>" +
    "<button class='btn btn-secondary' type='button' id='ultWorker'>Worker</button></div>" +
    "<div class='admin-grid-2'>" +
    "<div class='admin-panel'><h3 style='color:#ffe18a'>Revenus & visiteurs</h3><canvas id='ultRevChart' width='520' height='200'></canvas></div>" +
    "<div class='admin-panel'><h3 style='color:#ffe18a'>Licences populaires</h3>" +
    "<table class='admin-table'><thead><tr><th>Licence</th><th>Volume</th></tr></thead><tbody id='ultLicenses'></tbody></table>" +
    "<h3 style='color:#ffe18a;margin-top:16px'>Cartes tendance</h3>" +
    "<table class='admin-table'><thead><tr><th>Carte</th><th>Signal</th><th>Δ</th></tr></thead><tbody id='ultTrends'></tbody></table></div></div>");

  load(false);
  A.qs("#ultRefresh").onclick = function () { load(true); };
  A.qs("#ultWorker").onclick = function () {
    A.adminFetch("/api/admin/ultimate/worker/run", { method: "POST" }).then(function () { load(false); });
  };
})();
