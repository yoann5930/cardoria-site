(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var currentPeriod = "month";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function severity(log) {
    var type = String(log.type || "").toLowerCase();
    var action = String(log.action || "").toLowerCase();
    if (type === "security" || action.indexOf("denied") >= 0 || action.indexOf("failed") >= 0) return "danger";
    if (type === "auth" || type === "payment" || type === "backup") return "warn";
    return "ok";
  }

  function renderLogs(logs) {
    A.qs("#auditBody").innerHTML = (logs || []).map(function (l) {
      var badge = severity(l) === "danger" ? "admin-badge--danger" : severity(l) === "warn" ? "admin-badge--warn" : "admin-badge--ok";
      return "<tr><td>" + esc(new Date(l.at).toLocaleString("fr-FR")) + "</td><td><span class='admin-badge " + badge + "'>" + esc(l.type || "other") + "</span></td><td>" + esc(l.action || "") + "</td><td>" + esc(l.user || "") + "</td><td>" + esc(l.detail || "") + "</td></tr>";
    }).join("") || "<tr><td colspan='5'>Aucune entrée</td></tr>";
  }

  function renderSummary(summary) {
    summary = summary || {};
    A.qs("#auditTotal").textContent = summary.total || 0;
    A.qs("#auditDanger").textContent = summary.danger || 0;
    A.qs("#auditWarn").textContent = summary.warn || 0;
    A.qs("#auditInfo").textContent = summary.info || 0;
    A.qs("#auditTypes").innerHTML = Object.entries(summary.byType || {}).sort(function (a, b) { return b[1] - a[1]; }).map(function (entry) {
      return "<li>" + esc(entry[0]) + " : <strong>" + entry[1] + "</strong></li>";
    }).join("") || "<li>Aucune donnée</li>";
    A.qs("#auditUsers").innerHTML = (summary.topUsers || []).map(function (entry) {
      return "<li>" + esc(entry.user) + " : <strong>" + entry.count + "</strong></li>";
    }).join("") || "<li>Aucune donnée</li>";
    A.qs("#auditActions").innerHTML = (summary.topActions || []).map(function (entry) {
      return "<li>" + esc(entry.action) + " : <strong>" + entry.count + "</strong></li>";
    }).join("") || "<li>Aucune donnée</li>";
  }

  function queryString() {
    var q = A.qs("#auditQ").value || "";
    var type = A.qs("#auditType").value || "";
    var user = A.qs("#auditUser").value || "";
    return "period=" + encodeURIComponent(currentPeriod) + "&q=" + encodeURIComponent(q) + "&type=" + encodeURIComponent(type) + "&user=" + encodeURIComponent(user);
  }

  function loadAudit() {
    A.qs("#auditStatus").textContent = "Chargement…";
    A.adminFetch("/api/admin/audit/summary?" + queryString(), { cache: "no-store" }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "Journal indisponible");
      renderSummary(d.summary);
      renderLogs(d.logs);
      A.qs("#auditStatus").textContent = (d.summary && d.summary.total || 0) + " événement(s) sur la période";
    }).catch(function (e) {
      A.qs("#auditStatus").textContent = e.message || "Chargement impossible";
    });
  }

  function exportAudit() {
    var token = sessionStorage.getItem("cardoria_session_token") || "";
    fetch(A.BACKEND + "/api/admin/audit/export.csv?" + queryString(), { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("Export audit impossible");
      return res.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "cardoria-audit-" + currentPeriod + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }).catch(function (e) { alert(e.message || "Export impossible"); });
  }

  A.renderShell("audit", "Journal d'activité", "Audit réel des connexions, paiements, commandes, utilisateurs, sécurité et sauvegardes",
    '<div class="admin-periods" id="auditPeriods"><button data-period="day">Jour</button><button data-period="week">Semaine</button><button data-period="month" class="active">Mois</button><button data-period="year">Année</button></div>' +
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Total événements</label><strong id="auditTotal">0</strong></div>' +
      '<div class="admin-kpi"><label>Critiques / refusés</label><strong id="auditDanger">0</strong></div>' +
      '<div class="admin-kpi"><label>À surveiller</label><strong id="auditWarn">0</strong></div>' +
      '<div class="admin-kpi"><label>Information</label><strong id="auditInfo">0</strong></div>' +
    '</div>' +
    '<div class="admin-filters" style="margin-top:16px">' +
      '<input id="auditQ" placeholder="Action, détail, commande, email...">' +
      '<input id="auditUser" placeholder="Utilisateur / email">' +
      '<select id="auditType"><option value="">Tous types</option><option value="auth">Connexions</option><option value="security">Sécurité</option><option value="payment">Paiements</option><option value="boutique_order">Commandes Boutique</option><option value="marketplace">Marketplace</option><option value="accounting">Comptabilité</option><option value="users">Utilisateurs</option><option value="export">Exports</option><option value="backup">Sauvegardes</option><option value="estimation">Estimations</option></select>' +
      '<button class="btn btn-secondary" type="button" id="exportAudit">Exporter CSV</button>' +
      '<button class="btn btn-primary" type="button" id="runBackup">Créer une sauvegarde</button>' +
    '</div><p class="small" id="auditStatus"></p>' +
    '<div class="admin-grid-2"><div class="admin-panel"><h2>Événements par type</h2><ul id="auditTypes"></ul></div><div class="admin-panel"><h2>Utilisateurs les plus actifs</h2><ul id="auditUsers"></ul></div></div>' +
    '<div class="admin-panel"><h2>Actions principales</h2><ul id="auditActions"></ul></div>' +
    '<div class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Type</th><th>Action</th><th>Utilisateur</th><th>Détail</th></tr></thead><tbody id="auditBody"></tbody></table></div></div>');

  A.periodButtons("auditPeriods", function (period) { currentPeriod = period; loadAudit(); });
  A.qs("#auditQ").addEventListener("input", loadAudit);
  A.qs("#auditUser").addEventListener("input", loadAudit);
  A.qs("#auditType").addEventListener("change", loadAudit);
  A.qs("#exportAudit").onclick = exportAudit;
  A.qs("#runBackup").onclick = function () {
    A.adminFetch("/api/admin/backup", { method: "POST", body: "{}" }).then(function (d) {
      if (d.ok) { alert("Sauvegarde créée : " + d.backup.id); loadAudit(); }
      else alert(d.error || "Sauvegarde impossible");
    });
  };

  loadAudit();
})();