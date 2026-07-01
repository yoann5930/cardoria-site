(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("ordersPage");
  var email = new URLSearchParams(location.search).get("email") || localStorage.getItem("cardoria_mk_email") || "";

  function apiV1(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(M.BACKEND + "/api/marketplace" + path, opts).then(function (r) { return r.json(); });
  }

  function render(orders) {
    var params = new URLSearchParams(location.search);
    var orderParam = params.get("order");
    var checkoutId = params.get("checkout_id");

    root.innerHTML =
      "<h1>Mes commandes</h1>" +
      (orderParam ? '<p style="color:#8fd4a8;margin-bottom:16px">Commande ' + orderParam + " — merci pour votre achat.</p>" : "") +
      '<div class="mk-form-grid" style="margin-bottom:20px;grid-template-columns:1fr auto"><input id="orderEmail" placeholder="Votre email" value="' + email + '"><button class="mk-btn mk-btn-secondary" type="button" id="loadOrders">Charger</button></div>' +
      '<div id="ordersList"></div>';

    document.getElementById("loadOrders").onclick = load;
    if (email) load();
    else renderList(orders || []);

    if (checkoutId) {
      fetch(M.BACKEND + "/api/payments/sumup/confirm/" + encodeURIComponent(checkoutId))
        .then(function (r) { return r.json(); })
        .then(function () { if (email) load(); });
    }
  }

  function renderList(orders) {
    var box = document.getElementById("ordersList");
    if (!box) return;
    var uid = M.getUserId();
    box.innerHTML = (orders || []).map(function (o) {
      var invUrl = M.BACKEND + "/api/marketplace/v1/orders/" + o.id + "/invoice?email=" + encodeURIComponent(email) + "&userId=" + encodeURIComponent(uid);
      return '<article class="mk-order-card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        "<div><strong>" + o.id + "</strong><br><span style='color:#baaf97'>" + o.listingTitle + "</span></div>" +
        '<div><span class="mk-status ' + M.statusClass(o.status) + '">' + o.status + "</span>" +
        (o.paymentStatus ? " • <span style='color:#baaf97'>" + o.paymentStatus + "</span>" : "") +
        "<br><strong>" + M.euro(o.total) + "</strong></div></div>" +
        "<p style='font-size:13px;color:#baaf97;margin:10px 0 0'>Livraison : " + (o.shippingCarrier || "—") +
        (o.shippingTracking ? " • Suivi : " + o.shippingTracking : "") + "</p>" +
        '<a class="mk-btn mk-btn-secondary" style="margin-top:10px" href="' + invUrl + '" target="_blank">Facture (PDF)</a></article>';
    }).join("") || "<div class='panel'>Aucune commande pour cet email.</div>";
  }

  function load() {
    email = document.getElementById("orderEmail").value;
    localStorage.setItem("cardoria_mk_email", email);
    apiV1("/v1/orders?email=" + encodeURIComponent(email) + "&userId=" + encodeURIComponent(M.getUserId())).then(function (d) {
      renderList(d.orders);
    });
  }

  render([]);
})();
