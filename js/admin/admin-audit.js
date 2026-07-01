(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function renderLogs(logs) {
    A.qs("#auditBody").innerHTML = logs.map(function (l) {
      var badge = l.type === "security" ? "admin-badge--danger" : l.type === "auth" ? "admin-badge--warn" : "admin-badge--ok";
      return "<tr><td>" + new Date(l.at).toLocaleString("fr-FR") + "</td><td><span class='admin-badge " + badge + "'>" + l.type + "</span></td><td>" + l.action + "</td><td>" + (l.user || "") + "</td><td>" + (l.detail || "") + "</td></tr>";
    }).join("") || "<tr><td colspan='5'>Aucune entrée</td></tr>";
  }

  A.renderShell("audit", "Journal d'activité", "Connexions, modifications, actions employés et sauvegardes",
    '<div class="admin-filters">' +
    '<input id="auditQ" placeholder="Rechercher dans le journal..." oninput="loadAudit()">' +
    '<select id="auditType" onchange="loadAudit()"><option value="">Tous types</option><option value="auth">Connexions</option><option value="users">Utilisateurs</option><option value="export">Exports</option><option value="backup">Sauvegardes</option><option value="security">Sécurité</option><option value="estimation">Estimations</option></select>' +
    '<button class="btn btn-primary" type="button" id="runBackup">Créer une sauvegarde</button></div>' +
    '<div class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Type</th><th>Action</th><th>Utilisateur</th><th>Détail</th></tr></thead><tbody id="auditBody"></tbody></table></div></div>');

  function loadAudit() {
    var q = A.qs("#auditQ").value;
    var type = A.qs("#auditType").value;
    A.adminFetch("/api/admin/audit?q=" + encodeURIComponent(q) + "&type=" + type).then(function (d) { if (d.ok) renderLogs(d.logs); });
  }

  A.qs("#runBackup").onclick = function () {
    A.adminFetch("/api/admin/backup", { method: "POST" }).then(function (d) {
      if (d.ok) { alert("Sauvegarde créée : " + d.backup.id); loadAudit(); }
    });
  };

  window.loadAudit = loadAudit;
  loadAudit();
})();
