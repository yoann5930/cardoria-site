(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var id = new URLSearchParams(location.search).get("id");
  var root = document.getElementById("sellerPage");
  if (!id) { root.innerHTML = "<div class='panel'>Vendeur introuvable</div>"; return; }

  M.api("/v1/sellers/" + encodeURIComponent(id) + "/public").then(function (d) {
    var s = d.seller;
    document.title = (s.displayName || "Vendeur") + " — Vendeur Cardoria";
    var reviews = (d.reviews || []).map(function (r) {
      return "<li>★ " + Number(r.rating || 0) + "/5 — " + M.esc(r.comment || "") + " <small>(" + new Date(r.createdAt).toLocaleDateString("fr-FR") + ")</small></li>";
    }).join("") || "<li>Aucun avis</li>";
    var listings = (d.listings || []).map(function (l) {
      return '<a class="mk-card" href="' + M.esc(M.listingUrl(l.id)) + '"><div class="mk-card-body"><h3>' + M.esc(l.title) + "</h3><p class='mk-card-price'>" + M.euro(l.price) + "</p></div></a>";
    }).join("") || "<p>Aucune annonce active.</p>";
    root.innerHTML = "<h1>" + M.esc(s.displayName) + " " + M.sellerBadge(s) + "</h1><p style='color:#baaf97'>" + M.esc(s.bio || "") + "</p><div class='mk-stats'><div class='mk-stat'><strong>" + M.esc(s.ratingAvg || "—") + "</strong><span>Note moyenne</span></div><div class='mk-stat'><strong>" + Number(s.salesCount || 0) + "</strong><span>Ventes</span></div><div class='mk-stat'><strong>" + Number(s.satisfactionRate || 0) + "%</strong><span>Satisfaction</span></div></div><h2 style='color:#ffe18a;margin-top:28px'>Annonces</h2><div class='mk-grid'>" + listings + "</div><h2 style='color:#ffe18a;margin-top:28px'>Avis clients</h2><ul style='color:#baaf97;line-height:1.8'>" + reviews + "</ul>";
  }).catch(function () { root.innerHTML = "<div class='panel'>Vendeur introuvable</div>"; });
})();
