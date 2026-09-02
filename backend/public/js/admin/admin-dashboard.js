(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function pct(v) { return v == null ? "—" : v + " %"; }
  function n(v) { return Number(v || 0); }

  function renderWitnot(w) {
    if (!w) return "";
    return "<div class='admin-panel' style='margin-top:20px;border:1px solid rgba(212,175,55,.25)'>" +
      "<h2 style='color:#ffe18a;margin:0 0 14px'>Partenaire Witnot</h2>" +
      "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>Visiteurs Witnot</label><strong>" + (w.visitors || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Inscriptions</label><strong>" + (w.registrations || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Estimations</label><strong>" + (w.estimations || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Achats</label><strong>" + (w.purchases || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Conversion achat</label><strong>" + pct(w.conversionRate) + "</strong></div>" +
      "<div class='admin-kpi'><label>Engagement</label><strong>" + pct(w.engagementRate) + "</strong></div>" +
      "</div></div>";
  }

  function renderAlerts(alerts) {
    var box = A.qs("#dashboardAlerts");
    if (!box) return;
    if (!alerts || !alerts.length) {
      box.innerHTML = '<div class="admin-panel"><strong style="color:#8ee09a">Aucune alerte opérationnelle.</strong></div>';
      return;
    }
    box.innerHTML = alerts.map(function (alert) {
      var color = alert.level === "danger" ? "#ff8f8f" : "#ffe18a";
      return '<a class="admin-panel" href="' + esc(alert.href || "#") + '" style="display:block;text-decoration:none;border-color:' + color + ';margin-bottom:10px"><strong style="color:' + color + '">' + esc(alert.label) + '</strong></a>';
    }).join("");
  }

  function renderActivity(logs) {
    A.qs("#recentActivity").innerHTML = (logs || []).map(function (l) {
      return '<tr><td>' + esc(new Date(l.at).toLocaleString("fr-FR")) + '</td><td>' + esc(l.type) + '</td><td>' + esc(l.action) + '</td><td>' + esc(l.user || "") + '</td></tr>';
    }).join("") || '<tr><td colspan="4">Aucune activité récente</td></tr>';
  }

  function loadDashboard(period) {
    period = period || "month";
    A.adminFetch("/api/admin/dashboard?period=" + encodeURIComponent(period), { cache: "no-store" }).then(function (data) {
      if (!data.ok) throw new Error(data.error || "Tableau de bord indisponible");
      var k = data.kpis || {};
      var s = data.stock || {};
      var o = data.operations || {};

      A.qs("#kpiRevenue").textContent = A.euro(k.revenue);
      A.qs("#kpiBoutiqueRevenue").textContent = A.euro(k.boutiqueRevenue);
      A.qs("#kpiMarketplaceGmv").textContent = A.euro(k.marketplaceGmv);
      A.qs("#kpiMarketplaceCommission").textContent = A.euro(k.marketplaceCommission);
      A.qs("#kpiSales").textContent = k.sales || 0;
      A.qs("#kpiPurchasesSpend").textContent = A.euro(k.purchaseSpend);
      A.qs("#kpiCashContribution").textContent = A.euro(k.cashContribution);
      A.qs("#kpiEstimations").textContent = k.estimations || 0;
      A.qs("#kpiVisitors").textContent = k.visitors || 0;
      A.qs("#kpiNewUsers").textContent = k.newUsers || 0;

      A.qs("#stockAvailable").textContent = s.availableUnits || 0;
      A.qs("#stockReserved").textContent = s.reservedUnits || 0;
      A.qs("#stockSold").textContent = s.soldUnits || 0;
      A.qs("#stockRefund").textContent = s.refundHoldUnits || 0;
      A.qs("#stockOversold").textContent = s.oversoldUnits || 0;
      A.qs("#stockRetailValue").textContent = A.euro(s.retailValueAvailable);

      A.qs("#opsPrepare").textContent = o.toPrepare || 0;
      A.qs("#opsPreparing").textContent = o.preparing || 0;
      A.qs("#opsRefund").textContent = o.refundReview || 0;
      A.qs("#opsPendingPayment").textContent = o.paymentPending || 0;

      renderAlerts(data.alerts || []);
      renderActivity(data.recentActivity || []);
      A.qs("#witnotPanel").innerHTML = renderWitnot(data.witnot);
      A.qs("#dashboardSource").textContent = (data.sources && data.sources.revenue) || "Données commerce réelles";

      var labels = (data.chart || []).map(function (d) { return d.date ? d.date.slice(5) : ""; });
      var visitors = (data.chart || []).map(function (d) { return n(d.visitors); });
      var revenue = (data.chart || []).map(function (d) { return n(d.revenue); });
      if (labels.length) {
        A.drawChart("chartVisitors", labels, visitors);
        A.drawChart("chartRevenue", labels, revenue);
      }
    }).catch(function (error) {
      A.qs("#dashboardAlerts").innerHTML = '<div class="admin-panel"><strong style="color:#ff8f8f">' + esc(error.message || "Erreur tableau de bord") + '</strong></div>';
    });
  }

  A.renderShell("dashboard", "Tableau de bord", "Pilotage réel de Cardoria — commerce, stock, commandes et activité",
    '<div class="admin-periods" id="dashPeriods">' +
    '<button data-period="day">Jour</button><button data-period="week">Semaine</button><button data-period="month" class="active">Mois</button><button data-period="year">Année</button></div>' +
    '<div class="admin-kpi-grid">' +
    '<div class="admin-kpi"><label>Revenu Cardoria</label><strong id="kpiRevenue">0 €</strong><small>Boutique + commission Marketplace</small></div>' +
    '<div class="admin-kpi"><label>CA Boutique Revolut</label><strong id="kpiBoutiqueRevenue">0 €</strong></div>' +
    '<div class="admin-kpi"><label>GMV Marketplace</label><strong id="kpiMarketplaceGmv">0 €</strong><small>Volume vendu, pas revenu Cardoria</small></div>' +
    '<div class="admin-kpi"><label>Commission Marketplace</label><strong id="kpiMarketplaceCommission">0 €</strong></div>' +
    '<div class="admin-kpi"><label>Ventes payées</label><strong id="kpiSales">0</strong></div>' +
    '<div class="admin-kpi"><label>Achats Cardoria payés</label><strong id="kpiPurchasesSpend">0 €</strong></div>' +
    '<div class="admin-kpi"><label>Contribution de trésorerie</label><strong id="kpiCashContribution">0 €</strong><small>Revenus - achats payés</small></div>' +
    '<div class="admin-kpi"><label>Estimations</label><strong id="kpiEstimations">0</strong></div>' +
    '<div class="admin-kpi"><label>Visiteurs</label><strong id="kpiVisitors">0</strong></div>' +
    '<div class="admin-kpi"><label>Nouveaux clients</label><strong id="kpiNewUsers">0</strong></div>' +
    '</div>' +
    '<p class="small" id="dashboardSource" style="margin-top:8px;color:#baaf97"></p>' +
    '<div id="dashboardAlerts" style="margin-top:20px"></div>' +
    '<div class="admin-grid-2" style="margin-top:20px">' +
      '<div class="admin-panel"><h2>Stock Boutique</h2><div class="admin-kpi-grid">' +
        '<div class="admin-kpi"><label>Disponible</label><strong id="stockAvailable">0</strong></div>' +
        '<div class="admin-kpi"><label>Réservé</label><strong id="stockReserved">0</strong></div>' +
        '<div class="admin-kpi"><label>Vendu</label><strong id="stockSold">0</strong></div>' +
        '<div class="admin-kpi"><label>Remboursement</label><strong id="stockRefund">0</strong></div>' +
        '<div class="admin-kpi"><label>Survente</label><strong id="stockOversold">0</strong></div>' +
        '<div class="admin-kpi"><label>Valeur vente disponible</label><strong id="stockRetailValue">0 €</strong></div>' +
      '</div><p><a href="admin-stock.html">Ouvrir le stock →</a></p></div>' +
      '<div class="admin-panel"><h2>Commandes Boutique</h2><div class="admin-kpi-grid">' +
        '<div class="admin-kpi"><label>À préparer</label><strong id="opsPrepare">0</strong></div>' +
        '<div class="admin-kpi"><label>En préparation</label><strong id="opsPreparing">0</strong></div>' +
        '<div class="admin-kpi"><label>Remboursements à contrôler</label><strong id="opsRefund">0</strong></div>' +
        '<div class="admin-kpi"><label>Paiements en attente</label><strong id="opsPendingPayment">0</strong></div>' +
      '</div><p><a href="admin-commandes.html">Ouvrir les commandes →</a></p></div>' +
    '</div>' +
    '<div class="admin-grid-2">' +
      '<div class="admin-panel"><h2>Visiteurs</h2><canvas class="admin-chart" id="chartVisitors" width="480" height="220"></canvas></div>' +
      '<div class="admin-panel"><h2>Revenu Cardoria</h2><canvas class="admin-chart" id="chartRevenue" width="480" height="220"></canvas></div>' +
    '</div>' +
    '<div id="witnotPanel"></div>' +
    '<div class="admin-panel" style="margin-top:20px"><div style="display:flex;justify-content:space-between;align-items:center"><h2>Activité récente</h2><a href="admin-journal.html">Journal complet →</a></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Type</th><th>Action</th><th>Utilisateur</th></tr></thead><tbody id="recentActivity"></tbody></table></div></div>' +
    '<div class="admin-panel" style="margin-top:20px"><div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap"><div><h2 style="margin:0 0 6px;color:#ffe18a">Développement du site</h2><p style="margin:0;color:#baaf97">Suivi des validations techniques page par page.</p></div><a class="btn" href="admin-developpement.html">Ouvrir le tableau de développement</a></div></div>'
  );

  A.periodButtons("dashPeriods", loadDashboard);
  loadDashboard("month");
})();