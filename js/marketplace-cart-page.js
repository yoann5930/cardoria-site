(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("cartRoot");
  var userId = M.getUserId();

  function apiV1(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(M.BACKEND + "/api/marketplace" + path, opts).then(function (r) { return r.json(); });
  }

  function render(cart) {
    if (!cart.items.length) {
      root.innerHTML = "<p>Votre panier est vide. <a href='marketplace.html'>Parcourir la marketplace</a></p>";
      return;
    }
    root.innerHTML =
      cart.items.map(function (it) {
        return "<div class='mk-cart-row' style='display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(212,175,55,.2)'>" +
          "<div><strong>" + it.title + "</strong><br><span style='color:#baaf97'>" + M.euro(it.unitPrice) + " × " + it.qty + "</span></div>" +
          "<div><input type='number' min='1' value='" + it.qty + "' data-id='" + it.listingId + "' style='width:60px'> " +
          "<button type='button' data-del='" + it.listingId + "'>Retirer</button></div></div>";
      }).join("") +
      "<p style='margin-top:16px;font-size:20px;color:#ffe18a'>Sous-total : <strong>" + M.euro(cart.subtotal) + "</strong></p>" +
      "<div class='mk-form-grid' style='margin-top:16px'>" +
      "<input id='buyEmail' type='email' placeholder='Email'>" +
      "<input id='buyName' placeholder='Nom'>" +
      "<input id='buyAddress' placeholder='Adresse livraison'>" +
      "<select id='buyCarrier'><option value='mondial_relay'>Mondial Relay</option><option value='colissimo'>Colissimo</option><option value='chronopost'>Chronopost</option></select>" +
      "<button class='mk-btn mk-btn-primary' type='button' id='checkoutBtn'>Valider — Paiement SumUp</button></div>";

    root.querySelectorAll("input[type=number]").forEach(function (inp) {
      inp.onchange = function () {
        apiV1("/v1/cart/qty", { method: "PUT", body: JSON.stringify({ userId: userId, listingId: inp.dataset.id, qty: Number(inp.value) }) }).then(load);
      };
    });
    root.querySelectorAll("button[data-del]").forEach(function (btn) {
      btn.onclick = function () {
        apiV1("/v1/cart/item", { method: "DELETE", body: JSON.stringify({ userId: userId, listingId: btn.dataset.del }) }).then(load);
      };
    });
    document.getElementById("checkoutBtn").onclick = checkout;
  }

  function checkout() {
    var email = document.getElementById("buyEmail").value;
    if (!email) { alert("Email requis"); return; }
    apiV1("/shipping/quote", { method: "POST", body: JSON.stringify({ carrier: document.getElementById("buyCarrier").value }) })
      .then(function (ship) {
        return apiV1("/v1/cart/checkout", {
          method: "POST",
          body: JSON.stringify({
            userId: userId, buyerEmail: email, buyerName: document.getElementById("buyName").value,
            buyerId: userId, shippingCarrier: document.getElementById("buyCarrier").value,
            shippingCost: ship.price, shippingAddress: document.getElementById("buyAddress").value,
            successUrl: location.origin + "/marketplace-paiement-succes.html",
            cancelUrl: location.origin + "/marketplace-paiement-echec.html"
          })
        });
      }).then(function (d) {
        if (!d.ok) throw new Error(d.error);
        var pay = d.checkout;
        if (pay && pay.url) location.href = pay.url;
        else if (Array.isArray(pay) && pay[0]?.url) location.href = pay[0].url;
        else alert("Paiement SumUp indisponible.");
      }).catch(function (e) { alert(e.message); });
  }

  function load() {
    apiV1("/v1/cart/" + encodeURIComponent(userId)).then(function (d) {
      if (d.ok) render(d.cart);
    });
  }

  load();
})();
