(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function buyerLabel(v){v=String(v||"").toLowerCase();return v==="yoann"?"Yoann":v==="valentin"?"Valentin":"Non attribué";}
  function typeLabel(v){return v==="consumable"?"Consommable":v==="equipment"?"Matériel":v==="pokemon_card"?"Carte Pokémon":"Ancien achat";}
  function unitPriceLabel(p){return p.purchaseType==="pokemon_card"&&p.unitPrice!=null?A.euro(p.unitPrice):"—";}

  async function exportData(format, type) {
    try {
      var token = sessionStorage.getItem("cardoria_session_token") || "";
      var res = await fetch(A.BACKEND + "/api/admin/accounting/export?format=" + encodeURIComponent(format) + "&type=" + encodeURIComponent(type), { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
      if (res.status === 401) { sessionStorage.removeItem("cardoria_admin_connected"); sessionStorage.removeItem("cardoria_session_token"); location.href = "admin-login.html"; return; }
      if (!res.ok) throw new Error("Export impossible");
      var blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "cardoria-" + type + "-" + Date.now() + (format === "pdf" ? ".html" : ".csv"); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},1000);
    } catch (e) { alert(e.message || "Export impossible"); }
  }

  function renderSales(list) {
    A.qs("#salesBody").innerHTML = list.map(function (s) { return "<tr><td>" + esc(s.id) + "</td><td>" + esc(s.date) + "</td><td>" + esc(s.client) + "</td><td>" + esc(s.license) + "</td><td>" + esc(s.seller) + "</td><td>" + A.euro(s.amount) + "</td></tr>"; }).join("") || "<tr><td colspan='6'>Aucune vente</td></tr>";
  }

  function renderPurchases(list) {
    A.qs("#purchasesBody").innerHTML = list.map(function (p) {
      return "<tr><td>" + esc(p.id) + "</td><td>" + esc(p.date) + "</td><td><strong>" + buyerLabel(p.buyer) + "</strong></td><td>" + esc(typeLabel(p.purchaseType)) + "</td><td>" + esc(p.seller) + "</td><td>" + esc(p.description || p.license || "—") + "</td><td>" + A.euro(p.amount) + "</td><td>" + unitPriceLabel(p) + "</td><td>" + esc(p.status || "—") + "</td></tr>";
    }).join("") || "<tr><td colspan='9'>Aucun achat</td></tr>";
  }

  function loadAll() {
    var q = A.qs("#searchQ").value, license = A.qs("#filterLicense").value, buyer=A.qs("#filterBuyer").value;
    A.adminFetch("/api/admin/accounting/sales?q=" + encodeURIComponent(q) + "&license=" + encodeURIComponent(license)).then(function (d) { if (d.ok) renderSales(d.sales); });
    A.adminFetch("/api/admin/accounting/purchases?q=" + encodeURIComponent(q) + "&buyer="+encodeURIComponent(buyer)).then(function (d) { if (d.ok) renderPurchases(d.purchases); });
    A.adminFetch("/api/admin/accounting/stats").then(function (d) {
      if (!d.ok) return;
      var lic = Object.entries(d.byLicense || {}).map(function (e) { return "<li>" + esc(e[0]) + " : " + A.euro(e[1]) + "</li>"; }).join("");
      var sel = Object.entries(d.bySeller || {}).map(function (e) { return "<li>" + esc(e[0]) + " : " + A.euro(e[1]) + "</li>"; }).join("");
      var purchCat = Object.entries(d.purchaseByCategory || {}).map(function (e) { return "<li>" + esc(e[0]) + " : " + A.euro(e[1]) + "</li>"; }).join("");
      A.qs("#statsLicense").innerHTML = lic || "<li>Aucune donnée</li>"; A.qs("#statsSeller").innerHTML = sel || "<li>Aucune donnée</li>"; A.qs("#statsPurchaseCategory").innerHTML = purchCat || "<li>Aucun achat</li>";
      A.qs("#accountingSalesTotal").textContent = A.euro(d.totalSales || 0); A.qs("#accountingPurchasesTotal").textContent = A.euro(d.cardoriaPurchaseTotal || d.totalPurchases || 0); A.qs("#accountingNetResult").textContent = A.euro(d.netResult || 0); A.qs("#accountingPurchaseCount").textContent = (d.purchaseCount || 0) + " achat(s)";
      A.qs("#accountingYoannTotal").textContent=A.euro(d.purchaseByBuyer&&d.purchaseByBuyer.yoann||0); A.qs("#accountingValentinTotal").textContent=A.euro(d.purchaseByBuyer&&d.purchaseByBuyer.valentin||0); A.qs("#accountingUnassignedTotal").textContent=A.euro(d.purchaseByBuyer&&d.purchaseByBuyer.non_attribue||0);
    });
  }

  A.renderShell("accounting", "Comptabilité", "Historique, achats, acheteurs, exports et statistiques financières",
    '<div class="admin-kpi-grid">' +
    '<div class="admin-kpi"><label>Total ventes</label><strong id="accountingSalesTotal">0,00 €</strong><small>Ventes enregistrées</small></div>' +
    '<div class="admin-kpi"><label>Total général achats Cardoria</label><strong id="accountingPurchasesTotal">0,00 €</strong><small id="accountingPurchaseCount">0 achat</small></div>' +
    '<div class="admin-kpi"><label>Total achats Yoann</label><strong id="accountingYoannTotal">0,00 €</strong></div>' +
    '<div class="admin-kpi"><label>Total achats Valentin</label><strong id="accountingValentinTotal">0,00 €</strong></div>' +
    '<div class="admin-kpi"><label>Achats non attribués</label><strong id="accountingUnassignedTotal">0,00 €</strong><small>À affecter</small></div>' +
    '<div class="admin-kpi"><label>Résultat net</label><strong id="accountingNetResult">0,00 €</strong><small>Ventes - achats</small></div></div>' +
    '<div class="admin-filters"><input id="searchQ" placeholder="Recherche multicritères..."><select id="filterLicense"><option value="">Toutes licences</option><option value="pokemon">Pokémon</option><option value="yugioh">Yu-Gi-Oh!</option><option value="onepiece">One Piece</option><option value="lorcana">Lorcana</option><option value="magic">Magic</option></select><select id="filterBuyer"><option value="">Tous les acheteurs</option><option value="yoann">Yoann</option><option value="valentin">Valentin</option><option value="non_attribue">Non attribué</option></select><button class="btn btn-primary" type="button" id="expCsvSales">Export Excel (CSV)</button><button class="btn btn-secondary" type="button" id="expPdfSales">Export imprimable</button><button class="btn btn-secondary" type="button" id="expCsvPurch">Export achats CSV</button></div>' +
    '<div class="admin-grid-2"><div class="admin-panel"><h2>Ventes par licence</h2><ul id="statsLicense"></ul></div><div class="admin-panel"><h2>Ventes par vendeur</h2><ul id="statsSeller"></ul></div></div>' +
    '<div class="admin-panel"><h2>Achats par catégorie</h2><ul id="statsPurchaseCategory"></ul></div>' +
    '<div class="admin-panel"><h2>Historique des ventes</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Date</th><th>Client</th><th>Licence</th><th>Vendeur</th><th>Montant</th></tr></thead><tbody id="salesBody"></tbody></table></div></div>' +
    '<div class="admin-panel"><h2>Historique des achats</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Date</th><th>Acheteur</th><th>Type</th><th>Vendeur</th><th>Description</th><th>Montant</th><th>Prix / carte</th><th>Statut</th></tr></thead><tbody id="purchasesBody"></tbody></table></div></div>');

  A.qs("#searchQ").addEventListener("input", loadAll); A.qs("#filterLicense").addEventListener("change", loadAll); A.qs("#filterBuyer").addEventListener("change",loadAll);
  A.qs("#expCsvSales").onclick = function () { exportData("csv", "sales"); }; A.qs("#expPdfSales").onclick = function () { exportData("pdf", "sales"); }; A.qs("#expCsvPurch").onclick = function () { exportData("csv", "purchases"); }; loadAll();
})();