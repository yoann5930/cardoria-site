(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function renderTopTable(title, rows, cols) {
    if (!rows || !rows.length) return "<h4 style='color:#ffe18a;margin-top:18px'>" + title + "</h4><p>Aucune donnée.</p>";
    var head = cols.map(function (c) { return "<th>" + c.label + "</th>"; }).join("");
    var body = rows.map(function (r) {
      return "<tr>" + cols.map(function (c) {
        var v = typeof c.render === "function" ? c.render(r) : (r[c.key] ?? "—");
        return "<td>" + v + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return "<h4 style='color:#ffe18a;margin-top:18px'>" + title + "</h4>" +
      "<table class='admin-table' style='font-size:12px'><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  function renderEvolution(title, series) {
    if (!series || !series.length) return "";
    var rows = series.map(function (s) {
      return "<tr><td>" + s.period + "</td><td>" + s.value + "</td></tr>";
    }).join("");
    return "<h4 style='color:#ffe18a;margin-top:14px;font-size:13px'>" + title + "</h4>" +
      "<table class='admin-table' style='font-size:11px'><thead><tr><th>Période</th><th>Valeur</th></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  function renderDashboard(payload) {
    var d = payload.dashboard || {};
    var s = payload.summary || {};
    var w = payload.worker || {};
    var tops = d.tops || {};
    var ev = d.evolution || {};

    A.qs("#entKpi").innerHTML =
      "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>Estimations</label><strong>" + (s.totalEstimations || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Ventes enregistrées</label><strong>" + (s.totalSalesRecorded || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Ajustements auto</label><strong>" + (s.totalAdjustments || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Fiabilité globale</label><strong>" + (d.globalReliability || 0) + "/100</strong></div>" +
      "<div class='admin-kpi'><label>Cardoria Trend</label><strong>" + (d.cardoriaTrendIndex || 50) + "/100</strong></div>" +
      "<div class='admin-kpi'><label>Prédictions</label><strong>" + (s.cardsWithPredictions || 0) + "</strong></div>" +
      "</div>" +
      "<p style='color:#baaf97;font-size:12px;margin-top:8px'>Calculé : " + (d.computedAt || "—") +
      (w.lastRun ? " · Worker : " + (w.lastRun.at || "") : "") + "</p>";

    A.qs("#entTops").innerHTML =
      renderTopTable("Top licences", tops.licenses, [
        { key: "license", label: "Licence" },
        { key: "estimations", label: "Estimations" },
        { key: "avgReliability", label: "Fiabilité" },
        { key: "revenue", label: "CA", render: function (r) { return A.euro(r.revenue); } }
      ]) +
      renderTopTable("Top extensions", tops.extensions, [
        { key: "extension", label: "Extension" },
        { key: "license", label: "Licence" },
        { key: "estimations", label: "Volume" }
      ]) +
      renderTopTable("Top cartes", tops.cards, [
        { key: "cardName", label: "Carte" },
        { key: "estimations", label: "Scans/Est." },
        { key: "reliability", label: "Fiabilité" },
        { key: "views", label: "Vues" }
      ]) +
      renderTopTable("Top ventes", tops.sales, [
        { key: "soldAt", label: "Date", render: function (r) { return (r.soldAt || "").slice(0, 10); } },
        { key: "card_id", label: "Carte" },
        { key: "amount", label: "Montant", render: function (r) { return A.euro(r.amount); } },
        { key: "delayDays", label: "Délai (j)" }
      ]) +
      renderTopTable("Top recherches", tops.searches, [
        { key: "license", label: "Licence" },
        { key: "extension", label: "Extension" },
        { key: "searches", label: "Volume" }
      ]) +
      renderTopTable("Top tendances", tops.trends, [
        { key: "cardName", label: "Carte" },
        { key: "signalType", label: "Signal" },
        { key: "label", label: "Libellé" },
        { key: "changePercent", label: "Δ %", render: function (r) { return (r.changePercent > 0 ? "+" : "") + r.changePercent + "%"; } },
        { key: "cardoriaTrendScore", label: "Trend" }
      ]);

    A.qs("#entEvolution").innerHTML =
      "<div class='admin-grid-2'>" +
      renderEvolution("Évolution marges (%)", ev.margins) +
      renderEvolution("Évolution prix moyens", ev.prices) +
      renderEvolution("Évolution scans/estimations", ev.scans) +
      renderEvolution("Évolution visiteurs (vues)", ev.visitors) +
      renderEvolution("Évolution ventes", ev.sales) +
      "</div>";
  }

  function loadDashboard(refresh) {
    var url = "/api/admin/ai-enterprise/dashboard" + (refresh ? "?refresh=1" : "");
    A.qs("#entKpi").innerHTML = "Chargement…";
    A.adminFetch(url).then(function (d) {
      if (!d.ok) {
        A.qs("#entKpi").innerHTML = "<div class='admin-panel'>" + (d.error || "Erreur") + "</div>";
        return;
      }
      renderDashboard(d);
    });
  }

  A.renderShell("ai-enterprise", "IA Enterprise auto-apprenante",
    "Apprentissage continu, fiabilité, tendances et prédictions — calcul en arrière-plan",
    "<div id='entKpi'></div>" +
    "<div class='admin-filters' style='margin:14px 0'>" +
    "<button class='btn btn-primary' type='button' id='entRefresh'>Actualiser (recalcul)</button>" +
    "<button class='btn btn-secondary' type='button' id='entWorker'>Lancer worker</button>" +
    "<button class='btn btn-secondary' type='button' id='entTrends'>Recalcul tendances</button></div>" +
    "<div class='admin-grid-2' style='align-items:start'>" +
    "<div id='entTops'></div>" +
    "<div id='entEvolution'></div></div>");

  loadDashboard(false);

  A.qs("#entRefresh").onclick = function () { loadDashboard(true); };
  A.qs("#entWorker").onclick = function () {
    A.adminFetch("/api/admin/ai-enterprise/worker/run", { method: "POST" }).then(function () { loadDashboard(false); });
  };
  A.qs("#entTrends").onclick = function () {
    A.adminFetch("/api/admin/ai-enterprise/refresh/trends", { method: "POST" }).then(function () { loadDashboard(true); });
  };
})();
