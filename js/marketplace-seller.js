(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var id = new URLSearchParams(location.search).get("id");
  var root = document.getElementById("sellerPage");

  M.api("/sellers/" + encodeURIComponent(id)).then(function (d) {
    if (!d.ok) { root.innerHTML = "<div class='panel'>Vendeur introuvable</div>"; return; }
    var s = d.seller;
    document.title = s.displayName + " — Vendeur Cardoria";
    var reviews = (d.reviews || []).map(function (r) {
      return "<li>★ " + r.rating + "/5 — " + (r.comment || "") + " <small>(" + new Date(r.createdAt).toLocaleDateString("fr-FR") + ")</small></li>";
    }).join("") || "<li>Aucun avis</li>";
    var listings = (d.listings || []).map(function (l) {
      return '<a class="mk-card" href="' + M.listingUrl(l.id) + '"><div class="mk-card-body"><h3>' + l.title + "</h3><p class='mk-card-price'>" + M.euro(l.price) + "</p></div></a>";
    }).join("");

    root.innerHTML =
      "<h1>" + s.displayName + " " + M.sellerBadge(s) + "</h1>" +
      "<p style='color:#baaf97'>" + (s.bio || "") + "</p>" +
      '<div class="mk-stats"><div class="mk-stat"><strong>' + s.ratingAvg + "</strong><span>Note moyenne</span></div>" +
      '<div class="mk-stat"><strong>' + s.salesCount + "</strong><span>Ventes</span></div>" +
      '<div class="mk-stat"><strong>' + s.satisfactionRate + "%</strong><span>Satisfaction</span></div></div>" +
      "<h2 style='color:#ffe18a;margin-top:28px'>Annonces</h2><div class='mk-grid'>" + listings + "</div>" +
      "<h2 style='color:#ffe18a;margin-top:28px'>Avis clients</h2><ul style='color:#baaf97;line-height:1.8'>" + reviews + "</ul>";
  });
})();
