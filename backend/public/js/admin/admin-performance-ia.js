(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function pct(v) {
    return v == null ? "—" : v + " %";
  }

  function renderKpis(g) {
    return "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>Taux de réussite</label><strong>" + pct(g.successRate) + "</strong></div>" +
      "<div class='admin-kpi'><label>Précision détection</label><strong>" + pct(g.detectionAccuracy) + "</strong></div>" +
      "<div class='admin-kpi'><label>Précision prix</label><strong>" + pct(g.priceAccuracy) + "</strong></div>" +
      "<div class='admin-kpi'><label>Précision contrefaçon</label><strong>" + pct(g.counterfeitAccuracy) + "</strong></div>" +
      "<div class='admin-kpi'><label>Estimations évaluées</label><strong>" + (g.evaluated || 0) + "</strong></div>" +
      "</div>";
  }

  function renderBreakdown(title, data) {
    var rows = Object.entries(data || {}).map(function (e) {
      var k = e[0], v = e[1];
      return "<tr><td>" + k + "</td><td>" + v.count + "</td><td>" + pct(v.success) + "</td><td>" + pct(v.detection) + "</td><td>" + pct(v.price) + "</td></tr>";
    }).join("");
    if (!rows) return "";
    return "<div class='admin-panel' style='margin-top:16px'><h3 style='color:#ffe18a'>" + title + "</h3>" +
      "<table class='admin-table'><thead><tr><th>Segment</th><th>N</th><th>Réussite</th><th>Détection</th><th>Prix</th></tr></thead><tbody>" +
      rows + "</tbody></table></div>";
  }

  function renderMonthly(monthly) {
    if (!monthly || !monthly.length) return "<p style='color:#baaf97'>Pas encore assez de données mensuelles.</p>";
    var labels = monthly.map(function (m) { return m.month; });
    var values = monthly.map(function (m) { return m.successRate || 0; });
    setTimeout(function () { A.drawChart("perfChart", labels, values); }, 50);
    return "<canvas id='perfChart' width='900' height='220' style='max-width:100%'></canvas>" +
      "<table class='admin-table' style='margin-top:12px;font-size:13px'><thead><tr><th>Mois</th><th>N</th><th>Réussite</th><th>Détection</th><th>Prix</th><th>Contrefaçon</th></tr></thead><tbody>" +
      monthly.slice().reverse().map(function (m) {
        return "<tr><td>" + m.month + "</td><td>" + m.total + "</td><td>" + pct(m.successRate) + "</td><td>" +
          pct(m.detectionAccuracy) + "</td><td>" + pct(m.priceAccuracy) + "</td><td>" + pct(m.counterfeitAccuracy) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function renderErrors(errors) {
    var fields = (errors.fieldErrors || []).map(function (e) {
      return "<li><b>" + e.field + "</b> — " + e.count + " correction(s)" + (e.reasons ? " : " + e.reasons : "") + "</li>";
    }).join("") || "<li>Aucune erreur recensée</li>";
    var reasons = (errors.reasonErrors || []).map(function (e) {
      return "<li>" + e.reason + " (" + e.count + "×)</li>";
    }).join("");
    return "<ul style='color:#baaf97;font-size:14px;line-height:1.6'>" + fields +
      (reasons ? "<li style='margin-top:10px;list-style:none;color:#ffe18a'>Raisons fréquentes :</li>" + reasons : "") + "</ul>";
  }

  function renderSuggestions(list) {
    return (list || []).map(function (s) {
      var cls = s.priority === "high" ? "admin-badge--danger" : s.priority === "medium" ? "admin-badge--gold" : "";
      return "<article class='admin-panel' style='margin-bottom:10px;padding:12px'><span class='admin-badge " + cls + "'>" + s.priority + "</span> " +
        "<strong style='color:#ffe18a'>" + s.title + "</strong><p style='margin:8px 0 0;color:#baaf97;font-size:14px'>" + s.detail + "</p></article>";
    }).join("");
  }

  function loadDashboard() {
    A.qs("#perfRoot").innerHTML = "<div class='admin-panel'>Chargement des métriques IA…</div>";
    A.adminFetch("/api/admin/ai/performance").then(function (d) {
      if (!d.ok) {
        A.qs("#perfRoot").innerHTML = "<div class='admin-panel'>Erreur chargement performance.</div>";
        return;
      }
      var dash = d.dashboard;
      var g = dash.metrics.global;
      A.qs("#perfRoot").innerHTML =
        renderKpis(g) +
        "<div class='admin-grid-2' style='margin-top:16px'>" +
        "<div class='admin-panel'><h3 style='color:#ffe18a'>Évolution mensuelle</h3>" + renderMonthly(dash.monthly) + "</div>" +
        "<div class='admin-panel'><h3 style='color:#ffe18a'>Erreurs fréquentes</h3>" + renderErrors(dash.errors) + "</div></div>" +
        renderBreakdown("Précision par licence", dash.metrics.byLicense) +
        renderBreakdown("Précision par extension", dash.metrics.byExtension) +
        renderBreakdown("Précision par rareté", dash.metrics.byRarity) +
        "<div class='admin-panel' style='margin-top:16px'><h3 style='color:#ffe18a'>Suggestions d'amélioration</h3>" +
        renderSuggestions(dash.suggestions) + "</div>" +
        "<div class='admin-panel' style='margin-top:16px'><h3 style='color:#ffe18a'>Feedback récent</h3>" +
        "<table class='admin-table' style='font-size:13px'><thead><tr><th>Date</th><th>Analyse</th><th>Licence</th><th>Champ</th><th>Raison</th></tr></thead><tbody>" +
        (dash.recentFeedback || []).map(function (f) {
          return "<tr><td>" + (f.createdAt || "").slice(0, 10) + "</td><td>" + (f.analysisId || "—") + "</td><td>" +
            (f.license || "—") + "</td><td>" + (f.field || "—") + "</td><td>" + (f.reason || "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    });
  }

  A.renderShell("performance", "Performance IA Cardoria", "Apprentissage continu — métriques admin uniquement",
    '<div class="admin-filters"><button class="btn btn-primary" type="button" id="reloadPerf">Actualiser</button></div>' +
    '<div id="perfRoot"></div>');

  A.qs("#reloadPerf").onclick = loadDashboard;
  loadDashboard();
})();
