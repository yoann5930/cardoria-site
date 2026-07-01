/**
 * Client API du moteur Cardoria — catalogue centralisé.
 */
(function (global) {
  "use strict";

  var BACKEND = global.CARDORIA_BACKEND || "https://cardoria-site-2.onrender.com";
  var cache = { licenses: null, licensesAt: 0 };

  function fetchJson(path) {
    return fetch(BACKEND + path, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); });
  }

  function getLicenses(force) {
    if (!force && cache.licenses && Date.now() - cache.licensesAt < 300000) {
      return Promise.resolve(cache.licenses);
    }
    return fetchJson("/api/engine/licenses").then(function (d) {
      if (d.ok) { cache.licenses = d.licenses; cache.licensesAt = Date.now(); }
      return d.licenses || [];
    });
  }

  function searchCards(params) {
    var q = new URLSearchParams(params || {}).toString();
    return fetchJson("/api/engine/cards?" + q);
  }

  function autocomplete(q, limit) {
    return fetchJson("/api/engine/cards/search?q=" + encodeURIComponent(q) + "&limit=" + (limit || 8))
      .then(function (d) { return d.results || []; });
  }

  function getCard(id) {
    return fetchJson("/api/engine/cards/" + encodeURIComponent(id)).then(function (d) { return d.card; });
  }

  function getCardBySlug(license, slug) {
    return fetchJson("/api/engine/cards/" + encodeURIComponent(license) + "/" + encodeURIComponent(slug))
      .then(function (d) { return d.card; });
  }

  function estimatePrice(cardId, condition) {
    return fetch(BACKEND + "/api/engine/estimate-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: cardId, condition: condition || "nm" })
    }).then(function (r) { return r.json(); });
  }

  function cardUrl(card) {
    return "carte.html?license=" + encodeURIComponent(card.license || card.licenseSlug) + "&slug=" + encodeURIComponent(card.slug);
  }

  function licenseUrl(slug) {
    return "licence.html?slug=" + encodeURIComponent(slug);
  }

  function euro(n) {
    return Number(n || 0).toFixed(2).replace(".", ",") + " €";
  }

  global.CardoriaEngine = {
    BACKEND: BACKEND,
    getLicenses: getLicenses,
    searchCards: searchCards,
    autocomplete: autocomplete,
    getCard: getCard,
    getCardBySlug: getCardBySlug,
    estimatePrice: estimatePrice,
    cardUrl: cardUrl,
    licenseUrl: licenseUrl,
    euro: euro
  };
})(window);
