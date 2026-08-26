(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var params = new URLSearchParams(location.search);
  var id = params.get("id");
  var slug = params.get("slug");
  var root = document.getElementById("listingPage");

  function safeUrl(v) { try { var u = new URL(String(v || ""), location.origin); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (_) { return ""; } }
  function addToCart(listing, redirect) {
    return M.api("/v1/cart/add", { method: "POST", body: JSON.stringify({ userId: M.getUserId(), listingId: listing.id, qty: 1 }) }).then(function () { if (redirect) location.href = "panier-marketplace.html"; else alert("Ajouté au panier"); });
  }

  function render(listing) {
    applySeo(listing);
    var photos = listing.photos && listing.photos.length ? listing.photos : [""];
    var photo0 = safeUrl(photos[0]);
    var main = photo0 ? '<img id="mainPhoto" src="' + M.esc(photo0) + '" alt="' + M.esc(listing.title) + '">' : '<span style="font-size:80px">🃏</span>';
    var thumbs = photos.map(safeUrl).filter(Boolean).map(function (p, i) { return '<img src="' + M.esc(p) + '" class="' + (i === 0 ? "active" : "") + '" data-src="' + M.esc(p) + '" alt="">'; }).join("");
    root.innerHTML = '<nav class="engine-breadcrumb"><a href="marketplace.html">Marketplace</a> › ' + M.esc(listing.title) + '</nav><div class="mk-detail"><div><div class="mk-gallery"><div class="mk-gallery-main">' + main + '</div><div class="mk-thumbs">' + thumbs + '</div></div></div><div><h1>' + M.esc(listing.title) + '</h1><p style="color:#baaf97">' + M.esc(listing.description) + '</p><p><strong>État :</strong> ' + M.esc(listing.condition) + ' • <strong>Licence :</strong> ' + M.esc(listing.license || "—") + ' • <strong>Stock :</strong> ' + Number(listing.stock || 0) + '</p>' + (listing.negotiable ? '<span class="mk-badge mk-badge-neg">Prix négociable</span> ' : '') + '<div class="mk-buy-box"><div class="mk-price-big">' + M.euro(listing.price) + '</div><div class="mk-actions"><button class="mk-btn mk-btn-primary" type="button" id="buyBtn">Acheter avec PayPal</button><button class="mk-btn mk-btn-secondary" type="button" id="cartBtn">Panier</button><button class="mk-btn mk-btn-secondary" type="button" id="favBtn">♥ Favori</button><a class="mk-btn mk-btn-secondary" href="' + M.esc(M.compareUrl({ listingId: listing.id })) + '">Comparer les prix</a></div></div>' + (listing.seller ? '<div class="mk-seller-card"><h3 style="margin:0 0 8px;color:#ffe18a">Vendeur</h3><a href="' + M.esc(M.sellerUrl(listing.seller.id)) + '" style="color:#ffe18a;font-weight:800">' + M.esc(listing.seller.displayName) + '</a> ' + M.sellerBadge(listing.seller) + '<div class="mk-stats"><div class="mk-stat"><strong>' + M.esc(listing.seller.ratingAvg || "—") + '</strong><span>Note</span></div><div class="mk-stat"><strong>' + Number(listing.seller.salesCount || 0) + '</strong><span>Ventes</span></div></div></div>' : '') + '</div></div>';
    root.querySelectorAll(".mk-thumbs img").forEach(function (t) { t.onclick = function () { var p = safeUrl(t.dataset.src); if (p && document.getElementById("mainPhoto")) document.getElementById("mainPhoto").src = p; root.querySelectorAll(".mk-thumbs img").forEach(function (x) { x.classList.remove("active"); }); t.classList.add("active"); }; });
    document.getElementById("buyBtn").onclick = function () { addToCart(listing, true).catch(function (e) { alert(e.message); }); };
    document.getElementById("cartBtn").onclick = function () { addToCart(listing, false).catch(function (e) { alert(e.message); }); };
    document.getElementById("favBtn").onclick = function () { alert("Les favoris nécessiteront votre compte Cardoria dans une prochaine mise à jour."); };
  }

  function applySeo(l) {
    var seo = l.seo || {};
    document.title = seo.title || (l.title + " — " + M.euro(l.price) + " | Marketplace Cardoria");
    setMeta("description", seo.description || (l.title + " en " + l.condition + ". " + M.euro(l.price) + " sur la marketplace Cardoria."));
    var link = document.querySelector('link[rel="canonical"]') || document.createElement("link"); link.rel = "canonical"; link.href = location.origin + "/" + (l.publicUrl || ("annonce.html?id=" + encodeURIComponent(l.id))); if (!link.parentNode) document.head.appendChild(link);
    var img = safeUrl((l.photos && l.photos[0]) || seo.image); if (img) setMeta("og:image", img, "property");
    var ld = document.createElement("script"); ld.type = "application/ld+json"; ld.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: l.title, description: l.description || l.title, image: img || undefined, offers: { "@type": "Offer", price: l.price, priceCurrency: "EUR", availability: Number(l.stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } }); document.head.appendChild(ld);
  }
  function setMeta(n, c, a) { a = a || "name"; var el = document.querySelector("meta[" + a + '="' + n + '"]') || document.createElement("meta"); el.setAttribute(a, n); el.setAttribute("content", c); if (!el.parentNode) document.head.appendChild(el); }
  var apiPath = slug ? "/v1/listings/slug/" + encodeURIComponent(slug) : id ? "/v1/listings/" + encodeURIComponent(id) : null;
  if (!apiPath) { root.innerHTML = "<div class='panel'><h1>Annonce introuvable</h1></div>"; return; }
  M.api(apiPath).then(function (d) { if (!d.listing) throw new Error("Annonce introuvable"); render(d.listing); }).catch(function () { root.innerHTML = "<div class='panel'><h1>Annonce introuvable</h1></div>"; });
})();
