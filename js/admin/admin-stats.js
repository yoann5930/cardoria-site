(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  A.renderShell("stats", "Statistiques du site", "Visiteurs, provenance, appareils et comportement",
    '<div class="admin-kpi-grid">' +
    '<div class="admin-kpi"><label>Visiteurs uniques</label><strong id="stVisitors">0</strong></div>' +
    '<div class="admin-kpi"><label>Pages vues</label><strong id="stViews">0</strong></div>' +
    '<div class="admin-kpi"><label>Temps moyen</label><strong id="stTime">0 min</strong></div></div>' +
    '<div class="admin-grid-2">' +
    '<div class="admin-panel"><h2>Provenance</h2><ul id="stSources"></ul></div>' +
    '<div class="admin-panel"><h2>Appareils</h2><ul id="stDevices"></ul></div></div>' +
    '<div class="admin-grid-2">' +
    '<div class="admin-panel"><h2>Pages les plus consultées</h2><ul id="stPages"></ul></div>' +
    '<div class="admin-panel"><h2>Recherches populaires</h2><ul id="stSearches"></ul></div></div>' +
    '<div class="admin-panel"><h2>Cartes les plus consultées</h2><ul id="stCards"></ul>' +
    '<canvas class="admin-chart" id="chartViews" width="900" height="260"></canvas></div>');

  A.adminFetch("/api/admin/analytics/site").then(function (d) {
    if (!d.ok) return;
    var a = d.analytics;
    var totalV = (a.days || []).reduce(function (s, x) { return s + (x.visitors || 0); }, 0);
    var totalViews = (a.days || []).reduce(function (s, x) { return s + (x.views || 0); }, 0);
    A.qs("#stVisitors").textContent = totalV;
    A.qs("#stViews").textContent = totalViews;
    A.qs("#stTime").textContent = Math.round((a.avgSessionSeconds || 0) / 60) + " min";
    A.qs("#stSources").innerHTML = Object.entries(a.sources || {}).map(function (e) { return "<li>" + e[0] + " : " + e[1] + "%</li>"; }).join("");
    A.qs("#stDevices").innerHTML = Object.entries(a.devices || {}).map(function (e) { return "<li>" + e[0] + " : " + e[1] + "%</li>"; }).join("");
    A.qs("#stPages").innerHTML = (a.topPages || []).map(function (p) { return "<li>" + p.path + " — " + p.views + " vues</li>"; }).join("") || "<li>Aucune donnée</li>";
    A.qs("#stSearches").innerHTML = (a.topSearches || []).map(function (s) { return "<li>" + s.q + " (" + s.count + ")</li>"; }).join("") || "<li>Aucune donnée</li>";
    A.qs("#stCards").innerHTML = (a.topCards || []).map(function (c) { return "<li>" + c.name + " — " + c.views + " vues</li>"; }).join("") || "<li>Aucune donnée</li>";
    var labels = (a.days || []).map(function (x) { return x.date.slice(5); });
    var views = (a.days || []).map(function (x) { return x.views || 0; });
    if (labels.length) A.drawChart("chartViews", labels, views);
  });
})();
