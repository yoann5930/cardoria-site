(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("wishPage");

  function loadAll() {
    Promise.all([
      M.api("/wishlist/" + encodeURIComponent(M.getUserId())),
      M.api("/alerts/" + encodeURIComponent(M.getUserId()))
    ]).then(function (res) {
      var wish = res[0].wishlist || [];
      var alerts = res[1].alerts || [];
      root.innerHTML =
        "<h1>Liste de souhaits & alertes prix</h1>" +
        '<div class="mk-form-grid" style="margin-bottom:24px"><input id="wEmail" placeholder="Email pour alertes" type="email">' +
        '<input id="wTarget" type="number" step="0.01" placeholder="Prix cible €">' +
        '<input id="wListing" placeholder="ID annonce (optionnel)">' +
        '<button class="mk-btn mk-btn-primary" type="button" id="addAlert">Créer une alerte baisse de prix</button></div>' +
        "<h2 style='color:#ffe18a'>Alertes actives</h2><ul id='alertList' style='color:#baaf97;line-height:2'>" +
        alerts.map(function (a) {
          return "<li>Seuil " + M.euro(a.targetPrice) + " — annonce " + (a.listingId || "—") +
            ' <button type="button" data-id="' + a.id + '" class="mk-btn mk-btn-secondary" style="padding:4px 10px;font-size:11px">Supprimer</button></li>';
        }).join("") + "</ul>" +
        "<h2 style='color:#ffe18a;margin-top:24px'>Souhaits</h2><ul id='wishList' style='color:#baaf97;line-height:2'>" +
        wish.map(function (w) {
          return "<li>" + (w.note || "Carte souhaitée") + (w.targetPrice ? " — max " + M.euro(w.targetPrice) : "") + "</li>";
        }).join("") + "</ul>";

      document.getElementById("addAlert").onclick = function () {
        M.api("/alerts", {
          method: "POST",
          body: JSON.stringify({
            userId: M.getUserId(),
            userEmail: document.getElementById("wEmail").value,
            listingId: document.getElementById("wListing").value || null,
            targetPrice: Number(document.getElementById("wTarget").value)
          })
        }).then(loadAll);
      };

      root.querySelectorAll("[data-id]").forEach(function (btn) {
        btn.onclick = function () {
          fetch(M.BACKEND + "/api/marketplace/alerts/" + M.getUserId() + "/" + btn.dataset.id, { method: "DELETE" })
            .then(loadAll);
        };
      });
    });
  }
  loadAll();
})();
