(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("cartRoot");
  var userId = M.getUserId();
  var paymentConfig = null;

  function apiV1(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(M.BACKEND + "/api/marketplace" + path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || !data.ok) throw new Error(data.error || "Erreur Marketplace");
        return data;
      });
    });
  }

  function render(cart) {
    if (!cart.items.length) {
      root.innerHTML = "<p>Votre panier est vide. <a href='marketplace.html'>Parcourir la marketplace</a></p>";
      return;
    }

    var commissionInfo = paymentConfig && paymentConfig.commissionConfigured
      ? "Cardoria prélève automatiquement sa commission de " + Number(paymentConfig.commissionPercent).toLocaleString("fr-FR") + " % sur la transaction vendeur."
      : "La commission Cardoria n'est pas encore configurée : le paiement Marketplace restera bloqué jusqu'à sa configuration.";

    root.innerHTML =
      cart.items.map(function (it) {
        return "<div class='mk-cart-row' style='display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(212,175,55,.2)'>" +
          "<div><strong>" + it.title + "</strong><br><span style='color:#baaf97'>" + M.euro(it.unitPrice) + " × " + it.qty + "</span></div>" +
          "<div><input type='number' min='1' value='" + it.qty + "' data-id='" + it.listingId + "' style='width:60px'> " +
          "<button type='button' data-del='" + it.listingId + "'>Retirer</button></div></div>";
      }).join("") +
      "<p style='margin-top:16px;font-size:20px;color:#ffe18a'>Sous-total : <strong>" + M.euro(cart.subtotal) + "</strong></p>" +
      "<div class='mk-payment-provider'><strong>Paiement Marketplace sécurisé par PayPal</strong><p>Le vendeur reçoit le règlement via son compte PayPal et Cardoria prélève sa commission automatiquement.</p><small>" + commissionInfo + "</small></div>" +
      "<div class='mk-form-grid' style='margin-top:16px'>" +
      "<input id='buyEmail' type='email' placeholder='Email' autocomplete='email'>" +
      "<input id='buyName' placeholder='Nom' autocomplete='name'>" +
      "<input id='buyAddress' placeholder='Adresse livraison' autocomplete='street-address'>" +
      "<select id='buyCarrier'><option value='mondial_relay'>Mondial Relay</option><option value='colissimo'>Colissimo</option><option value='chronopost'>Chronopost</option></select>" +
      "<button class='mk-btn mk-btn-primary' type='button' id='checkoutBtn'>Payer avec PayPal</button></div>";

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
    var email = document.getElementById("buyEmail").value.trim();
    var name = document.getElementById("buyName").value.trim();
    var address = document.getElementById("buyAddress").value.trim();
    var carrier = document.getElementById("buyCarrier").value;
    if (!email) { alert("Email requis"); return; }
    if (!address) { alert("Adresse de livraison requise"); return; }
    if (!paymentConfig || !paymentConfig.configured) {
      alert("PayPal Marketplace n'est pas encore configuré côté serveur.");
      return;
    }
    if (!paymentConfig.commissionConfigured) {
      alert("Le pourcentage de commission Cardoria doit être configuré avant les transactions.");
      return;
    }

    var button = document.getElementById("checkoutBtn");
    button.disabled = true;
    button.textContent = "Préparation du paiement…";

    apiV1("/shipping/quote", { method: "POST", body: JSON.stringify({ carrier: carrier }) })
      .then(function (ship) {
        return apiV1("/v1/paypal/checkout", {
          method: "POST",
          body: JSON.stringify({
            userId: userId,
            buyerEmail: email,
            buyerName: name,
            buyerId: userId,
            shippingCarrier: carrier,
            shippingCost: ship.price,
            shippingAddress: address,
            successUrl: location.origin + "/marketplace-paiement-succes.html",
            cancelUrl: location.origin + "/marketplace-paiement-echec.html"
          })
        });
      }).then(function (d) {
        var pay = d.checkout;
        if (pay && pay.url) {
          localStorage.setItem("cardoria_marketplace_paypal_order", pay.id || "");
          location.href = pay.url;
          return;
        }
        throw new Error("Lien de paiement PayPal indisponible.");
      }).catch(function (e) {
        button.disabled = false;
        button.textContent = "Payer avec PayPal";
        alert(e.message);
      });
  }

  function load() {
    Promise.all([
      apiV1("/v1/cart/" + encodeURIComponent(userId)),
      apiV1("/v1/paypal/config")
    ]).then(function (results) {
      paymentConfig = results[1];
      render(results[0].cart);
    }).catch(function (e) {
      root.innerHTML = "<div class='panel'>" + e.message + "</div>";
    });
  }

  load();
})();
