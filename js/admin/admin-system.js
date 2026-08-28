(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function badge(ok) {
    return ok ? '<span class="admin-badge admin-badge--ok">OK</span>' : '<span class="admin-badge admin-badge--danger">KO</span>';
  }

  function humanSize(n) {
    n = Number(n || 0);
    if (!n) return "—";
    if (n < 1024) return n + " o";
    if (n < 1048576) return (n / 1024).toFixed(1) + " Ko";
    return (n / 1048576).toFixed(1) + " Mo";
  }

  function renderHealth(r) {
    var sys = r.system || {}, dep = r.deployments || {}, c = r.checks || {};
    return "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>CPU load (1m)</label><strong>" + esc((sys.cpuLoad || [])[0] == null ? "—" : (sys.cpuLoad || [])[0]) + "</strong></div>" +
      "<div class='admin-kpi'><label>RAM libre</label><strong>" + esc(sys.memoryFreeMb || 0) + " / " + esc(sys.memoryTotalMb || 0) + " Mo</strong></div>" +
      "<div class='admin-kpi'><label>SQLite</label><strong>" + esc(r.storage && r.storage.sqlite ? r.storage.sqlite.sizeMb : 0) + " Mo</strong></div>" +
      "<div class='admin-kpi'><label>Uptime</label><strong>" + Math.floor((r.uptimeSeconds || 0) / 3600) + " h</strong></div></div>" +
      "<table class='admin-table' style='margin-top:16px;font-size:14px'>" +
      "<tr><th>Base SQLite</th><td>" + badge(c.database && c.database.ok) + " " + esc(c.database && c.database.cards != null ? c.database.cards : 0) + " cartes</td></tr>" +
      "<tr><th>SMTP</th><td>" + badge(c.smtp && c.smtp.ok) + "</td></tr>" +
      "<tr><th>SumUp</th><td>" + badge(c.sumup && c.sumup.ok) + "</td></tr>" +
      "<tr><th>Render</th><td>" + badge(dep.render && dep.render.ok) + " " + esc(dep.backendUrl || "—") + "</td></tr>" +
      "<tr><th>Maintenance</th><td>" + (r.maintenance && r.maintenance.active ? '<span class="admin-badge admin-badge--danger">ACTIVE</span> ' + esc(r.maintenance.message || "") : badge(true)) + "</td></tr></table>";
  }

  function renderVersion(v) {
    return "<p><strong>Version</strong> " + esc(v.version) + " (" + esc(v.codename) + ")</p>" +
      "<p style='color:#baaf97'>Build " + esc(v.build) + " · Node " + esc(v.node) + " · " + esc(v.environment) + "</p>";
  }

  function renderJournals(stats) {
    return Object.keys(stats || {}).map(function (k) {
      return "<tr><td>" + esc(k) + "</td><td>" + esc(stats[k].lines) + "</td><td>" + esc(stats[k].sizeKb) + " Ko</td></tr>";
    }).join("");
  }

  function renderBackups(d) {
    var status = A.qs("#backupStorage");
    if (status) status.innerHTML = d.durable
      ? '<span class="admin-badge admin-badge--ok">DURABLE</span> PostgreSQL — conservé entre les déploiements Render'
      : '<span class="admin-badge admin-badge--danger">LOCAL ÉPHÉMÈRE</span> ' + esc(d.warning || "");
    A.qs("#backupList").innerHTML = (d.backups || []).slice(0, 30).map(function (b) {
      return "<tr><td style='max-width:280px;word-break:break-all'>" + esc(b.id) + "</td><td>" + esc((b.createdAt || "").replace("T", " ").slice(0, 19)) + "</td><td>" + esc(b.label || "—") + "</td><td>" + humanSize(b.sizeBytes) + "</td><td><button class='btn btn-secondary btn-restore' type='button' data-backup-id='" + esc(b.id) + "'>Vérifier / restaurer</button></td></tr>";
    }).join("") || "<tr><td colspan='5'>Aucune sauvegarde</td></tr>";
    document.querySelectorAll(".btn-restore").forEach(function (btn) {
      btn.addEventListener("click", function () { prepareRestore(btn.getAttribute("data-backup-id")); });
    });
  }

  function renderErrors(d) {
    var s = d.stats || {};
    A.qs("#errorStats").innerHTML = "Total: <strong>" + esc(s.total || 0) + "</strong> · 24 h: <strong>" + esc(s.last24h || 0) + "</strong> · Critiques: <strong>" + esc(s.critical || 0) + "</strong>";
    A.qs("#errorList").innerHTML = (d.errors || []).map(function (e) {
      var cls = e.severity === "critical" ? "admin-badge--danger" : "";
      return "<tr><td>" + esc((e.at || "").replace("T", " ").slice(0, 19)) + "</td><td><span class='admin-badge " + cls + "'>" + esc(e.severity) + "</span></td><td>" + esc(e.route || "—") + "</td><td style='max-width:520px;white-space:normal'>" + esc(e.message || "—") + "</td><td>" + esc(e.id || "") + "</td></tr>";
    }).join("") || "<tr><td colspan='5'>Aucune erreur récente</td></tr>";
  }

  function load() {
    A.adminFetch("/api/system/full").then(function (d) {
      if (!d.ok) { A.qs("#sysHealth").textContent = d.error || "Erreur"; return; }
      A.qs("#sysHealth").innerHTML = renderHealth(d.report);
      A.qs("#journalStats").innerHTML = renderJournals(d.report.journals);
    });
    A.adminFetch("/api/system/version").then(function (d) { if (d.ok) A.qs("#sysVersion").innerHTML = renderVersion(d); });
    A.adminFetch("/api/system/audit").then(function (d) {
      if (!d.ok || !d.audit) return;
      var a = d.audit;
      A.qs("#sysAudit").innerHTML = "<p>Score audit : <strong>" + esc(a.score) + "/100</strong></p>" +
        (a.issues.length ? "<p style='color:#f88'>Issues : " + esc(a.issues.join(" · ")) + "</p>" : "") +
        (a.warnings.length ? "<p style='color:#fa0'>Warnings : " + esc(a.warnings.slice(0, 5).join(" · ")) + "</p>" : "");
    });
    A.adminFetch("/api/system/backups").then(function (d) { if (d.ok) renderBackups(d); });
    A.adminFetch("/api/system/errors?limit=50").then(function (d) { if (d.ok) renderErrors(d); });
    A.adminFetch("/api/system/journals?type=connections&limit=15").then(function (d) {
      A.qs("#logConn").innerHTML = (d.entries || []).map(function (e) {
        return "<tr><td>" + esc((e.at || "").slice(11, 19)) + "</td><td>" + esc(e.method) + "</td><td>" + esc(e.path) + "</td><td>" + esc(e.status) + "</td><td>" + esc(e.ms) + "ms</td></tr>";
      }).join("") || "<tr><td colspan='5'>—</td></tr>";
    });
  }

  function prepareRestore(id) {
    if (!id) return;
    A.adminFetch("/api/system/backups/" + encodeURIComponent(id) + "/validate", { method: "POST", body: "{}" }).then(function (d) {
      if (!d.ok) { alert(d.error || "Validation impossible. Seul un super administrateur peut restaurer."); return; }
      var phrase = d.confirmationRequired || ("RESTORE " + id);
      var reason = prompt("Sauvegarde vérifiée. Motif de restauration (obligatoire) :", "");
      if (reason === null) return;
      if (reason.trim().length < 5) { alert("Motif trop court."); return; }
      var typed = prompt("Action destructive. Tapez exactement :\n" + phrase, "");
      if (typed !== phrase) { alert("Confirmation incorrecte. Restauration annulée."); return; }
      if (!confirm("Dernière confirmation : restaurer " + id + " ? Une sauvegarde de sécurité sera créée avant l'opération.")) return;
      A.adminFetch("/api/system/backups/" + encodeURIComponent(id) + "/restore", {
        method: "POST",
        body: JSON.stringify({ confirmation: typed, reason: reason.trim() })
      }).then(function (r) {
        if (!r.ok) { alert(r.error || "Restauration échouée."); return; }
        alert("Restauration terminée. Les sessions ont été révoquées : reconnexion obligatoire.");
        sessionStorage.clear();
        location.replace("admin-login.html");
      });
    });
  }

  A.renderShell("system", "Système & sauvegardes", "Santé serveur, sauvegardes durables, restauration contrôlée, erreurs et maintenance",
    '<div class="admin-filters">' +
    '<button class="btn btn-primary" type="button" id="reloadSys">Actualiser</button>' +
    '<button class="btn btn-secondary" type="button" id="runBackup">Créer une sauvegarde</button>' +
    '<button class="btn btn-secondary" type="button" id="rotateBackup">Rotation sauvegardes</button>' +
    '<button class="btn btn-secondary" type="button" id="checkAlerts">Test alertes</button>' +
    '<button class="btn btn-secondary" type="button" id="toggleMaint">Maintenance</button>' +
    '<button class="btn btn-secondary" type="button" id="restartSvc">Redémarrer</button></div>' +
    '<div class="admin-panel" id="sysVersion"></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Santé serveur</h3><div id="sysHealth">Chargement…</div></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Audit configuration</h3><div id="sysAudit">—</div></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Sauvegardes & restauration</h3><p id="backupStorage">Chargement…</p><p style="color:#baaf97;font-size:13px">La restauration est réservée au super-administrateur. Un contrôle d’intégrité et une sauvegarde pré-restauration sont obligatoires. Les sessions sont révoquées après restauration.</p><div style="overflow:auto"><table class="admin-table" style="font-size:13px"><thead><tr><th>ID</th><th>Date</th><th>Label</th><th>Taille</th><th>Action</th></tr></thead><tbody id="backupList"></tbody></table></div></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Erreurs récentes</h3><p id="errorStats">—</p><p style="color:#baaf97;font-size:13px">Vue expurgée : aucun stack, token, secret ou chaîne de connexion n’est affiché.</p><div style="overflow:auto"><table class="admin-table" style="font-size:12px"><thead><tr><th>Date</th><th>Niveau</th><th>Route</th><th>Message</th><th>ID</th></tr></thead><tbody id="errorList"></tbody></table></div></div>' +
    '<div class="admin-panel"><h3 style="color:#ffe18a">Journaux</h3><table class="admin-table"><thead><tr><th>Type</th><th>Lignes</th><th>Taille</th></tr></thead><tbody id="journalStats"></tbody></table>' +
    '<h4 style="margin-top:16px;color:#baaf97">Connexions récentes</h4><table class="admin-table" style="font-size:12px"><thead><tr><th>Heure</th><th>Méthode</th><th>Route</th><th>Statut</th><th>Durée</th></tr></thead><tbody id="logConn"></tbody></table></div>');

  var nav = document.querySelector(".admin-nav");
  if (nav && !nav.querySelector('[href="admin-system.html"]')) nav.insertAdjacentHTML("beforeend", '<div class="admin-nav-section">Production</div><a class="active" href="admin-system.html">Système & backups</a>');

  A.qs("#reloadSys").onclick = load;
  A.qs("#runBackup").onclick = function () {
    var label = prompt("Label de la sauvegarde (optionnel)", "admin-manual");
    if (label === null) return;
    A.adminFetch("/api/system/backups", { method: "POST", body: JSON.stringify({ label: label }) }).then(function (d) {
      alert(d.ok ? "Sauvegarde créée : " + d.backup.id : (d.error || "Erreur"));
      load();
    });
  };
  A.qs("#rotateBackup").onclick = function () {
    A.adminFetch("/api/system/backups/rotate", { method: "POST", body: "{}" }).then(function (d) {
      alert(d.ok ? "Rotation OK — supprimées : " + (d.removed || 0) : (d.error || "Erreur")); load();
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
    if (!confirm("Redémarrer le backend Render ?")) return;
    A.adminFetch("/api/system/restart", { method: "POST", body: "{}" }).then(function (d) { alert(d.ok ? "Redémarrage demandé." : (d.error || "Erreur")); });
  };

  load();
})();
