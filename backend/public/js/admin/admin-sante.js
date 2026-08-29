(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function badge(ok) {
    return ok ? '<span class="admin-badge admin-badge--ok">OK</span>' : '<span class="admin-badge admin-badge--danger">KO</span>';
  }

  function renderHealth(h) {
    var c = h.checks || {};
    return "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>Statut global</label><strong>" + (h.status || "—") + "</strong></div>" +
      "<div class='admin-kpi'><label>Uptime</label><strong>" + Math.floor((h.uptimeSeconds || 0) / 3600) + " h</strong></div>" +
      "<div class='admin-kpi'><label>Mémoire heap</label><strong>" + (h.memory?.heapUsedMb || 0) + " Mo</strong></div>" +
      "<div class='admin-kpi'><label>Erreurs 24 h</label><strong>" + (h.errors?.last24h || 0) + "</strong></div>" +
      "</div>" +
      "<table class='admin-table' style='margin-top:16px;font-size:14px'>" +
      "<tr><th>Base SQLite</th><td>" + badge(c.database?.ok) + " " + (c.database?.cards ?? 0) + " cartes</td></tr>" +
      "<tr><th>OpenAI</th><td>" + badge(c.openai?.ok) + "</td></tr>" +
      "<tr><th>SMTP</th><td>" + badge(c.smtp?.ok) + "</td></tr>" +
      "<tr><th>SumUp</th><td>" + badge(c.sumup?.ok) + "</td></tr>" +
      "<tr><th>PostgreSQL</th><td>" + badge(c.postgres?.configured) + " <span style='color:#baaf97'>" + (c.postgres?.note || "") + "</span></td></tr>" +
      "<tr><th>Cache</th><td>" + (h.cache?.entries || 0) + " entrées</td></tr>" +
      "<tr><th>Sauvegardes</th><td>" + (h.backups?.count || 0) + " — dernière : " + (h.backups?.latest?.createdAt || "—") + "</td></tr>" +
      "</table>";
  }

  function renderErrors(errors) {
    return (errors || []).map(function (e) {
      return "<tr><td>" + (e.at || "").slice(0, 19).replace("T", " ") + "</td><td>" + e.severity + "</td><td>" + e.route + "</td><td>" + e.message + "</td></tr>";
    }).join("") || "<tr><td colspan='4'>Aucune erreur récente</td></tr>";
  }

  function load() {
    A.qs("#healthRoot").innerHTML = "<div class='admin-panel'>Chargement…</div>";
    A.adminFetch("/api/health/full").then(function (d) {
      if (!d.ok) {
        A.qs("#healthRoot").innerHTML = "<div class='admin-panel'>Erreur : " + (d.error || "Accès refusé") + "</div>";
        return;
      }
      A.qs("#healthRoot").innerHTML =
        renderHealth(d.health) +
        "<div class='admin-panel' style='margin-top:16px'><h3 style='color:#ffe18a'>Erreurs récentes</h3>" +
        "<table class='admin-table' style='font-size:13px'><thead><tr><th>Date</th><th>Niveau</th><th>Route</th><th>Message</th></tr></thead><tbody>" +
        renderErrors(d.errors) + "</tbody></table></div>";
    });

    A.adminFetch("/api/health/backups").then(function (d) {
      if (!d.ok || !A.qs("#backupList")) return;
      A.qs("#backupList").innerHTML = (d.backups || []).slice(0, 10).map(function (b) {
        return "<tr><td>" + b.id + "</td><td>" + (b.createdAt || "") + "</td><td>" + (b.label || "—") + "</td></tr>";
      }).join("") || "<tr><td colspan='3'>Aucune sauvegarde</td></tr>";
    });
  }

  A.renderShell("sante", "Santé & fiabilité", "Monitoring, sauvegardes et erreurs applicatives",
    '<div class="admin-filters">' +
    '<button class="btn btn-primary" type="button" id="reloadHealth">Actualiser</button>' +
    '<button class="btn btn-secondary" type="button" id="runBackup">Sauvegarde complète</button></div>' +
    '<div id="healthRoot"></div>' +
    '<div class="admin-panel" style="margin-top:16px"><h3 style="color:#ffe18a">Sauvegardes disponibles</h3>' +
    '<table class="admin-table" style="font-size:13px"><thead><tr><th>ID</th><th>Date</th><th>Label</th></tr></thead><tbody id="backupList"></tbody></table></div>');

  A.qs("#reloadHealth").onclick = load;
  A.qs("#runBackup").onclick = function () {
    A.adminFetch("/api/health/backups", { method: "POST", body: "{}" }).then(function (d) {
      alert(d.ok ? "Sauvegarde créée : " + d.backup.id : (d.error || "Erreur"));
      load();
    });
  };
  load();
})();
