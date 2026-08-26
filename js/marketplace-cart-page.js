(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("cartRoot");
  var userId = M.getUserId();
  var paymentConfig = null;

  function apiV1(path, opts) { return M.api(path, opts); }
  function authBox() {
    return "<div class='panel' style='margin:18px 0'><h3>Connexion requise pour payer</h3><p>Le panier reste disponible sans compte. Le paiement exige une session Cardoria sécurisée.</p><div class='mk-form-grid'><input id='authEmail' type='email' placeholder='Email' autocomplete='email'><input id='authPassword' type='password' placeholder='Mot de passe' autocomplete='current-password'><input id='authName' placeholder='Nom (inscription uniquement)' autocomplete='name'><div><button class='mk-btn mk-btn-primary' id='loginBtn' type='button'>Se connecter</button> <button class='mk-btn mk-btn-secondary' id='registerBtn' type='button'>Créer un compte</button></div></div></div>";
  }

  function render(cart) {
    if (!cart.items.length) { root.innerHTML = "<p>Votre panier est vide. <a href='marketplace.html'>Parcourir la marketplace</a></p>"; return; }
    var account = M.getAccount();
    var commissionInfo = paymentConfig && paymentConfig.commissionConfigured ? "Commission Cardoria : " + Number(paymentConfig.commissionPercent).toLocaleString("fr-FR") + " %." : "Commission Cardoria non configurée : paiement bloqué.";
    root.innerHTML = cart.items.map(function (it) {
      return "<div class='mk-cart-row' style='display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(212,175,55,.2)'><div><strong>" + M.esc(it.title) + "</strong><br><span style='color:#baaf97'>" + M.euro(it.unitPrice) + " × " + Number(it.qty) + "</span></div><div><input type='number' min='1' value='" + Number(it.qty) + "' data-id='" + M.esc(it.listingId) + "' style='width:60px'> <button type='button' data-del='" + M.esc(it.listingId) + "'>Retirer</button></div></div>";
    }).join("") + "<p style='margin-top:16px;font-size:20px;color:#ffe18a'>Sous-total : <strong>" + M.euro(cart.subtotal) + "</strong></p><div class='mk-payment-provider'><strong>Paiement Marketplace sécurisé par PayPal</strong><p>Le prix des cartes et les frais de livraison sont recalculés côté serveur.</p><small>" + commissionInfo + "</small></div>" + (account ? "<p>Connecté : <strong>" + M.esc(account.email) + "</strong></p>" : authBox()) + "<div class='mk-form-grid' style='margin-top:16px'><input id='buyName' placeholder='Nom' autocomplete='name' value='" + M.esc(account && account.name || "") + "'><input id='buyAddress' placeholder='Adresse livraison' autocomplete='street-address'><select id='buyCarrier'><option value='mondial_relay'>Mondial Relay</option><option value='colissimo'>Colissimo</option><option value='chronopost'>Chronopost</option></select><button class='mk-btn mk-btn-primary' type='button' id='checkoutBtn'>Payer avec PayPal</button></div>";

    root.querySelectorAll("input[type=number]").forEach(function (inp) { inp.onchange = function () { apiV1("/v1/cart/qty", { method: "PUT", body: JSON.stringify({ userId: userId, listingId: inp.dataset.id, qty: Number(inp.value) }) }).then(load); }; });
    root.querySelectorAll("button[data-del]").forEach(function (btn) { btn.onclick = function () { apiV1("/v1/cart/item", { method: "DELETE", body: JSON.stringify({ userId: userId, listingId: btn.dataset.del }) }).then(load); }; });
    var loginBtn = document.getElementById("loginBtn");
    var registerBtn = document.getElementById("registerBtn");
    if (loginBtn) loginBtn.onclick = function () { M.login(document.getElementById("authEmail").value.trim(), document.getElementById("authPassword").value).then(load).catch(function (e) { alert(e.message); }); };
    if (registerBtn) registerBtn.onclick = function () { M.register(document.getElementById("authEmail").value.trim(), document.getElementById("authPassword").value, document.getElementById("authName").value.trim()).then(load).catch(function (e) { alert(e.message); }); };
    document.getElementById("checkoutBtn").onclick = checkout;
  }

  function checkout() {
    if (!M.getToken()) { alert("Connectez-vous avant de payer."); return; }
    var name = document.getElementById("buyName").value.trim();
    var address = document.getElementById("buyAddress").value.trim();
    var carrier = document.getElementById("buyCarrier").value;
    if (!address) { alert("Adresse de livraison requise"); return; }
    if (!paymentConfig || !paymentConfig.configured) { alert("PayPal Marketplace n'est pas configuré côté serveur."); return; }
    if (!paymentConfig.commissionConfigured) { alert("La commission Cardoria doit être configurée avant les transactions."); return; }
    var button = document.getElementById("checkoutBtn"); button.disabled = true; button.textContent = "Préparation du paiement…";
    apiV1("/v1/paypal/checkout", { method: "POST", body: JSON.stringify({ userId: userId, buyerName: name, shippingCarrier: carrier, shippingAddress: address, successUrl: location.origin + "/marketplace-paiement-succes.html", cancelUrl: location.origin + "/marketplace-paiement-echec.html" }) })
      .then(function (d) { var pay = d.checkout; if (pay && pay.url) { localStorage.setItem("cardoria_marketplace_paypal_order", pay.id || ""); location.href = pay.url; return; } throw new Error("Lien de paiement PayPal indisponible."); })
      .catch(function (e) { button.disabled = false; button.textContent = "Payer avec PayPal"; alert(e.message); });
  }

  function load() { Promise.all([apiV1("/v1/cart/" + encodeURIComponent(userId)), apiV1("/v1/paypal/config")]).then(function (r) { paymentConfig = r[1]; render(r[0].cart); }).catch(function (e) { root.innerHTML = "<div class='panel'>" + M.esc(e.message) + "</div>"; }); }
  load();
})();
