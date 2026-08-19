(function () {
  "use strict";

  var M = window.CardoriaMarketplace;
  var LABELS = {
    pokemon: "Pokémon",
    yugioh: "Yu-Gi-Oh!",
    onepiece: "One Piece",
    lorcana: "Lorcana",
    magic: "Magic"
  };
  var state = { page: 1, q: "", license: "", sort: "recent", negotiable: false };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showCategories() {
    state.license = "";
    state.page = 1;
    state.q = "";
    state.negotiable = false;
    var search = el("mkSearch");
    var neg = el("mkNeg");
    if (search) search.value = "";
    if (neg) neg.classList.remove("active");
    el("mkCategoryView")?.removeAttribute("hidden");
    el("mkListingView")?.setAttribute("hidden", "");
    history.replaceState(null, "", "/marketplace.html");
  }

  function openCategory(slug, updateUrl) {
    if (!LABELS[slug]) return;
    state.license = slug;
    state.page = 1;
    state.q = "";
    state.negotiable = false;

    var current = el("mkCurrentCategory");
    var title = el("mkListingTitle");
    var search = el("mkSearch");
    var neg = el("mkNeg");
    if (current) current.textContent = LABELS[slug];
    if (title) title.textContent = "Cartes " + LABELS[slug] + " disponibles";
    if (search) search.value = "";
    if (neg) neg.classList.remove("active");

    el("mkCategoryView")?.setAttribute("hidden", "");
    el("mkListingView")?.removeAttribute("hidden");

    if (updateUrl !== false) {
      history.replaceState(null, "", "/marketplace.html?categorie=" + encodeURIComponent(slug));
    }
    load();
  }

  function renderCards(data) {
    var grid = el("mkGrid");
    var pages = el("mkPages");
    var ms = el("mkMs");
    if (!grid) return;

    var listings = Array.isArray(data.listings) ? data.listings : [];
    grid.innerHTML = listings.map(function (listing) {
      var photo = listing.photos && listing.photos[0]
        ? '<img src="' + escapeHtml(listing.photos[0]) + '" alt="' + escapeHtml(listing.title) + '" loading="lazy" width="240" height="200">'
        : '<div class="mk-card-placeholder" aria-hidden="true">CARTE</div>';
      var negotiable = listing.negotiable ? '<span class="mk-badge mk-badge-neg">Négociable</span>' : "";
      var sellerName = listing.seller ? escapeHtml(listing.seller.displayName) : "Vendeur Cardoria";
      return '<a class="mk-card" href="' + M.listingUrl(listing.id) + '">' +
        '<div class="mk-card-img">' + photo + '</div>' +
        '<div class="mk-card-body">' +
          '<h3>' + escapeHtml(listing.title) + '</h3>' +
          '<p class="mk-card-meta">' + escapeHtml(listing.condition) + ' • Stock : ' + Number(listing.stock || 0) + '</p>' +
          '<div class="mk-card-price">' + M.euro(listing.price) + '</div>' +
          '<div class="mk-card-badges">' + negotiable + '</div>' +
          '<div class="mk-seller-row">' + M.sellerBadge(listing.seller) + '<span>' + sellerName + '</span></div>' +
        '</div>' +
      '</a>';
    }).join("") || '<div class="mk-empty"><strong>Aucune annonce dans cette catégorie.</strong><span>Les nouvelles cartes mises en vente apparaîtront ici automatiquement.</span></div>';

    if (ms) ms.textContent = data.ms ? data.ms + " ms" : "";
    if (!pages) return;

    pages.innerHTML = "";
    var pagination = data.pagination || { page: 1, pages: 1 };
    if (pagination.pages <= 1) return;

    for (var i = 1; i <= Math.min(pagination.pages, 15); i += 1) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = i;
      if (i === pagination.page) button.className = "active";
      button.addEventListener("click", (function (pageNumber) {
        return function () {
          state.page = pageNumber;
          load();
          el("mkListingView")?.scrollIntoView({ behavior: "smooth", block: "start" });
        };
      })(i));
      pages.appendChild(button);
    }
  }

  function renderError() {
    var grid = el("mkGrid");
    if (grid) {
      grid.innerHTML = '<div class="mk-empty"><strong>Marketplace momentanément indisponible.</strong><span>Impossible de charger les annonces pour le moment.</span></div>';
    }
    var ms = el("mkMs");
    if (ms) ms.textContent = "";
  }

  function load() {
    if (!state.license) return;
    var grid = el("mkGrid");
    if (grid) grid.innerHTML = '<div class="engine-loading">Chargement des annonces…</div>';

    var params = new URLSearchParams({
      q: state.q,
      license: state.license,
      sort: state.sort,
      page: state.page,
      limit: 24
    });
    if (state.negotiable) params.set("negotiable", "1");

    fetch(M.BACKEND + "/api/marketplace/search?" + params.toString(), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("Marketplace indisponible");
        return response.json();
      })
      .then(renderCards)
      .catch(renderError);
  }

  function init() {
    document.querySelectorAll("[data-market-category]").forEach(function (button) {
      button.addEventListener("click", function () {
        openCategory(button.getAttribute("data-market-category"));
      });
    });

    el("mkBackCategories")?.addEventListener("click", showCategories);

    var search = el("mkSearch");
    var sort = el("mkSort");
    var neg = el("mkNeg");

    if (search) {
      search.addEventListener("input", function () {
        state.q = search.value.trim();
        state.page = 1;
        clearTimeout(window._mkTimer);
        window._mkTimer = setTimeout(load, 250);
      });
    }

    if (sort) {
      sort.addEventListener("change", function () {
        state.sort = sort.value;
        state.page = 1;
        load();
      });
    }

    if (neg) {
      neg.addEventListener("click", function () {
        state.negotiable = !state.negotiable;
        state.page = 1;
        neg.classList.toggle("active", state.negotiable);
        load();
      });
    }

    M.api("/shipping/options").then(function (data) {
      window._shippingOptions = data.options || [];
    }).catch(function () {});

    var initialCategory = new URLSearchParams(location.search).get("categorie");
    if (initialCategory && LABELS[initialCategory]) openCategory(initialCategory, false);
    else showCategories();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
