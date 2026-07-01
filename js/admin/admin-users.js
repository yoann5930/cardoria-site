(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function roleBadge(role) {
    return '<span class="admin-badge admin-role-' + role + '">' + role + "</span>";
  }

  function renderUsers(users) {
    A.qs("#usersBody").innerHTML = users.map(function (u) {
      return "<tr><td>" + u.name + "</td><td>" + u.email + "</td><td>" + roleBadge(u.role) + "</td><td>" + u.status + "</td><td>" + (u.createdAt || "") + "</td></tr>";
    }).join("");
  }

  A.renderShell("users", "Gestion des utilisateurs", "Clients, employés et administrateurs",
    '<div class="admin-panel"><div class="admin-filters">' +
    '<input id="newName" placeholder="Nom"><input id="newEmail" placeholder="Email">' +
    '<select id="newRole"><option value="client">Client</option><option value="employee">Employé</option><option value="admin">Administrateur</option></select>' +
    '<button class="btn btn-primary" type="button" id="addUser">Ajouter</button></div></div>' +
    '<div class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Créé le</th></tr></thead><tbody id="usersBody"></tbody></table></div></div>');

  function loadUsers() {
    A.adminFetch("/api/admin/users").then(function (d) { if (d.ok) renderUsers(d.users); });
  }

  A.qs("#addUser").onclick = function () {
    A.adminFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ name: A.qs("#newName").value, email: A.qs("#newEmail").value, role: A.qs("#newRole").value })
    }).then(function () { loadUsers(); });
  };

  loadUsers();
})();
