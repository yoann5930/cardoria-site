(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("sellPage");
  var config = null;
  function api(path, opts) { return M.api(path, opts); }
  function esc(v) { return M.esc(v); }
  function isDemoMode() { return !!(config && config.demoMode); }
  function commissionText() { return config && config.commissionConfigured ? "Commission Cardoria : " + Number(config.commissionPercent).toLocaleString("fr-FR") + " % par transaction." : "La commission Cardoria doit être configurée avant toute transaction."; }
  function showResult(message, error) { var box = document.getElementById("sellResult"); if (!box) return; box.textContent = message; box.className = error ? "mk-form-message is-error" : "mk-form-message is-success"; }

  function renderAccount() {
    root.innerHTML = '<section class="mk-seller-onboarding"><span class="mk-eyebrow">COMPTE CARDORIA</span><h1>Connexion vendeur sécurisée</h1><p>Un compte Cardoria est obligatoire pour gérer vos annonces et commandes.</p><div class="mk-form-grid"><input id="aEmail" type="email" placeholder="Email" autocomplete="email"><input id="aPassword" type="password" placeholder="Mot de passe (10 caractères min.)" autocomplete="current-password"><input id="aName" placeholder="Nom affiché (inscription)"><div><button class="mk-btn mk-btn-primary" id="loginBtn" type="button">Se connecter</button> <button class="mk-btn mk-btn-secondary" id="registerBtn" type="button">Créer mon compte</button></div></div><div id="sellResult"></div></section>';
    document.getElementById("loginBtn").onclick = function () { M.login(document.getElementById("aEmail").value.trim(), document.getElementById("aPassword").value).then(render).catch(function (e) { showResult(e.message, true); }); };
    document.getElementById("registerBtn").onclick = function () { M.register(document.getElementById("aEmail").value.trim(), document.getElementById("aPassword").value, document.getElementById("aName").value.trim()).then(render).catch(function (e) { showResult(e.message, true); }); };
  }

  function renderRegistration() {
    var account = M.getAccount();
    root.innerHTML = '<section class="mk-seller-onboarding"><span class="mk-eyebrow">VENDEUR MARKETPLACE</span><h1>Créer mon profil vendeur</h1><p>Compte connecté : <strong>' + esc(account.email) + '</strong>. Le profil vendeur sera lié définitivement à cette identité.</p><div class="mk-form-grid"><input id="sName" placeholder="Nom affiché" value="' + esc(account.name || "") + '"><select id="sType"><option value="individual">Particulier</option><option value="professional">Professionnel</option></select><button class="mk-btn mk-btn-primary" type="button" id="createSellerBtn">Créer mon profil vendeur</button></div><p class="mk-paypal-note">' + esc(commissionText()) + '</p><div id="sellResult"></div></section>';
    document.getElementById("createSellerBtn").onclick = function () {
      api("/v1/paypal/sellers/register", { method: "POST", body: JSON.stringify({ displayName: document.getElementById("sName").value.trim(), sellerType: document.getElementById("sType").value }) }).then(function (d) { M.setSeller(d.seller); render(); }).catch(function (e) { showResult(e.message, true); });
    };
  }

  function renderPayPalActivation(seller) {
    root.innerHTML = '<section class="mk-seller-onboarding"><span class="mk-eyebrow">PAIEMENT VENDEUR</span><h1>Activez les règlements PayPal</h1><p>Bonjour <strong>' + esc(seller.displayName) + '</strong>. PayPal doit relier votre compte vendeur avant publication.</p><div class="mk-paypal-status"><strong>Statut PayPal</strong><span>' + (seller.paypalOnboardingStatus === "pending" ? "Activation en cours" : "À activer") + '</span></div><p class="mk-paypal-note">' + esc(commissionText()) + '</p><div class="mk-actions"><button class="mk-btn mk-btn-primary" type="button" id="paypalOnboardBtn">Activer PayPal</button><button class="mk-btn mk-btn-secondary" type="button" id="paypalRefreshBtn">Vérifier mon activation</button></div><div id="sellResult"></div></section>';
    document.getElementById("paypalOnboardBtn").onclick = function () { api("/v1/paypal/sellers/" + encodeURIComponent(seller.id) + "/onboard", { method: "POST", body: "{}" }).then(function (d) { if (!d.url) throw new Error("Lien PayPal indisponible."); location.href = d.url; }).catch(function (e) { showResult(e.message, true); }); };
    document.getElementById("paypalRefreshBtn").onclick = function () { syncSellerStatus(seller); };
  }

  function renderListingForm(seller) {
    root.innerHTML = '<section class="mk-seller-onboarding mk-paypal-ready"><span class="mk-eyebrow">VENDEUR ACTIF</span><div class="mk-paypal-status"><strong>PayPal Marketplace</strong><span>Prêt à recevoir des ventes</span></div><p>' + esc(commissionText()) + '</p></section><h1>Publier une annonce</h1><div class="mk-form-grid"><input id="sTitle" placeholder="Titre de l\'annonce"><select id="sLicense"><option value="pokemon">Pokémon</option><option value="yugioh">Yu-Gi-Oh!</option><option value="onepiece">One Piece</option><option value="lorcana">Lorcana</option><option value="magic">Magic</option><option value="dragonball">Dragon Ball</option><option value="sports">Sports</option></select><input id="sExt" placeholder="Extension / set"><input id="sNum" placeholder="Numéro carte"><input id="sLang" placeholder="Langue (FR, EN, JP…)"><select id="sCond"><option>NM</option><option>EX</option><option>GD</option><option>LP</option><option>MP</option></select><input id="sPrice" type="number" min="0.01" step="0.01" placeholder="Prix €"><input id="sStock" type="number" min="1" value="1" placeholder="Quantité"><label><input type="checkbox" id="sNeg"> Prix négociable</label><textarea id="sDesc" rows="4" placeholder="Description, défauts, envoi…"></textarea><input id="sPhoto" placeholder="URL photo principale"><input id="sPhotosExtra" placeholder="URLs photos suppl. (virgules)"><button class="mk-btn mk-btn-primary" type="button" id="publishBtn">Publier l\'annonce</button></div><div id="sellResult" style="margin-top:16px"></div>';
    document.getElementById("publishBtn").onclick = function () {
      var price = Number(document.getElementById("sPrice").value);
      var title = document.getElementById("sTitle").value.trim();
      if (!title) return showResult("Titre requis.", true);
      if (!(price > 0)) return showResult("Prix valide requis.", true);
      var body = { sellerId: seller.id, title: title, license: document.getElementById("sLicense").value, extension: document.getElementById("sExt").value, number: document.getElementById("sNum").value, language: document.getElementById("sLang").value, status: "active", condition: document.getElementById("sCond").value, price: price, stock: Number(document.getElementById("sStock").value) || 1, negotiable: document.getElementById("sNeg").checked, description: document.getElementById("sDesc").value, photos: [document.getElementById("sPhoto").value].concat((document.getElementById("sPhotosExtra").value || "").split(",").map(function (u) { return u.trim(); })).filter(Boolean) };
      api("/v1/listings", { method: "POST", body: JSON.stringify(body) }).then(function (d) { M.setSeller(d.seller || seller); var url = d.listing.publicUrl || M.listingUrl(d.listing.id); document.getElementById("sellResult").innerHTML = 'Annonce publiée ! <a href="' + esc(url) + '">Voir l\'annonce</a> · <a href="mes-annonces.html">Mes annonces</a>'; }).catch(function (e) { showResult(e.message, true); });
    };
  }

  function syncSellerStatus(seller) {
    var params = new URLSearchParams(location.search);
    var merchantId = params.get("merchantId") || params.get("merchantIdInPayPal") || "";
    var url = "/v1/paypal/sellers/" + encodeURIComponent(seller.id) + "/status" + (merchantId ? "?merchantId=" + encodeURIComponent(merchantId) : "");
    showResult("Vérification PayPal…", false);
    api(url).then(function (d) { M.setSeller(d.seller); history.replaceState({}, "", location.pathname); render(); }).catch(function (e) { showResult(e.message, true); });
  }

  function render() {
    if (!M.getToken() || !M.getAccount()) return renderAccount();
    var seller = M.getSeller();
    if (!seller) return renderRegistration();
    if (!seller.paypalReady && !isDemoMode()) return renderPayPalActivation(seller);
    renderListingForm(seller);
  }
  function init() { api("/v1/paypal/config").then(function (d) { config = d; var seller = M.getSeller(); var params = new URLSearchParams(location.search); if (seller && params.get("paypal") === "return" && !isDemoMode()) return syncSellerStatus(seller); render(); }).catch(function (e) { root.innerHTML = '<div class="panel"><h1>Marketplace temporairement indisponible</h1><p>' + esc(e.message) + '</p></div>'; }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
