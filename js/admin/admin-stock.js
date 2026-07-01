(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }

  function renderStock(products) {
    A.qs("#stockRows").innerHTML = products.map(function (p) {
      return "<tr><td>" + p.id + "</td><td>" + p.name + "</td><td>" + p.category + "</td><td>" + p.condition + "</td><td>" + euro(p.price) + "</td><td>" + p.stock + "</td><td>" + (p.stock > 0 ? "Disponible" : "Rupture") + "</td></tr>";
    }).join("") || "<tr><td colspan='7'>Aucun produit</td></tr>";
  }

  A.renderShell("stock", "Stock", "Inventaire boutique et accessoires",
    '<div class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Réf.</th><th>Nom</th><th>Catégorie</th><th>État</th><th>Prix</th><th>Stock</th><th>Statut</th></tr></thead><tbody id="stockRows"></tbody></table></div></div>');

  fetch("products.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(renderStock)
    .catch(function () { renderStock([]); });
})();
