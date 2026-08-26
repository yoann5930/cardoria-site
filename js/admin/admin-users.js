(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function roleBadge(role) { return '<span class="admin-badge admin-role-' + esc(role) + '">' + esc(role) + "</span>"; }

  function renderUsers(users) {
    A.qs("#usersBody").innerHTML = (users || []).map(function (u) {
      return "<tr><td>" + esc(u.name) + "</td><td>" + esc(u.email) + "</td><td>" + roleBadge(u.role) + "</td><td>" + (u.active ? "Actif" : "Inactif") + "</td><td>" + (u.totpEnabled ? "Oui" : "Non") + "</td><td>" + esc((u.createdAt || "").slice(0, 10)) + "</td></tr>";
    }).join("") || "<tr><td colspan='6'>Aucun utilisateur</td></tr>";
  }

  A.renderShell("users", "Gestion des utilisateurs", "Comptes Cardoria réels — clients, employés et administrateurs",
    '<div class="admin-panel"><p style="color:#baaf97">Les clients créent leur compte depuis le site. Ici, vous pouvez créer uniquement un employé ou un administrateur autorisé.</p><div class="admin-filters">' +
    '<input id="newName" placeholder="Nom"><input id="newEmail" placeholder="Email">' +
    '<select id="newRole"><option value="employee">Employé</option><option value="admin">Administrateur</option></select>' +
    '<button class="btn btn-primary" type="button" id="addUser">Ajouter</button></div><p id="userStatus"></p></div>' +
    '<div class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>2FA</th><th>Créé le</th></tr></thead><tbody id="usersBody"></tbody></table></div></div>');

  function loadUsers() {
    A.adminFetch("/api/admin/users").then(function (d) { if (d.ok) renderUsers(d.users); }).catch(function (e) { A.qs("#userStatus").textContent = e.message || "Chargement impossible"; });
  }

  A.qs("#addUser").onclick = function () {
    A.qs("#userStatus").textContent = "Création…";
    A.adminFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ name: A.qs("#newName").value, email: A.qs("#newEmail").value, role: A.qs("#newRole").value })
    }).then(function (d) {
      A.qs("#userStatus").textContent = d.loginMethod === "magic_link" ? "Compte créé. Connexion par lien magique autorisée." : "Compte créé.";
      A.qs("#newName").value = "";
      A.qs("#newEmail").value = "";
      loadUsers();
    }).catch(function (e) { A.qs("#userStatus").textContent = e.message || "Création impossible"; });
  };

  loadUsers();
})();