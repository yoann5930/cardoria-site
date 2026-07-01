(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function pct(v) {
    return v == null ? "—" : v + " %";
  }

  function renderWitnot(w) {
    if (!w) return "";
    return "<div class='admin-panel' style='margin-top:20px;border:1px solid rgba(212,175,55,.25)'>" +
      "<h2 style='color:#ffe18a;margin:0 0 14px'>Partenaire Witnot</h2>" +
      "<p style='color:#baaf97;font-size:14px;margin:0 0 16px'>Suivi invisible côté visiteur — trafic depuis witnot.com ou <code>?source=witnot</code></p>" +
      "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>Visiteurs Witnot</label><strong id='wnVisitors'>" + (w.visitors || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Inscriptions</label><strong id='wnRegistrations'>" + (w.registrations || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Estimations</label><strong id='wnEstimations'>" + (w.estimations || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Achats</label><strong id='wnPurchases'>" + (w.purchases || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Taux conversion achat</label><strong id='wnConversion'>" + pct(w.conversionRate) + "</strong></div>" +
      "<div class='admin-kpi'><label>Engagement</label><strong id='wnEngagement'>" + pct(w.engagementRate) + "</strong><small>Estimations + achats / visiteurs</small></div>" +
      "</div></div>";
  }

  function loadDashboard(period) {
    period = period || "month";
    A.adminFetch("/api/admin/dashboard?period=" + period).then(function (data) {
      if (!data.ok) return;
      var k = data.kpis;
      A.qs("#kpiRevenue").textContent = A.euro(k.revenue);
      A.qs("#kpiSales").textContent = k.sales;
      A.qs("#kpiPurchases").textContent = k.purchases;
      A.qs("#kpiEstimations").textContent = k.estimations;
      A.qs("#kpiVisitors").textContent = k.visitors;
      A.qs("#kpiNewUsers").textContent = k.newUsers;

      var wBox = A.qs("#witnotPanel");
      if (wBox) wBox.innerHTML = renderWitnot(data.witnot);

      var labels = (data.chart || []).map(function (d) { return d.date ? d.date.slice(5) : ""; });
      var visitors = (data.chart || []).map(function (d) { return d.visitors || 0; });
      var revenue = (data.chart || []).map(function (d) { return d.revenue || 0; });
      if (labels.length) {
        A.drawChart("chartVisitors", labels, visitors);
        A.drawChart("chartRevenue", labels, revenue);
      }
    });
  }

  A.renderShell("dashboard", "Tableau de bord", "Vue d'ensemble Cardoria Enterprise",
    '<div class="admin-periods" id="dashPeriods">' +
    '<button data-period="day" class="active">Jour</button><button data-period="week">Semaine</button>' +
    '<button data-period="month">Mois</button><button data-period="year">Année</button></div>' +
    '<div class="admin-kpi-grid">' +
    '<div class="admin-kpi"><label>Chiffre d\'affaires</label><strong id="kpiRevenue">0 €</strong></div>' +
    '<div class="admin-kpi"><label>Ventes</label><strong id="kpiSales">0</strong></div>' +
    '<div class="admin-kpi"><label>Achats / rachats</label><strong id="kpiPurchases">0</strong></div>' +
    '<div class="admin-kpi"><label>Estimations</label><strong id="kpiEstimations">0</strong></div>' +
    '<div class="admin-kpi"><label>Visiteurs</label><strong id="kpiVisitors">0</strong></div>' +
    '<div class="admin-kpi"><label>Nouveaux utilisateurs</label><strong id="kpiNewUsers">0</strong></div>' +
    '</div>' +
    '<div id="witnotPanel"></div>' +
    '<div class="admin-grid-2">' +
    '<div class="admin-panel"><h2>Visiteurs</h2><canvas class="admin-chart" id="chartVisitors" width="480" height="220"></canvas></div>' +
    '<div class="admin-panel"><h2>Chiffre d\'affaires</h2><canvas class="admin-chart" id="chartRevenue" width="480" height="220"></canvas></div>' +
    '</div>');

  A.periodButtons("dashPeriods", loadDashboard);
  loadDashboard("month");
})();
