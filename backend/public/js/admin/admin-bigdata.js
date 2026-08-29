(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function drawBars(canvas, items, valueKey) {
    if (!canvas || !items.length) return;
    var ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
    var max = Math.max.apply(null, items.map(function (i) { return i[valueKey] || 0; }).concat([1]));
    ctx.clearRect(0, 0, w, h);
    var barW = (w - 40) / items.length;
    items.forEach(function (item, i) {
      var val = item[valueKey] || 0;
      var bh = (val / max) * (h - 50);
      ctx.fillStyle = "rgba(212,175,55,.75)";
      ctx.fillRect(20 + i * barW, h - 30 - bh, barW * 0.7, bh);
    });
  }

  function renderHeatmap(rows) {
    return (rows || []).map(function (r) {
      var pct = Math.min(100, r.intensity || 0);
      return "<div class='admin-kpi' style='border-color:rgba(212,175,55,.4)'>" +
        "<label>" + (r.label || r.region) + "</label>" +
        "<strong>" + (r.estimationCount || 0) + " est.</strong>" +
        "<small style='color:#baaf97;display:block;margin-top:4px'>" + A.euro(r.avgPrice) + " · IA " + (r.avgAiScore || 0) + "</small>" +
        "<div style='height:6px;background:#222;border-radius:3px;margin-top:8px'><div style='height:6px;width:" + pct + "%;background:#d4af37;border-radius:3px'></div></div>" +
        "</div>";
    }).join("");
  }

  function render(d) {
    var dash = d.dashboard || {};
    var stats = dash.aiStats || {};
    var idx = dash.globalIndices || {};
    var heat = dash.heatmap || [];

    A.qs("#bdKpi").innerHTML =
      "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>Enregistrements</label><strong>" + (d.records || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Estimations</label><strong>" + (stats.estimations || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Erreur IA</label><strong>" + (stats.errorRatePercent || 0) + " %</strong></div>" +
      "<div class='admin-kpi'><label>Contrefaçons</label><strong>" + (stats.counterfeitRatePercent || 0) + " %</strong></div>" +
      "<div class='admin-kpi'><label>Taux PSA</label><strong>" + (stats.psaRatePercent || 0) + " %</strong></div>" +
      "<div class='admin-kpi'><label>Cartes gradées</label><strong>" + (stats.gradedRatePercent || 0) + " %</strong></div>" +
      "<div class='admin-kpi'><label>Demande</label><strong>" + (idx.demand || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Investissement</label><strong>" + (idx.investment || 0) + "</strong></div>" +
      "</div>";

    A.qs("#bdHeatmap").innerHTML = "<div class='admin-kpi-grid'>" + renderHeatmap(heat) + "</div>";

    var trends = dash.trends || [];
    A.qs("#bdTrends").innerHTML = trends.slice(0, 12).map(function (t) {
      return "<tr><td>" + t.type + "</td><td>" + t.entityId + "</td><td>" + t.label + "</td><td>" + t.changePercent + " %</td></tr>";
    }).join("") || "<tr><td colspan='4'>—</td></tr>";

    var lic = stats.topLicenses || [];
    drawBars(A.qs("#bdLicChart"), lic, "count");
    A.qs("#bdLicTable").innerHTML = lic.map(function (l) {
      return "<tr><td>" + l.license + "</td><td>" + l.count + "</td><td>" + (l.avgAiScore || "—") + "</td></tr>";
    }).join("");
  }

  function load(refresh) {
    A.adminFetch("/api/admin/bigdata/dashboard" + (refresh ? "?refresh=1" : "")).then(function (d) {
      if (!d.ok) { A.qs("#bdKpi").innerHTML = d.error || "Erreur"; return; }
      render(d);
    });
  }

  A.renderShell("bigdata", "Big Data Engine Cardoria",
    "Base de données mondiale TCG — indices, heatmap, tendances, stats IA",
    "<div id='bdKpi'></div>" +
    "<div class='admin-filters' style='margin:12px 0'>" +
    "<button class='btn btn-primary' type='button' id='bdRefresh'>Sync + refresh</button>" +
    "<button class='btn btn-secondary' type='button' id='bdWorker'>Worker</button>" +
    "<button class='btn btn-secondary' type='button' id='bdRecompute'>Recalcul complet</button></div>" +
    "<h3 style='color:#ffe18a;margin:18px 0 10px'>HeatMap mondiale</h3><div id='bdHeatmap'></div>" +
    "<div class='admin-grid-2' style='margin-top:20px;align-items:start'>" +
    "<div class='admin-panel'><h3 style='color:#ffe18a'>Tendances</h3>" +
    "<table class='admin-table' style='font-size:12px'><thead><tr><th>Type</th><th>Entité</th><th>Libellé</th><th>Δ</th></tr></thead><tbody id='bdTrends'></tbody></table></div>" +
    "<div class='admin-panel'><h3 style='color:#ffe18a'>Top licences</h3>" +
    "<canvas id='bdLicChart' width='480' height='160'></canvas>" +
    "<table class='admin-table' style='font-size:12px;margin-top:10px'><thead><tr><th>Licence</th><th>Volume</th><th>IA</th></tr></thead><tbody id='bdLicTable'></tbody></table></div></div>");

  load(false);
  A.qs("#bdRefresh").onclick = function () { load(true); };
  A.qs("#bdWorker").onclick = function () {
    A.adminFetch("/api/admin/bigdata/worker/run", { method: "POST" }).then(function () { load(false); });
  };
  A.qs("#bdRecompute").onclick = function () {
    A.adminFetch("/api/admin/bigdata/recompute/all", { method: "POST" }).then(function () { load(true); });
  };
})();
