(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function exportData(format, type) {
    window.open(A.BACKEND + "/api/admin/accounting/export?format=" + format + "&type=" + type + "&adminCode=" + encodeURIComponent(sessionStorage.getItem("cardoria_admin_code") || "CARDORIA59330"), "_blank");
  }

  function renderSales(list) {
    A.qs("#salesBody").innerHTML = list.map(function (s) {
      return "<tr><td>" + s.id + "</td><td>" + s.date + "</td><td>" + s.client + "</td><td>" + s.license + "</td><td>" + s.seller + "</td><td>" + A.euro(s.amount) + "</td></tr>";
    }).join("") || "<tr><td colspan='6'>Aucune vente</td></tr>";
  }

  function renderPurchases(list) {
    A.qs("#purchasesBody").innerHTML = list.map(function (p) {
      return "<tr><td>" + p.id + "</td><td>" + p.date + "</td><td>" + p.seller + "</td><td>" + p.license + "</td><td>" + A.euro(p.amount) + "</td><td>" + p.status + "</td></tr>";
    }).join("") || "<tr><td colspan='6'>Aucun achat</td></tr>";
  }

  function loadAll() {
    var q = A.qs("#searchQ").value;
    var license = A.qs("#filterLicense").value;
    A.adminFetch("/api/admin/accounting/sales?q=" + encodeURIComponent(q) + "&license=" + license).then(function (d) { if (d.ok) renderSales(d.sales); });
    A.adminFetch("/api/admin/accounting/purchases?q=" + encodeURIComponent(q)).then(function (d) { if (d.ok) renderPurchases(d.purchases); });
    A.adminFetch("/api/admin/accounting/stats").then(function (d) {
      if (!d.ok) return;
      var lic = Object.entries(d.byLicense || {}).map(function (e) { return "<li>" + e[0] + " : " + A.euro(e[1]) + "</li>"; }).join("");
      var sel = Object.entries(d.bySeller || {}).map(function (e) { return "<li>" + e[0] + " : " + A.euro(e[1]) + "</li>"; }).join("");
      A.qs("#statsLicense").innerHTML = lic || "<li>Aucune donnée</li>";
      A.qs("#statsSeller").innerHTML = sel || "<li>Aucune donnée</li>";
    });
  }

  A.renderShell("accounting", "Comptabilité", "Historique, exports et statistiques financières",
    '<div class="admin-filters">' +
    '<input id="searchQ" placeholder="Recherche multicritères..." oninput="loadAll()">' +
    '<select id="filterLicense" onchange="loadAll()"><option value="">Toutes licences</option><option value="pokemon">Pokémon</option><option value="yugioh">Yu-Gi-Oh!</option><option value="onepiece">One Piece</option><option value="lorcana">Lorcana</option><option value="magic">Magic</option></select>' +
    '<button class="btn btn-primary" type="button" id="expCsvSales">Export Excel (CSV)</button>' +
    '<button class="btn btn-secondary" type="button" id="expPdfSales">Export PDF</button>' +
    '<button class="btn btn-secondary" type="button" id="expCsvPurch">Export achats CSV</button></div>' +
    '<div class="admin-grid-2"><div class="admin-panel"><h2>Par licence</h2><ul id="statsLicense"></ul></div>' +
    '<div class="admin-panel"><h2>Par vendeur</h2><ul id="statsSeller"></ul></div></div>' +
    '<div class="admin-panel"><h2>Historique des ventes</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Date</th><th>Client</th><th>Licence</th><th>Vendeur</th><th>Montant</th></tr></thead><tbody id="salesBody"></tbody></table></div></div>' +
    '<div class="admin-panel"><h2>Historique des achats</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Date</th><th>Vendeur</th><th>Licence</th><th>Montant</th><th>Statut</th></tr></thead><tbody id="purchasesBody"></tbody></table></div></div>');

  window.loadAll = loadAll;
  A.qs("#expCsvSales").onclick = function () { exportData("csv", "sales"); };
  A.qs("#expPdfSales").onclick = function () { exportData("pdf", "sales"); };
  A.qs("#expCsvPurch").onclick = function () { exportData("csv", "purchases"); };
  loadAll();
})();
