(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("root");
  var seller = M.getSeller();
  if (!M.getToken() || !seller) { root.innerHTML = "<p>Connectez votre compte vendeur sur <a href='vendre.html'>Vendre</a>.</p>"; return; }
  root.innerHTML = "<p>Chargement espace vendeur…</p>";
  M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/orders").then(function (d) {
    root.innerHTML = "<p><strong>" + M.esc(seller.displayName) + "</strong> " + M.sellerBadge(seller) + "</p><p><a href='mes-annonces.html'>Mes annonces</a> · <a href='vendre.html'>Publier</a></p><h2>Commandes à traiter</h2>" + (d.orders || []).map(function (o) {
      return "<div style='border:1px solid rgba(212,175,55,.25);padding:12px;margin:8px 0;border-radius:8px'><strong>" + M.esc(o.id) + "</strong> — " + M.esc(o.listingTitle) + " — " + M.euro(o.total) + " — " + M.esc(o.status) + ((o.status === "paid" || o.status === "preparing") ? "<div style='margin-top:8px'><input placeholder='N° suivi' id='tr-" + M.esc(o.id) + "'><button type='button' data-oid='" + M.esc(o.id) + "'>Marquer expédié</button></div>" : "") + (o.shippingTracking ? "<p>Suivi : " + M.esc(o.shippingTracking) + "</p>" : "") + "</div>";
    }).join("") || "<p>Aucune commande.</p>";
    root.querySelectorAll("button[data-oid]").forEach(function (btn) { btn.onclick = function () { var tracking = document.getElementById("tr-" + btn.dataset.oid).value; M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/orders/" + encodeURIComponent(btn.dataset.oid) + "/tracking", { method: "PUT", body: JSON.stringify({ status: "shipped", tracking: tracking }) }).then(function () { location.reload(); }).catch(function (e) { alert(e.message); }); }; });
  }).catch(function (e) { root.innerHTML = "<p>" + M.esc(e.message) + "</p>"; });
})();
