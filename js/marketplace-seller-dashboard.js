(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("root");
  var seller = M.getSeller();
  if (!seller) {
    root.innerHTML = "<p>Inscrivez-vous sur <a href='vendre.html'>vendre.html</a></p>";
    return;
  }

  root.innerHTML = "<p>Chargement espace vendeur…</p>";
  fetch(M.BACKEND + "/api/marketplace/v1/sellers/" + seller.id + "/orders?sellerEmail=" + encodeURIComponent(seller.email))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) { root.innerHTML = "<p>Erreur</p>"; return; }
      root.innerHTML =
        "<p><strong>" + seller.displayName + "</strong> " + M.sellerBadge(seller) + "</p>" +
        "<p><a href='mes-annonces.html'>Mes annonces</a> · <a href='vendre.html'>Publier</a></p>" +
        "<h2>Commandes à traiter</h2>" +
        (d.orders || []).map(function (o) {
          return "<div style='border:1px solid rgba(212,175,55,.25);padding:12px;margin:8px 0;border-radius:8px'>" +
            "<strong>" + o.id + "</strong> — " + o.listingTitle + " — " + M.euro(o.total) + " — " + o.status +
            (o.status === "paid" || o.status === "preparing"
              ? "<div style='margin-top:8px'><input placeholder='N° suivi' id='tr-" + o.id + "'>" +
                "<button type='button' data-oid='" + o.id + "'>Marquer expédié</button></div>"
              : "") +
            (o.shippingTracking ? "<p>Suivi : " + o.shippingTracking + "</p>" : "") +
            "</div>";
        }).join("") || "<p>Aucune commande.</p>";

      root.querySelectorAll("button[data-oid]").forEach(function (btn) {
        btn.onclick = function () {
          var tracking = document.getElementById("tr-" + btn.dataset.oid).value;
          fetch(M.BACKEND + "/api/marketplace/v1/sellers/" + seller.id + "/orders/" + btn.dataset.oid + "/tracking", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sellerId: seller.id, sellerEmail: seller.email, status: "shipped", tracking: tracking })
          }).then(function () { location.reload(); });
        };
      });
    });
})();
