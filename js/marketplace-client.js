/**
 * Client marketplace Cardoria — session utilisateur, API, helpers.
 */
(function (global) {
  "use strict";

  var BACKEND = global.CARDORIA_BACKEND || "https://cardoria-site-2.onrender.com";
  var USER_KEY = "cardoria_mk_user";
  var SELLER_KEY = "cardoria_mk_seller";

  function uid() {
    return "USR-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function getUserId() {
    var id = localStorage.getItem(USER_KEY);
    if (!id) { id = uid(); localStorage.setItem(USER_KEY, id); }
    return id;
  }

  function getSeller() {
    try { return JSON.parse(localStorage.getItem(SELLER_KEY) || "null"); } catch { return null; }
  }

  function setSeller(seller) {
    localStorage.setItem(SELLER_KEY, JSON.stringify(seller));
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, opts.headers || {});
    return fetch(BACKEND + "/api/marketplace" + path, opts).then(function (r) { return r.json(); });
  }

  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }

  function listingUrl(id) { return "annonce.html?id=" + encodeURIComponent(id); }
  function sellerUrl(id) { return "vendeur.html?id=" + encodeURIComponent(id); }
  function compareUrl(params) {
    var q = new URLSearchParams(params || {}).toString();
    return "comparateur.html" + (q ? "?" + q : "");
  }

  function sellerBadge(seller) {
    if (!seller) return "";
    var html = "";
    if (seller.verified) html += '<span class="mk-badge mk-badge-verified">✓ Vérifié</span> ';
    if (seller.sellerType === "professional") html += '<span class="mk-badge mk-badge-pro">Pro</span>';
    return html;
  }

  function statusClass(s) {
    if (["paid", "delivered"].includes(s)) return "mk-status-paid";
    if (["shipped", "preparing"].includes(s)) return "mk-status-shipped";
    return "mk-status-pending";
  }

  global.CardoriaMarketplace = {
    BACKEND: BACKEND,
    getUserId: getUserId,
    getSeller: getSeller,
    setSeller: setSeller,
    api: api,
    euro: euro,
    listingUrl: listingUrl,
    sellerUrl: sellerUrl,
    compareUrl: compareUrl,
    sellerBadge: sellerBadge,
    statusClass: statusClass
  };
})(window);
