(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("root");
  var seller = M.getSeller();
  if (!M.getToken() || !seller) { root.innerHTML = "<p>Connectez votre compte vendeur sur <a href='vendre.html'>Vendre</a>.</p>"; return; }

  function senderForm(sender, ready) {
    sender = sender || {};
    return "<section style='border:1px solid rgba(212,175,55,.25);padding:14px;margin:14px 0;border-radius:10px'>" +
      "<h2>Adresse d'expédition Live</h2><p>" + (ready ? "✅ Adresse expéditeur prête." : "⚠️ Renseignez cette adresse avant de démarrer un Live.") + "</p>" +
      "<form id='sellerSenderForm' style='display:grid;gap:8px;max-width:620px'>" +
      "<label>Nom / raison sociale<input id='sp-name' required value='" + M.esc(sender.name || seller.displayName || "") + "'></label>" +
      "<label>Adresse<input id='sp-address1' required value='" + M.esc(sender.addressLine1 || "") + "'></label>" +
      "<label>Complément<input id='sp-address2' value='" + M.esc(sender.addressLine2 || "") + "'></label>" +
      "<label>Code postal<input id='sp-postal' required value='" + M.esc(sender.postalCode || "") + "'></label>" +
      "<label>Ville<input id='sp-city' required value='" + M.esc(sender.city || "") + "'></label>" +
      "<label>Pays<input id='sp-country' required maxlength='2' value='" + M.esc(sender.countryCode || "FR") + "'></label>" +
      "<label>Téléphone<input id='sp-phone' value='" + M.esc(sender.phone || "") + "'></label>" +
      "<button type='submit'>Enregistrer l'adresse d'expédition</button></form><p id='sp-state'></p></section>";
  }

  function renderShipments(items) {
    if (!items || !items.length) return "<p>Aucune expédition Live.</p>";
    return items.map(function (s) {
      var label = s.labelUrl ? " · <a target='_blank' rel='noopener' href='" + M.esc(s.labelUrl) + "'>Étiquette PDF</a>" : "";
      var tracking = s.trackingUrl ? "<a target='_blank' rel='noopener' href='" + M.esc(s.trackingUrl) + "'>" + M.esc(s.trackingNumber || "Suivi") + "</a>" : M.esc(s.trackingNumber || "—");
      return "<div style='border:1px solid rgba(212,175,55,.25);padding:12px;margin:8px 0;border-radius:8px'><strong>" + M.esc(s.buyerName || s.buyerEmail) +
        "</strong> — " + M.esc(s.carrier || s.carrierCode || "") + " — " + M.esc(s.status || "") +
        "<p>Suivi : " + tracking + label + "</p><p>Payeur port : " + M.esc(s.payer || "") + " · " + M.esc(String(s.weightGrams || 0)) + " g</p></div>";
    }).join("");
  }

  root.innerHTML = "<p>Chargement espace vendeur…</p>";
  Promise.all([
    M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/orders"),
    M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/sender-profile"),
    fetch((window.CARDORIA_BACKEND || location.origin) + "/api/live/seller/shipments", { headers: { Authorization: "Bearer " + M.getToken(), Accept: "application/json" }, cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return { shipments: [] }; })
  ]).then(function (r) {
    var d = r[0], profile = r[1], liveShipping = r[2];
    root.innerHTML = "<p><strong>" + M.esc(seller.displayName) + "</strong> " + M.sellerBadge(seller) + "</p>" +
      "<p><a href='mes-annonces.html'>Mes annonces</a> · <a href='vendre.html'>Publier</a> · <a href='live-vendeur.html'>Live vendeur (PayPal)</a></p>" +
      senderForm(profile.sender, profile.ready) +
      "<h2>Expéditions Live</h2>" + renderShipments(liveShipping.shipments || []) +
      "<h2>Commandes Marketplace à traiter</h2>" + ((d.orders || []).map(function (o) {
        return "<div style='border:1px solid rgba(212,175,55,.25);padding:12px;margin:8px 0;border-radius:8px'><strong>" + M.esc(o.id) + "</strong> — " + M.esc(o.listingTitle) + " — " + M.euro(o.total) + " — " + M.esc(o.status) + ((o.status === "paid" || o.status === "preparing") ? "<div style='margin-top:8px'><input placeholder='N° suivi' id='tr-" + M.esc(o.id) + "'><button type='button' data-oid='" + M.esc(o.id) + "'>Marquer expédié</button></div>" : "") + (o.shippingTracking ? "<p>Suivi : " + M.esc(o.shippingTracking) + "</p>" : "") + "</div>";
      }).join("") || "<p>Aucune commande.</p>");

    var form = document.getElementById("sellerSenderForm");
    if (form) form.onsubmit = function (event) {
      event.preventDefault();
      var state = document.getElementById("sp-state");
      if (state) state.textContent = "Enregistrement…";
      M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/sender-profile", {
        method: "PUT",
        body: JSON.stringify({
          name: document.getElementById("sp-name").value,
          addressLine1: document.getElementById("sp-address1").value,
          addressLine2: document.getElementById("sp-address2").value,
          postalCode: document.getElementById("sp-postal").value,
          city: document.getElementById("sp-city").value,
          countryCode: document.getElementById("sp-country").value,
          phone: document.getElementById("sp-phone").value
        })
      }).then(function () { location.reload(); }).catch(function (e) { if (state) state.textContent = e.message; });
    };

    root.querySelectorAll("button[data-oid]").forEach(function (btn) {
      btn.onclick = function () {
        var tracking = document.getElementById("tr-" + btn.dataset.oid).value;
        M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/orders/" + encodeURIComponent(btn.dataset.oid) + "/tracking", { method: "PUT", body: JSON.stringify({ status: "shipped", tracking: tracking }) }).then(function () { location.reload(); }).catch(function (e) { alert(e.message); });
      };
    });
  }).catch(function (e) { root.innerHTML = "<p>" + M.esc(e.message) + "</p>"; });
})();
