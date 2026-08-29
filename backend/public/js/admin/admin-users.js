(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var state = { users: [], actor: null, summary: {} };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function roleLabel(role) {
    return ({ super_admin: "Super admin", admin: "Administrateur", employee: "Employé", client: "Client" })[role] || role;
  }

  function roleBadge(role) {
    return '<span class="admin-badge admin-role-' + esc(role) + '">' + esc(roleLabel(role)) + "</span>";
  }

  function fmtDate(value) {
    if (!value) return "—";
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString("fr-FR");
  }

  function canManage(u) {
    if (!state.actor) return false;
    if (state.actor.role === "super_admin") return true;
    return ["admin", "super_admin"].indexOf(u.role) === -1;
  }

  function roleOptions(u) {
    var roles = state.actor && state.actor.role === "super_admin"
      ? ["client", "employee", "admin", "super_admin"]
      : ["client", "employee"];
    if (roles.indexOf(u.role) === -1) roles.push(u.role);
    return roles.map(function (role) {
      return '<option value="' + esc(role) + '"' + (role === u.role ? " selected" : "") + '>' + esc(roleLabel(role)) + "</option>";
    }).join("");
  }

  function renderSummary() {
    var s = state.summary || {};
    var el = A.qs("#userSummary");
    if (!el) return;
    el.innerHTML =
      '<div class="admin-kpi"><span>Utilisateurs</span><strong>' + Number(s.total || 0) + '</strong></div>' +
      '<div class="admin-kpi"><span>Actifs</span><strong>' + Number(s.active || 0) + '</strong></div>' +
      '<div class="admin-kpi"><span>2FA actifs</span><strong>' + Number(s.twoFactorEnabled || 0) + '</strong></div>' +
      '<div class="admin-kpi"><span>Sessions actives</span><strong>' + Number(s.activeSessions || 0) + '</strong></div>' +
      '<div class="admin-kpi"><span>Super admins actifs</span><strong>' + Number(s.activeSuperAdmins || 0) + '</strong></div>';
  }

  function renderUsers(users) {
    var body = A.qs("#usersBody");
    if (!body) return;
    body.innerHTML = (users || []).map(function (u) {
      var manageable = canManage(u);
      var self = !!u.isSelf;
      var disabled = manageable ? "" : " disabled";
      var selfSensitive = self ? " disabled" : "";
      var reset2fa = state.actor && state.actor.role === "super_admin"
        ? '<button type="button" class="btn btn-secondary" data-reset2fa="' + esc(u.id) + '"' + (u.totpEnabled ? "" : " disabled") + '>Reset 2FA</button>'
        : "";
      return '<tr data-user-row="' + esc(u.id) + '">' +
        '<td><input data-name value="' + esc(u.name || "") + '"' + disabled + '></td>' +
        '<td><strong>' + esc(u.email) + '</strong>' + (self ? '<br><span class="admin-badge admin-badge--gold">Votre compte</span>' : "") + '</td>' +
        '<td>' + roleBadge(u.role) + '<br><select data-role' + disabled + selfSensitive + '>' + roleOptions(u) + '</select></td>' +
        '<td><span class="admin-badge ' + (u.active ? "admin-badge--success" : "admin-badge--danger") + '">' + (u.active ? "Actif" : "Inactif") + '</span><br>' +
          '<button type="button" class="btn btn-secondary" data-toggle-active="' + esc(u.id) + '"' + disabled + selfSensitive + '>' + (u.active ? "Désactiver" : "Réactiver") + '</button></td>' +
        '<td>' + (u.totpEnabled ? '<span class="admin-badge admin-badge--success">Activée</span>' : '<span class="admin-badge admin-badge--danger">À configurer</span>') + '<br>' + reset2fa + '</td>' +
        '<td><strong>' + Number(u.sessionCount || 0) + '</strong><br><button type="button" class="btn btn-secondary" data-revoke="' + esc(u.id) + '"' + disabled + '>Révoquer</button></td>' +
        '<td>' + fmtDate(u.lastLoginAt) + '</td>' +
        '<td><button type="button" class="btn btn-primary" data-save="' + esc(u.id) + '"' + disabled + '>Enregistrer</button></td>' +
      '</tr>';
    }).join("") || "<tr><td colspan='8'>Aucun utilisateur</td></tr>";
  }

  A.renderShell("users", "Gestion des utilisateurs", "Rôles, sécurité 2FA et sessions actives",
    '<div class="admin-panel"><p style="color:#baaf97">Les clients créent leur compte depuis le site. Ici, vous pouvez créer un employé ou, si vous êtes super administrateur, un administrateur.</p>' +
    '<div id="userSummary" class="admin-kpis" style="margin-bottom:18px"></div>' +
    '<div class="admin-filters"><input id="newName" placeholder="Nom"><input id="newEmail" placeholder="Email">' +
    '<select id="newRole"><option value="employee">Employé</option><option value="admin">Administrateur</option></select>' +
    '<button class="btn btn-primary" type="button" id="addUser">Ajouter</button></div><p id="userStatus"></p></div>' +
    '<div class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>2FA</th><th>Sessions</th><th>Dernière connexion</th><th>Actions</th></tr></thead><tbody id="usersBody"></tbody></table></div></div>');

  function status(message, error) {
    var el = A.qs("#userStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = error ? "#ff8d8d" : "#baaf97";
  }

  function loadUsers() {
    status("Chargement…");
    A.adminFetch("/api/admin/users").then(function (d) {
      if (!d.ok) throw new Error(d.error || "Chargement impossible");
      state.users = d.users || [];
      state.actor = d.actor || null;
      state.summary = d.summary || {};
      renderSummary();
      renderUsers(state.users);
      if (state.actor && state.actor.role !== "super_admin") {
        var adminOption = A.qs('#newRole option[value="admin"]');
        if (adminOption) adminOption.remove();
      }
      status("");
    }).catch(function (e) { status(e.message || "Chargement impossible", true); });
  }

  function rowFor(id) {
    return document.querySelector('[data-user-row="' + CSS.escape(String(id)) + '"]');
  }

  function userFor(id) {
    return state.users.find(function (u) { return String(u.id) === String(id); });
  }

  function saveUser(id) {
    var row = rowFor(id), u = userFor(id);
    if (!row || !u) return;
    var patch = {
      name: row.querySelector("[data-name]").value,
      role: row.querySelector("[data-role]").value
    };
    status("Enregistrement…");
    A.adminFetch("/api/admin/users/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(patch) })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "Modification impossible");
        status(d.sessionsRevoked ? "Utilisateur modifié. Ses sessions ont été révoquées." : "Utilisateur modifié.");
        loadUsers();
      }).catch(function (e) { status(e.message || "Modification impossible", true); });
  }

  function toggleActive(id) {
    var u = userFor(id);
    if (!u) return;
    var verb = u.active ? "désactiver" : "réactiver";
    if (!confirm("Confirmer : " + verb + " " + u.email + " ?")) return;
    status("Mise à jour du statut…");
    A.adminFetch("/api/admin/users/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify({ active: !u.active }) })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "Modification impossible");
        status("Statut modifié. Toutes les sessions du compte ont été révoquées.");
        loadUsers();
      }).catch(function (e) { status(e.message || "Modification impossible", true); });
  }

  function revokeSessions(id) {
    var u = userFor(id);
    if (!u || !confirm("Révoquer toutes les sessions de " + u.email + " ?")) return;
    status("Révocation des sessions…");
    A.adminFetch("/api/admin/users/" + encodeURIComponent(id) + "/revoke-sessions", { method: "POST", body: "{}" })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "Révocation impossible");
        if (d.selfRevoked) return A.adminLogout();
        status("Toutes les sessions ont été révoquées.");
        loadUsers();
      }).catch(function (e) { status(e.message || "Révocation impossible", true); });
  }

  function reset2fa(id) {
    var u = userFor(id);
    if (!u || !confirm("Réinitialiser la 2FA de " + u.email + " ? Le compte devra la reconfigurer à sa prochaine connexion.")) return;
    status("Réinitialisation 2FA…");
    A.adminFetch("/api/admin/users/" + encodeURIComponent(id) + "/reset-2fa", { method: "POST", body: "{}" })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "Reset 2FA impossible");
        if (d.selfRevoked) return A.adminLogout();
        status("2FA réinitialisée. Toutes les sessions ont été révoquées.");
        loadUsers();
      }).catch(function (e) { status(e.message || "Reset 2FA impossible", true); });
  }

  A.qs("#addUser").onclick = function () {
    status("Création…");
    A.adminFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ name: A.qs("#newName").value, email: A.qs("#newEmail").value, role: A.qs("#newRole").value })
    }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "Création impossible");
      status("Compte créé. Connexion par lien magique puis 2FA obligatoire.");
      A.qs("#newName").value = "";
      A.qs("#newEmail").value = "";
      loadUsers();
    }).catch(function (e) { status(e.message || "Création impossible", true); });
  };

  document.addEventListener("click", function (event) {
    var save = event.target.closest("[data-save]");
    if (save) return saveUser(save.dataset.save);
    var toggle = event.target.closest("[data-toggle-active]");
    if (toggle) return toggleActive(toggle.dataset.toggleActive);
    var revoke = event.target.closest("[data-revoke]");
    if (revoke) return revokeSessions(revoke.dataset.revoke);
    var reset = event.target.closest("[data-reset2fa]");
    if (reset) return reset2fa(reset.dataset.reset2fa);
  });

  loadUsers();
})();