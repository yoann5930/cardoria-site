(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function badge(ok) {
    return ok ? '<span class="admin-badge admin-badge--ok">OK</span>' : '<span class="admin-badge admin-badge--danger">KO</span>';
  }

  function renderHealth(r) {
    var sys = r.system || {};
    var dep = r.deployments || {};
    var c = r.checks || {};
    return "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>CPU load (1m)</label><strong>" + ((sys.cpuLoad || [])[0] ?? "—") + "</strong></div>" +
      "<div class='admin-kpi'><label>RAM libre</label><strong>" + (sys.memoryFreeMb || 0) + " / " + (sys.memoryTotalMb || 0) + " Mo</strong></div>" +
      "<div class='admin-kpi'><label>SQLite</label><strong>" + (r.storage?.sqlite?.sizeMb || 0) + " Mo</strong></div>" +
      "<div class='admin-kpi'><label>Uptime</label><strong>" + Math.floor((r.uptimeSeconds || 0) / 3600) + " h</strong></div>" +
      "</div>" +
      "<table class='admin-table' style='margin-top:16px;font-size:14px'>" +
      "<tr><th>Base SQLite</th><td>" + badge(c.database?.ok) + " " + (c.database?.cards ?? 0) + " cartes</td></tr>" +
      "<tr><th>OpenAI</th><td>" + badge(c.openai?.ok) + "</td></tr>" +
      "<tr><th>SMTP</th><td>" + badge(c.smtp?.ok) + "</td></tr>" +
      "<tr><th>SumUp</th><td>" + badge(c.sumup?.ok) + "</td></tr>" +
      "<tr><th>Render</th><td>" + badge(dep.render?.ok) + " " + (dep.backendUrl || "—") + "</td></tr>" +
      "<tr><th>Vercel</th><td>" + badge(dep.vercel?.ok) + " " + (dep.frontendUrl || "—") + "</td></tr>" +
      "<tr><th>Maintenance</th><td>" + (r.maintenance?.active ? '<span class="admin-badge admin-badge--danger">ACTIVE</span> ' + (r.maintenance.message || "") : badge(true)) + "</td></tr>" +
      "</table>";
  }

  function renderVersion(v) {
    return "<p><strong>Version</strong> " + v.version + " (" + v.codename + ")</p>" +
      "<p style='color:#baaf97'>Build " + v.build + " · Node " + v.node + " · " + v.environment + "</p>";
  }

  function renderJournals(stats) {
    return Object.keys(stats || {}).map(function (k) {
      return "<tr><td>" + k + "</td><td>" + stats[k].lines + "</td><td>" + stats[k].sizeKb + " Ko</td></tr>";
    }).join("");
  }

  function load() {
    A.adminFetch("/api/system/full").then(function (d) {
      if (!d.ok) { A.qs("#sysHealth").textContent = d.error || "Erreur"; return; }
      A.qs("#sysHealth").innerHTML = renderHealth(d.report);
      A.qs("#journalStats").innerHTML = renderJournals(d.report.journals);
    });
    A.adminFetch("/api/system/version").then(function (d) {
      if (d.ok) A.qs("#sysVersion").innerHTML = renderVersion(d);
    });
    A.adminFetch("/api/system/audit").then(function (d) {
      if (!d.ok || !d.audit) return;
      var a = d.audit;
      A.qs("#sysAudit").innerHTML =
        "<p>Score audit : <strong>" + a.score + "/100</strong></p>" +
        (a.issues.length ? "<p style='color:#f88'>Issues : " + a.issues.join(" · ") + "</p>" : "") +
        (a.warnings.length ? "<p style='color:#fa0'>Warnings : " + a.warnings.slice(0, 5).join(" · ") + "</p>" : "");
    });
    A.adminFetch("/api/system/backups").then(function (d) {
      A.qs("#backupList").innerHTML = (d.backups || []).slice(0, 12).map(function (b) {
        return "<tr><td>" + b.id + "</td><td>" + (b.createdAt || "") + "</td><td>" + (b.label || "—") + "</td></tr>";
      }).join("") || "<tr><td colspan='3'>Aucune sauvegarde</td></tr>";
    });
    A.adminFetch("/api/system/journals?type=connections&limit=15").then(function (d) {
      A.qs("#logConn").innerHTML = (d.entries || []).map(function (e) {
        return "<tr><td>" + (e.at || "").slice(11, 19) + "</td><td>" + e.method + "</td><td>" + e.path + "</td><td>" + e.status + "</td><td>" + e.ms + "ms</td></tr>";
      }).join("") || "<tr><td colspan='5'>—</td></tr>";
    });
  }

  A.renderShell("system", "Système V1.0", "Santé serveur, backups, logs, maintenance et version production",
    '<div class="admin-filters">' +
    '<button class="btn btn-primary" type="button" id="reloadSys">Actualiser</button>' +
    '<button class="btn btn-secondary" type="button" id="runBackup">Backup SQLite</button>' +
    '<button class="btn btn-secondary" type="button" id="rotateBackup">Rotation backups</button>' +
    '<button class="btn btn-secondary" type="button" id="checkAlerts">Test alertes</button>' +
    '<button class="btn btn-secondary" type="button" id="toggleMaint">Maintenance</button>' +
    '<button class="btn btn-secondary" type="button" id="restartSvc">Redémarrer</button></div>' +
    '<div class="admin-panel" id="sysVersion"></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Santé serveur</h3><div id="sysHealth">Chargement…</div></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Audit configuration</h3><div id="sysAudit">—</div></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Journaux</h3><table class="admin-table"><thead><tr><th>Type</th><th>Lignes</th><th>Taille</th></tr></thead><tbody id="journalStats"></tbody></table>' +
    '<h4 style="margin-top:16px;color:#baaf97">Connexions récentes</h4><table class="admin-table" style="font-size:12px"><thead><tr><th>Heure</th><th>Méthode</th><th>Route</th><th>Statut</th><th>Durée</th></tr></thead><tbody id="logConn"></tbody></table></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Sauvegardes</h3><table class="admin-table" style="font-size:13px"><thead><tr><th>ID</th><th>Date</th><th>Label</th></tr></thead><tbody id="backupList"></tbody></table></div>');

  var nav = document.querySelector(".admin-nav");
  if (nav && !nav.querySelector('[href="admin-system.html"]')) {
    nav.insertAdjacentHTML("beforeend", '<div class="admin-nav-section">Production</div><a class="active" href="admin-system.html">Système V1.0</a>');
  }

  A.qs("#reloadSys").onclick = load;
  A.qs("#runBackup").onclick = function () {
    A.adminFetch("/api/system/backups", { method: "POST", body: "{}" }).then(function (d) {
      alert(d.ok ? "Backup : " + d.backup.id : (d.error || "Erreur"));
      load();
    });
  };
  A.qs("#rotateBackup").onclick = function () {
    A.adminFetch("/api/system/backups/rotate", { method: "POST", body: "{}" }).then(function (d) {
      alert(d.ok ? "Rotation OK — supprimés : " + (d.removed || 0) : (d.error || "Erreur"));
      load();
    });
  };
  A.qs("#checkAlerts").onclick = function () {
    A.adminFetch("/api/system/alerts/check", { method: "POST", body: "{}" }).then(function (d) {
      alert(d.alerted ? "Alerte envoyée" : (d.failures ? "Échecs : " + d.failures.join(", ") : "RAS"));
    });
  };
  A.qs("#toggleMaint").onclick = function () {
    var msg = prompt("Message maintenance (vide = désactiver)", "");
    if (msg === null) return;
    var active = msg.length > 0;
    A.adminFetch("/api/system/maintenance", { method: "PUT", body: JSON.stringify({ active: active, message: msg || "Maintenance Cardoria" }) })
      .then(function (d) { alert(d.ok ? (active ? "Maintenance activée" : "Maintenance désactivée") : d.error); load(); });
  };
  A.qs("#restartSvc").onclick = function () {
    if (!confirm("Redémarrer le backend Render ? Coupure ~30 s.")) return;
    A.adminFetch("/api/system/restart", { method: "POST", body: "{}" }).then(function () {
      alert("Redémarrage demandé.");
    });
  };
  load();
})();
