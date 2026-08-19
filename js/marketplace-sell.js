(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("sellPage");
  var config = null;
  var Bridge = window.CardoriaMarketplaceEstimateBridge;

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(M.BACKEND + "/api/marketplace" + path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || !data.ok) throw new Error(data.error || "Erreur Marketplace");
        return data;
      });
    });
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
    });
  }

  function isDemoMode() {
    return !!(config && config.demoMode);
  }

  function commissionText() {
    if (!config || !config.commissionConfigured) return "La commission Cardoria sera affichée avant l'activation des transactions.";
    return "Commission Cardoria : " + Number(config.commissionPercent).toLocaleString("fr-FR") + " % par transaction.";
  }

  function gameLabel(value) {
    return {
      pokemon: "Pokémon",
      yugioh: "Yu-Gi-Oh!",
      onepiece: "One Piece",
      lorcana: "Lorcana",
      magic: "Magic",
      dragonball: "Dragon Ball",
      sports: "Autre"
    }[value] || "Autre";
  }

  function estimationCondition(value) {
    return { NM: "nm", EX: "ex", GD: "gd", LP: "played", MP: "played" }[value] || "nm";
  }

  function renderRegistration() {
    root.innerHTML =
      '<section class="mk-seller-onboarding">' +
      '<span class="mk-eyebrow">VENDEUR MARKETPLACE</span>' +
      '<h1>Vendre une carte entre particuliers</h1>' +
      '<p>Créez d’abord votre profil vendeur Cardoria. Le règlement des ventes sera ensuite relié à votre compte PayPal.</p>' +
      '<div class="mk-form-grid">' +
      '<input id="sEmail" placeholder="Votre email" type="email" autocomplete="email">' +
      '<input id="sName" placeholder="Nom affiché" autocomplete="name">' +
      '<select id="sType"><option value="individual">Particulier</option><option value="professional">Professionnel</option></select>' +
      '<button class="mk-btn mk-btn-primary" type="button" id="createSellerBtn">Créer mon profil vendeur</button>' +
      '</div><p class="mk-paypal-note">' + esc(commissionText()) + '</p>' +
      '<div id="sellResult"></div></section>';

    document.getElementById("createSellerBtn").onclick = function () {
      var email = document.getElementById("sEmail").value.trim();
      var name = document.getElementById("sName").value.trim();
      if (!email) return showResult("Email requis.", true);
      api("/v1/paypal/sellers/register", {
        method: "POST",
        body: JSON.stringify({ email: email, displayName: name, sellerType: document.getElementById("sType").value })
      }).then(function (d) {
        M.setSeller(d.seller);
        render();
      }).catch(function (e) { showResult(e.message, true); });
    };
  }

  function renderPayPalActivation(seller) {
    root.innerHTML =
      '<section class="mk-seller-onboarding">' +
      '<span class="mk-eyebrow">PAIEMENT VENDEUR</span>' +
      '<h1>Activez les règlements PayPal</h1>' +
      '<p>Bonjour <strong>' + esc(seller.displayName) + '</strong>. PayPal doit relier votre compte vendeur avant qu’une carte puisse être mise en vente.</p>' +
      '<div class="mk-paypal-status">' +
      '<strong>Statut PayPal</strong><span>' + (seller.paypalOnboardingStatus === "pending" ? "Activation en cours" : "À activer") + '</span>' +
      '</div>' +
      '<p class="mk-paypal-note">' + esc(commissionText()) + '</p>' +
      '<div class="mk-actions">' +
      '<button class="mk-btn mk-btn-primary" type="button" id="paypalOnboardBtn">Activer mon compte vendeur PayPal</button>' +
      '<button class="mk-btn mk-btn-secondary" type="button" id="paypalRefreshBtn">Vérifier mon activation</button>' +
      '</div><div id="sellResult"></div></section>';

    document.getElementById("paypalOnboardBtn").onclick = function () {
      api("/v1/paypal/sellers/" + encodeURIComponent(seller.id) + "/onboard", {
        method: "POST",
        body: JSON.stringify({ sellerEmail: seller.email })
      }).then(function (d) {
        if (!d.url) throw new Error("Lien PayPal indisponible.");
        location.href = d.url;
      }).catch(function (e) { showResult(e.message, true); });
    };

    document.getElementById("paypalRefreshBtn").onclick = function () {
      syncSellerStatus(seller);
    };
  }

  function currentDraft() {
    var license = document.getElementById("sLicense")?.value || "pokemon";
    var condition = document.getElementById("sCond")?.value || "NM";
    return {
      title: document.getElementById("sTitle")?.value || "",
      license: license,
      extension: document.getElementById("sExt")?.value || "",
      number: document.getElementById("sNum")?.value || "",
      language: document.getElementById("sLang")?.value || "",
      condition: condition,
      price: document.getElementById("sPrice")?.value || "",
      negotiable: !!document.getElementById("sNeg")?.checked,
      description: document.getElementById("sDesc")?.value || "",
      gameLabel: gameLabel(license),
      estimationCondition: estimationCondition(condition)
    };
  }

  function restoreDraft() {
    if (!Bridge) return;
    var draft = Bridge.getDraft();
    var ids = {
      sTitle: "title",
      sLicense: "license",
      sExt: "extension",
      sNum: "number",
      sLang: "language",
      sCond: "condition",
      sPrice: "price",
      sDesc: "description"
    };
    Object.keys(ids).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && draft[ids[id]] != null && draft[ids[id]] !== "") el.value = draft[ids[id]];
    });
    var neg = document.getElementById("sNeg");
    if (neg && typeof draft.negotiable === "boolean") neg.checked = draft.negotiable;
    renderPhotoPreview(Bridge.getPhotos());
  }

  function renderPhotoPreview(photos) {
    var box = document.getElementById("sPhotoPreview");
    if (!box) return;
    var list = Array.isArray(photos) ? photos : [];
    if (!list.length) {
      box.innerHTML = '<span style="color:#847b6c;font-size:12px">Aucune photo sélectionnée.</span>';
      return;
    }
    box.innerHTML = list.map(function (src, index) {
      return '<img src="' + src + '" alt="Photo carte ' + (index + 1) + '" style="width:82px;height:112px;object-fit:cover;border-radius:10px;border:1px solid rgba(212,175,55,.28);background:#070707">';
    }).join("");
  }

  function saveSelectedPhotos() {
    if (!Bridge) return Promise.resolve([]);
    var input = document.getElementById("sPhotoFiles");
    var files = input ? input.files : null;
    if (!files || !files.length) return Promise.resolve(Bridge.getPhotos());
    return Bridge.saveFiles(files).then(function (photos) {
      renderPhotoPreview(photos);
      return photos;
    });
  }

  function goToEstimation() {
    if (!Bridge) return showResult("Le transfert vers l’estimation est indisponible.", true);
    Bridge.saveDraft(currentDraft());
    showResult("Préparation des photos pour l’estimation…", false);
    saveSelectedPhotos().then(function () {
      location.href = "/estimation.html?source=marketplace";
    }).catch(function (e) {
      showResult(e.message, true);
    });
  }

  function renderListingForm(seller) {
    root.innerHTML =
      '<section class="mk-seller-onboarding mk-paypal-ready">' +
      '<span class="mk-eyebrow">VENDEUR ACTIF</span>' +
      '<div class="mk-paypal-status"><strong>PayPal Marketplace</strong><span>Prêt à recevoir des ventes</span></div>' +
      '<p class="mk-paypal-note">' + esc(commissionText()) + '</p></section>' +
      "<h1>Publier une annonce</h1><p style='color:#baaf97'>Votre carte sera proposée aux autres clients Cardoria.</p>" +
      '<div class="mk-form-grid">' +
      '<input id="sTitle" placeholder="Titre de l\'annonce">' +
      '<select id="sLicense"><option value="pokemon">Pokémon</option><option value="yugioh">Yu-Gi-Oh!</option><option value="onepiece">One Piece</option><option value="lorcana">Lorcana</option><option value="magic">Magic</option><option value="dragonball">Dragon Ball</option><option value="sports">Sports</option></select>' +
      '<input id="sExt" placeholder="Extension / set">' +
      '<input id="sNum" placeholder="Numéro carte">' +
      '<input id="sLang" placeholder="Langue (FR, EN, JP…)">' +
      '<select id="sCond"><option>NM</option><option>EX</option><option>GD</option><option>LP</option><option>MP</option></select>' +
      '<input id="sPrice" type="number" min="0.01" step="0.01" placeholder="Prix €">' +
      '<label style="display:flex;align-items:center;gap:9px;color:#d7c8aa;font-size:13px"><input type="checkbox" id="sNeg" style="width:auto"> Prix négociable</label>' +
      '<textarea id="sDesc" rows="4" placeholder="Description, défauts, envoi…"></textarea>' +
      '<label style="color:#d7c8aa;font-size:13px">Photos de la carte (jusqu’à 6)<input id="sPhotoFiles" type="file" accept="image/*" multiple style="margin-top:7px"></label>' +
      '<div id="sPhotoPreview" style="display:flex;gap:9px;flex-wrap:wrap;min-height:32px"></div>' +
      '<div class="mk-actions" style="margin-top:4px">' +
      '<button class="mk-btn mk-btn-secondary" type="button" id="estimateBtn">Estimer la carte</button>' +
      '<button class="mk-btn mk-btn-primary" type="button" id="publishBtn">Publier l\'annonce</button>' +
      '</div></div>' +
      '<div id="sellResult" style="margin-top:16px"></div>';

    restoreDraft();

    document.getElementById("sPhotoFiles").addEventListener("change", function () {
      showResult("Préparation des photos…", false);
      saveSelectedPhotos().then(function (photos) {
        showResult(photos.length + " photo" + (photos.length > 1 ? "s" : "") + " prête" + (photos.length > 1 ? "s" : "") + ".", false);
      }).catch(function (e) { showResult(e.message, true); });
    });

    document.getElementById("estimateBtn").onclick = goToEstimation;

    document.getElementById("publishBtn").onclick = function () {
      var price = Number(document.getElementById("sPrice").value);
      if (!document.getElementById("sTitle").value.trim()) return showResult("Titre de l’annonce requis.", true);
      if (!(price > 0)) return showResult("Prix valide requis.", true);

      if (Bridge) Bridge.saveDraft(currentDraft());
      saveSelectedPhotos().then(function (photos) {
        var body = {
          sellerId: seller.id,
          sellerEmail: seller.email,
          sellerName: seller.displayName,
          sellerType: seller.sellerType,
          title: document.getElementById("sTitle").value,
          license: document.getElementById("sLicense").value,
          extension: document.getElementById("sExt").value,
          number: document.getElementById("sNum").value,
          language: document.getElementById("sLang").value,
          status: "active",
          condition: document.getElementById("sCond").value,
          price: price,
          negotiable: document.getElementById("sNeg").checked,
          description: document.getElementById("sDesc").value,
          photos: photos
        };

        return fetch(M.BACKEND + "/api/marketplace/v1/listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || !d.ok) throw new Error(d.error || "Publication impossible.");
            return d;
          });
        });
      }).then(function (d) {
        M.setSeller(d.seller || seller);
        if (Bridge) {
          Bridge.saveDraft({});
          Bridge.savePhotos([]);
        }
        var url = d.listing.publicUrl || M.listingUrl(d.listing.id);
        document.getElementById("sellResult").innerHTML = 'Annonce publiée ! <a href="' + url + '">Voir l\'annonce</a> · <a href="mes-annonces.html">Mes annonces</a>';
      }).catch(function (e) { showResult(e.message, true); });
    };
  }

  function showResult(message, error) {
    var box = document.getElementById("sellResult");
    if (!box) return;
    box.textContent = message;
    box.className = error ? "mk-form-message is-error" : "mk-form-message is-success";
  }

  function syncSellerStatus(seller) {
    var params = new URLSearchParams(location.search);
    var merchantId = params.get("merchantId") || params.get("merchantIdInPayPal") || "";
    var url = "/v1/paypal/sellers/" + encodeURIComponent(seller.id) + "/status?sellerEmail=" + encodeURIComponent(seller.email);
    if (merchantId) url += "&merchantId=" + encodeURIComponent(merchantId);

    showResult("Vérification de votre compte PayPal…", false);
    api(url).then(function (d) {
      M.setSeller(d.seller);
      history.replaceState({}, "", location.pathname);
      render();
    }).catch(function (e) { showResult(e.message, true); });
  }

  function render() {
    var seller = M.getSeller();
    if (!seller) return renderRegistration();
    if (!seller.paypalReady && !isDemoMode()) return renderPayPalActivation(seller);
    renderListingForm(seller);
  }

  function init() {
    api("/v1/paypal/config").then(function (d) {
      config = d;
      var seller = M.getSeller();
      var params = new URLSearchParams(location.search);
      if (seller && params.get("paypal") === "return" && !isDemoMode()) return syncSellerStatus(seller);
      render();
    }).catch(function (e) {
      root.innerHTML = '<div class="panel"><h1>Marketplace temporairement indisponible</h1><p>' + esc(e.message) + '</p></div>';
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
