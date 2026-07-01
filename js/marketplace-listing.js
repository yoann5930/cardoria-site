(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var params = new URLSearchParams(location.search);
  var id = params.get("id");
  var slug = params.get("slug");
  var root = document.getElementById("listingPage");

  function render(listing) {
    applySeo(listing);
    var photos = listing.photos && listing.photos.length ? listing.photos : [""];
    var main = photos[0]
      ? '<img id="mainPhoto" src="' + photos[0] + '" alt="' + listing.title + '">'
      : '<span style="font-size:80px">🃏</span>';
    var thumbs = photos.filter(Boolean).map(function (p, i) {
      return '<img src="' + p + '" class="' + (i === 0 ? "active" : "") + '" data-src="' + p + '" alt="">';
    }).join("");

    root.innerHTML =
      '<nav class="engine-breadcrumb"><a href="marketplace.html">Marketplace</a> › ' + listing.title + "</nav>" +
      '<div class="mk-detail"><div><div class="mk-gallery"><div class="mk-gallery-main">' + main + '</div><div class="mk-thumbs">' + thumbs + "</div></div></div>" +
      "<div><h1>" + listing.title + "</h1>" +
      "<p style='color:#baaf97'>" + listing.description + "</p>" +
      '<p><strong>État :</strong> ' + listing.condition + " • <strong>Licence :</strong> " + (listing.license || "—") + " • <strong>Stock :</strong> " + listing.stock + "</p>" +
      (listing.negotiable ? '<span class="mk-badge mk-badge-neg">Prix négociable</span> ' : "") +
      '<div class="mk-buy-box"><div class="mk-price-big">' + M.euro(listing.price) + "</div>" +
      '<div class="mk-actions">' +
      '<button class="mk-btn mk-btn-primary" type="button" id="buyBtn">Acheter — Paiement sécurisé</button>' +
      '<button class="mk-btn mk-btn-secondary" type="button" id="cartBtn">Panier</button>' +
      '<button class="mk-btn mk-btn-secondary" type="button" id="favBtn">♥ Favori</button>' +
      '<a class="mk-btn mk-btn-secondary" href="' + M.compareUrl({ listingId: listing.id }) + '">Comparer les prix</a></div>' +
      '<div id="checkoutForm" style="display:none;margin-top:16px" class="mk-form-grid">' +
      '<input id="buyEmail" placeholder="Votre email" type="email">' +
      '<input id="buyName" placeholder="Votre nom">' +
      '<input id="buyAddress" placeholder="Adresse de livraison">' +
      '<select id="buyCarrier"><option value="mondial_relay">Mondial Relay — 4,95 €</option><option value="colissimo">Colissimo — 6,50 €</option><option value="chronopost">Chronopost — 9,90 €</option></select>' +
      '<button class="mk-btn mk-btn-primary" type="button" id="payBtn">Payer par carte — SumUp</button></div></div>' +
      (listing.seller ? '<div class="mk-seller-card"><h3 style="margin:0 0 8px;color:#ffe18a">Vendeur</h3>' +
        '<a href="' + M.sellerUrl(listing.seller.id) + '" style="color:#ffe18a;font-weight:800">' + listing.seller.displayName + "</a> " +
        M.sellerBadge(listing.seller) +
        '<div class="mk-stats"><div class="mk-stat"><strong>' + (listing.seller.ratingAvg || "—") + "</strong><span>Note</span></div>" +
        '<div class="mk-stat"><strong>' + (listing.seller.salesCount || 0) + "</strong><span>Ventes</span></div></div></div>" : "") +
      "</div></div>";

    root.querySelectorAll(".mk-thumbs img").forEach(function (t) {
      t.onclick = function () {
        document.getElementById("mainPhoto").src = t.dataset.src;
        root.querySelectorAll(".mk-thumbs img").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
      };
    });

    document.getElementById("buyBtn").onclick = function () {
      document.getElementById("checkoutForm").style.display = "grid";
    };

    document.getElementById("cartBtn").onclick = function () {
      fetch(M.BACKEND + "/api/marketplace/v1/cart/add", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: M.getUserId(), listingId: listing.id, qty: 1 })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) location.href = "panier-marketplace.html";
        else alert(d.error || "Erreur panier");
      });
    };

    document.getElementById("favBtn").onclick = function () {
      M.api("/favorites", { method: "POST", body: JSON.stringify({ userId: M.getUserId(), listingId: listing.id }) })
        .then(function () { alert("Ajouté aux favoris"); });
    };

    document.getElementById("payBtn").onclick = function () {
      var email = document.getElementById("buyEmail").value;
      var name = document.getElementById("buyName").value;
      var address = document.getElementById("buyAddress").value;
      var carrier = document.getElementById("buyCarrier").value;
      if (!email) { alert("Email requis"); return; }

      M.api("/shipping/quote", { method: "POST", body: JSON.stringify({ carrier: carrier }) }).then(function (ship) {
        return M.api("/orders", {
          method: "POST",
          body: JSON.stringify({
            listingId: listing.id, buyerEmail: email, buyerName: name, buyerId: M.getUserId(),
            qty: 1, shippingCarrier: carrier, shippingCost: ship.price, shippingAddress: address
          })
        });
      }).then(function (orderRes) {
        if (!orderRes.ok) throw new Error(orderRes.error);
        return M.api("/checkout", {
          method: "POST",
          body: JSON.stringify({
            orderId: orderRes.order.id,
            successUrl: location.origin + "/marketplace-paiement-succes.html?order=" + encodeURIComponent(orderRes.order.id),
            cancelUrl: location.origin + "/marketplace-paiement-echec.html"
          })
        });
      }).then(function (pay) {
        if (pay.url) location.href = pay.url;
        else alert(pay.error || "Paiement indisponible — configurer SumUp.");
      }).catch(function (e) { alert(e.message); });
    };
  }

  function applySeo(l) {
    var seo = l.seo || {};
    document.title = seo.title || (l.title + " — " + M.euro(l.price) + " | Marketplace Cardoria");
    setMeta("description", seo.description || (l.title + " en " + l.condition + ". " + M.euro(l.price) + " sur la marketplace Cardoria."));
    if (seo.canonical || l.publicUrl) {
      var link = document.querySelector('link[rel="canonical"]') || document.createElement("link");
      link.rel = "canonical";
      link.href = location.origin + "/" + (l.publicUrl || ("annonce.html?id=" + l.id));
      if (!link.parentNode) document.head.appendChild(link);
    }
    var img = (l.photos && l.photos[0]) || seo.image;
    if (img) setMeta("og:image", img, "property");
    var ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product",
      name: l.title, description: l.description || l.title,
      image: l.photos && l.photos[0], offers: { "@type": "Offer", price: l.price, priceCurrency: "EUR", availability: "https://schema.org/InStock" }
    });
    document.head.appendChild(ld);
  }

  function setMeta(n, c, a) {
    a = a || "name";
    var el = document.querySelector("meta[" + a + '="' + n + '"]') || document.createElement("meta");
    el.setAttribute(a, n); el.setAttribute("content", c);
    if (!el.parentNode) document.head.appendChild(el);
  }

  var apiPath = slug
    ? "/v1/listings/slug/" + encodeURIComponent(slug)
    : id ? "/v1/listings/" + encodeURIComponent(id) : null;

  if (!apiPath) { root.innerHTML = "<div class='panel'><h1>Annonce introuvable</h1></div>"; return; }

  fetch(M.BACKEND + "/api/marketplace" + apiPath).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok || !d.listing) { root.innerHTML = "<div class='panel'><h1>Annonce introuvable</h1></div>"; return; }
    render(d.listing);
  });
})();
