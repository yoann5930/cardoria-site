/** Client Marketplace Cardoria — panier anonyme + session authentifiee pour actions sensibles. */
(function (global) {
  "use strict";
  var BACKEND = global.CARDORIA_BACKEND || global.location.origin;
  var USER_KEY = "cardoria_mk_user";
  var SELLER_KEY = "cardoria_mk_seller";
  var TOKEN_KEY = "cardoria_session_token";
  var ACCOUNT_KEY = "cardoria_account";

  function uid() { return "USR-" + cryptoRandom() + Date.now().toString(36); }
  function cryptoRandom() {
    try { var a = new Uint32Array(2); crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); }
    catch (_) { return Math.random().toString(36).slice(2, 12); }
  }
  function getUserId() { var id = localStorage.getItem(USER_KEY); if (!id) { id = uid(); localStorage.setItem(USER_KEY, id); } return id; }
  function getSeller() { try { return JSON.parse(localStorage.getItem(SELLER_KEY) || "null"); } catch (_) { return null; } }
  function setSeller(seller) { if (seller) localStorage.setItem(SELLER_KEY, JSON.stringify(seller)); else localStorage.removeItem(SELLER_KEY); }
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function getAccount() { try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null"); } catch (_) { return null; } }
  function setSession(data) {
    if (!data || !data.token) return;
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(data.user || null));
  }
  function logout() {
    var token = getToken();
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(ACCOUNT_KEY); localStorage.removeItem(SELLER_KEY);
    if (token) fetch(BACKEND + "/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(function () {});
  }
  function authHeaders(extra) {
    var h = Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, extra || {});
    var token = getToken(); if (token) h.Authorization = "Bearer " + token;
    return h;
  }
  function fetchJson(url, opts) {
    opts = opts || {}; opts.headers = authHeaders(opts.headers);
    return fetch(url, opts).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) { var e = new Error(d.error || "Erreur Cardoria"); e.status = r.status; throw e; } return d; }); });
  }
  function api(path, opts) { return fetchJson(BACKEND + "/api/marketplace" + path, opts); }
  function auth(path, opts) { return fetchJson(BACKEND + "/api/auth" + path, opts); }
  function login(email, password) { return auth("/login", { method: "POST", body: JSON.stringify({ email: email, password: password }) }).then(function (d) { setSession(d); return d; }); }
  function register(email, password, name) { return auth("/register", { method: "POST", body: JSON.stringify({ email: email, password: password, name: name }) }).then(function (d) { setSession(d); return d; }); }
  function me() { return auth("/me").then(function (d) { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(d.user)); return d.user; }); }
  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function listingUrl(id) { return "annonce.html?id=" + encodeURIComponent(id); }
  function sellerUrl(id) { return "vendeur.html?id=" + encodeURIComponent(id); }
  function compareUrl(params) { var q = new URLSearchParams(params || {}).toString(); return "comparateur.html" + (q ? "?" + q : ""); }
  function sellerBadge(seller) { if (!seller) return ""; var html = ""; if (seller.verified) html += '<span class="mk-badge mk-badge-verified">✓ Vérifié</span> '; if (seller.sellerType === "professional") html += '<span class="mk-badge mk-badge-pro">Pro</span>'; return html; }
  function statusClass(s) { if (["paid", "delivered"].includes(s)) return "mk-status-paid"; if (["shipped", "preparing"].includes(s)) return "mk-status-shipped"; return "mk-status-pending"; }

  global.CardoriaMarketplace = { BACKEND: BACKEND, getUserId: getUserId, getSeller: getSeller, setSeller: setSeller, getToken: getToken, getAccount: getAccount, setSession: setSession, logout: logout, authHeaders: authHeaders, api: api, auth: auth, login: login, register: register, me: me, euro: euro, esc: esc, listingUrl: listingUrl, sellerUrl: sellerUrl, compareUrl: compareUrl, sellerBadge: sellerBadge, statusClass: statusClass };
})(window);
