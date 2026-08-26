(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var LABELS = { pokemon: "Pokémon", yugioh: "Yu-Gi-Oh!", onepiece: "One Piece", lorcana: "Lorcana", magic: "Magic" };
  var state = { page: 1, q: "", license: "", sort: "recent", negotiable: false };
  function el(id) { return document.getElementById(id); }
  function escapeHtml(value) { return M.esc(value); }
  function safeImage(value) { try { var u = new URL(String(value || ""), location.origin); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (_) { return ""; } }
  function showCategories() {
    state.license = ""; state.page = 1; state.q = ""; state.negotiable = false;
    if (el("mkSearch")) el("mkSearch").value = ""; if (el("mkNeg")) el("mkNeg").classList.remove("active");
    el("mkCategoryView")?.removeAttribute("hidden"); el("mkListingView")?.setAttribute("hidden", ""); history.replaceState(null, "", "/marketplace.html");
  }
  function openCategory(slug, updateUrl) {
    if (!LABELS[slug]) return;
    state.license = slug; state.page = 1; state.q = ""; state.negotiable = false;
    if (el("mkCurrentCategory")) el("mkCurrentCategory").textContent = LABELS[slug];
    if (el("mkListingTitle")) el("mkListingTitle").textContent = "Cartes " + LABELS[slug] + " disponibles";
    if (el("mkSearch")) el("mkSearch").value = ""; if (el("mkNeg")) el("mkNeg").classList.remove("active");
    el("mkCategoryView")?.setAttribute("hidden", ""); el("mkListingView")?.removeAttribute("hidden");
    if (updateUrl !== false) history.replaceState(null, "", "/marketplace.html?categorie=" + encodeURIComponent(slug));
    load();
  }
  function renderCards(data) {
    var grid = el("mkGrid"), pages = el("mkPages"), ms = el("mkMs"); if (!grid) return;
    var listings = Array.isArray(data.listings) ? data.listings : [];
    grid.innerHTML = listings.map(function (listing) {
      var image = safeImage(listing.photos && listing.photos[0]);
      var photo = image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(listing.title) + '" loading="lazy" width="240" height="200">' : '<div class="mk-card-placeholder" aria-hidden="true">CARTE</div>';
      var negotiable = listing.negotiable ? '<span class="mk-badge mk-badge-neg">Négociable</span>' : "";
      var sellerName = listing.seller ? escapeHtml(listing.seller.displayName) : "Vendeur Cardoria";
      return '<a class="mk-card" href="' + escapeHtml(M.listingUrl(listing.id)) + '"><div class="mk-card-img">' + photo + '</div><div class="mk-card-body"><h3>' + escapeHtml(listing.title) + '</h3><p class="mk-card-meta">' + escapeHtml(listing.condition) + ' • Stock : ' + Number(listing.stock || 0) + '</p><div class="mk-card-price">' + M.euro(listing.price) + '</div><div class="mk-card-badges">' + negotiable + '</div><div class="mk-seller-row">' + M.sellerBadge(listing.seller) + '<span>' + sellerName + '</span></div></div></a>';
    }).join("") || '<div class="mk-empty"><strong>Aucune annonce dans cette catégorie.</strong><span>Les nouvelles cartes mises en vente apparaîtront ici automatiquement.</span></div>';
    if (ms) ms.textContent = data.ms != null ? data.ms + " ms" : "";
    if (!pages) return; pages.innerHTML = "";
    var pagination = data.pagination || { page: 1, pages: 1 }; if (pagination.pages <= 1) return;
    for (var i = 1; i <= Math.min(pagination.pages, 15); i += 1) {
      var button = document.createElement("button"); button.type = "button"; button.textContent = i; if (i === pagination.page) button.className = "active";
      button.addEventListener("click", (function (pageNumber) { return function () { state.page = pageNumber; load(); el("mkListingView")?.scrollIntoView({ behavior: "smooth", block: "start" }); }; })(i)); pages.appendChild(button);
    }
  }
  function renderError() { if (el("mkGrid")) el("mkGrid").innerHTML = '<div class="mk-empty"><strong>Marketplace momentanément indisponible.</strong><span>Impossible de charger les annonces pour le moment.</span></div>'; if (el("mkMs")) el("mkMs").textContent = ""; }
  function load() {
    if (!state.license) return; if (el("mkGrid")) el("mkGrid").innerHTML = '<div class="engine-loading">Chargement des annonces…</div>';
    var params = new URLSearchParams({ q: state.q, license: state.license, sort: state.sort, page: state.page, limit: 24 }); if (state.negotiable) params.set("negotiable", "1");
    M.api("/v1/search?" + params.toString()).then(renderCards).catch(renderError);
  }
  function init() {
    document.querySelectorAll("[data-market-category]").forEach(function (button) { button.addEventListener("click", function () { openCategory(button.getAttribute("data-market-category")); }); });
    el("mkBackCategories")?.addEventListener("click", showCategories);
    if (el("mkSearch")) el("mkSearch").addEventListener("input", function () { state.q = el("mkSearch").value.trim(); state.page = 1; clearTimeout(window._mkTimer); window._mkTimer = setTimeout(load, 250); });
    if (el("mkSort")) el("mkSort").addEventListener("change", function () { state.sort = el("mkSort").value; state.page = 1; load(); });
    if (el("mkNeg")) el("mkNeg").addEventListener("click", function () { state.negotiable = !state.negotiable; state.page = 1; el("mkNeg").classList.toggle("active", state.negotiable); load(); });
    M.api("/shipping/options").then(function (data) { window._shippingOptions = data.options || []; }).catch(function () {});
    var initialCategory = new URLSearchParams(location.search).get("categorie"); if (initialCategory && LABELS[initialCategory]) openCategory(initialCategory, false); else showCategories();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
