(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("root");
  var seller = M.getSeller();
  if (!seller) {
    root.innerHTML = "<p>Connectez-vous en publiant une annonce sur <a href='vendre.html'>vendre.html</a>.</p>";
    return;
  }

  function v1(path, opts) {
    return fetch(M.BACKEND + "/api/marketplace" + path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}))
      .then(function (r) { return r.json(); });
  }

  function renderList(listings) {
    var items = (listings || []).map(function (l) {
      return "<div class='mk-listing-admin' style='padding:12px;border:1px solid rgba(212,175,55,.25);margin:8px 0;border-radius:8px'>" +
        "<strong>" + l.title + "</strong> — " + M.euro(l.price) + " · " + (l.statusLabel || l.status) +
        " · Stock " + l.stock +
        " <a href='" + (l.publicUrl || M.listingUrl(l.id)) + "'>Voir</a>" +
        " <button type='button' data-id='" + l.id + "' data-st='suspended'>Suspendre</button>" +
        " <button type='button' data-id='" + l.id + "' data-st='active'>Publier</button>" +
        " <button type='button' data-del='" + l.id + "'>Supprimer</button></div>";
    }).join("") || "<p>Aucune annonce.</p>";

    root.innerHTML =
      "<p>Vendeur : <strong>" + seller.displayName + "</strong> · " +
      "<a href='vendre.html'>Nouvelle annonce</a> · <a href='espace-vendeur.html'>Espace vendeur</a></p>" +
      "<div id='list'>" + items + "</div>";

    root.querySelectorAll("button[data-st]").forEach(function (btn) {
      btn.onclick = function () {
        v1("/v1/listings/" + btn.dataset.id, {
          method: "PUT",
          body: JSON.stringify({ sellerId: seller.id, sellerEmail: seller.email, status: btn.dataset.st })
        }).then(load);
      };
    });
    root.querySelectorAll("button[data-del]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("Supprimer cette annonce ?")) return;
        fetch(M.BACKEND + "/api/marketplace/v1/listings/" + btn.dataset.del + "?sellerId=" + seller.id + "&sellerEmail=" + encodeURIComponent(seller.email), { method: "DELETE" }).then(load);
      };
    });
  }

  function load() {
    v1("/v1/sellers/" + seller.id + "/listings?sellerEmail=" + encodeURIComponent(seller.email)).then(function (d) {
      if (d.ok) renderList(d.listings);
    });
  }

  load();
})();
