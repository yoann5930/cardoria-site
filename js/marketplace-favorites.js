(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("favPage");

  function load() {
    M.api("/favorites/" + encodeURIComponent(M.getUserId())).then(function (d) {
      root.innerHTML = "<h1>Mes favoris</h1><div class='mk-grid'>" +
        (d.favorites || []).map(function (f) {
          var img = f.photos && f.photos[0] ? '<img src="' + f.photos[0] + '" alt="" loading="lazy">' : "🃏";
          return '<a class="mk-card" href="' + M.listingUrl(f.listingId) + '"><div class="mk-card-img">' + img + '</div><div class="mk-card-body"><h3>' + f.title + "</h3><p class='mk-card-price'>" + M.euro(f.price) + "</p></div></a>";
        }).join("") + "</div>" || "<div class='panel'>Aucun favori.</div>";
    });
  }
  load();
})();
