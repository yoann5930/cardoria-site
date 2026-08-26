(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  async function exportData(format, type) {
    try {
      var token = sessionStorage.getItem("cardoria_session_token") || "";
      var res = await fetch(A.BACKEND + "/api/admin/accounting/export?format=" + encodeURIComponent(format) + "&type=" + encodeURIComponent(type), {
        headers: token ? { Authorization: "Bearer " + token } : {},
        cache: "no-store"
      });
      if (res.status === 401) {
        sessionStorage.removeItem("cardoria_admin_connected");
        sessionStorage.removeItem("cardoria_session_token");
        location.href = "admin-login.html";
        return;
      }
      if (!res.ok) throw new Error("Export impossible");
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "cardoria-" + type + "-" + Date.now() + (format === "pdf" ? ".html" : ".csv");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      alert(e.message || "Export impossible");
    }
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
    A.adminFetch("/api/admin/accounting/sales?q=" + encodeURIComponent(q) + "&license=" + encodeURIComponent(license)).then(function (d) { if (d.ok) renderSales(d.sales); });
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
    '<input id="searchQ" placeholder="Recherche multicritères...">' +
    '<select id="filterLicense"><option value="">Toutes licences</option><option value="pokemon">Pokémon</option><option value="yugioh">Yu-Gi-Oh!</option><option value="onepiece">One Piece</option><option value="lorcana">Lorcana</option><option value="magic">Magic</option></select>' +
    '<button class="btn btn-primary" type="button" id="expCsvSales">Export Excel (CSV)</button>' +
    '<button class="btn btn-secondary" type="button" id="expPdfSales">Export imprimable</button>' +
    '<button class="btn btn-secondary" type="button" id="expCsvPurch">Export achats CSV</button></div>' +
    '<div class="admin-grid-2"><div class="admin-panel"><h2>Par licence</h2><ul id="statsLicense"></ul></div>' +
    '<div class="admin-panel"><h2>Par vendeur</h2><ul id="statsSeller"></ul></div></div>' +
    '<div class="admin-panel"><h2>Historique des ventes</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Date</th><th>Client</th><th>Licence</th><th>Vendeur</th><th>Montant</th></tr></thead><tbody id="salesBody"></tbody></table></div></div>' +
    '<div class="admin-panel"><h2>Historique des achats</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Date</th><th>Vendeur</th><th>Licence</th><th>Montant</th><th>Statut</th></tr></thead><tbody id="purchasesBody"></tbody></table></div></div>');

  A.qs("#searchQ").addEventListener("input", loadAll);
  A.qs("#filterLicense").addEventListener("change", loadAll);
  A.qs("#expCsvSales").onclick = function () { exportData("csv", "sales"); };
  A.qs("#expPdfSales").onclick = function () { exportData("pdf", "sales"); };
  A.qs("#expCsvPurch").onclick = function () { exportData("csv", "purchases"); };
  loadAll();
})();