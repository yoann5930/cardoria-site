(function () {
  "use strict";

  var BACKEND = window.CARDORIA_BACKEND || (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || window.location.origin;
  var ADMIN_CODE_KEY = "cardoria_admin_code";
  var SESSION_KEY = "cardoria_session_token";
  var CSRF_KEY = "cardoria_csrf_token";

  var NAV = [
    { section: "Pilotage" },
    { href: "admin.html", label: "Tableau de bord", page: "dashboard" },
    { href: "admin-statistiques.html", label: "Statistiques site", page: "stats" },
    { section: "Opérations" },
    { href: "admin-comptabilite.html", label: "Comptabilité", page: "accounting" },
    { href: "admin-paiements.html", label: "Paiements", page: "payments" },
    { href: "admin-commandes.html", label: "Commandes", page: "orders" },
    { href: "admin-stock.html", label: "Stock", page: "stock" },
    { href: "admin-estimations.html", label: "Estimations", page: "estimations" },
    { href: "admin-ia.html", label: "IA Premium", page: "ai" },
    { href: "admin-scanner.html", label: "Scanner IA", page: "scanner" },
    { href: "admin-marche.html", label: "Données marché", page: "marche" },
    { href: "admin-sante.html", label: "Santé & fiabilité", page: "sante" },
    { href: "admin-performance-ia.html", label: "Performance IA", page: "performance" },
    { href: "admin-ai-enterprise.html", label: "IA Enterprise", page: "ai-enterprise" },
    { href: "admin-ultimate.html", label: "Ultimate Enterprise", page: "ultimate" },
    { href: "admin-bigdata.html", label: "Big Data Engine", page: "bigdata" },
    { section: "Catalogue" },
    { href: "admin-catalogue.html", label: "Moteur cartes", page: "catalog" },
    { href: "admin-marketplace.html", label: "Marketplace", page: "marketplace" },
    { section: "Administration" },
    { href: "admin-utilisateurs.html", label: "Utilisateurs", page: "users" },
    { href: "admin-journal.html", label: "Journal", page: "audit" },
    { href: "admin-integrations.html", label: "Google & SEO", page: "integrations" },
    { href: "admin-seo.html", label: "SEO Enterprise", page: "seo" }
  ];

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }

  function getCode() { return sessionStorage.getItem(ADMIN_CODE_KEY) || ""; }
  function getSessionToken() { return sessionStorage.getItem(SESSION_KEY) || ""; }

  function clearAdminSession() {
    sessionStorage.removeItem("cardoria_admin_connected");
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(CSRF_KEY);
    sessionStorage.removeItem(ADMIN_CODE_KEY);
    sessionStorage.removeItem("cardoria_admin_email");
  }

  function protectAdmin() {
    if (sessionStorage.getItem("cardoria_admin_connected") !== "yes" || !getSessionToken()) {
      clearAdminSession();
      location.href = "admin-login.html";
      return false;
    }
    return true;
  }

  async function adminFetch(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var token = getSessionToken();
    if (token) opts.headers.Authorization = "Bearer " + token;
    var csrf = sessionStorage.getItem(CSRF_KEY);
    if (csrf) opts.headers["x-csrf-token"] = csrf;
    var code = getCode();
    if (code) opts.headers["x-cardoria-admin-code"] = code;
    if (!(opts.body instanceof FormData)) opts.headers["Content-Type"] = opts.headers["Content-Type"] || "application/json";

    var response = await fetch(BACKEND + path, opts);
    var type = response.headers.get("content-type") || "";
    var data = type.includes("application/json") ? await response.json() : await response.text();
    if (response.status === 401) {
      clearAdminSession();
      location.href = "admin-login.html";
      throw new Error("Session administrateur expirée.");
    }
    if (!response.ok) {
      var message = data && data.error ? data.error : (typeof data === "string" && data ? data : "Erreur serveur Cardoria.");
      var error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function adminDownload(path, filename) {
    var token = getSessionToken();
    var headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    var response = await fetch(BACKEND + path, { headers: headers, cache: "no-store" });
    if (response.status === 401) {
      clearAdminSession();
      location.href = "admin-login.html";
      throw new Error("Session administrateur expirée.");
    }
    if (!response.ok) throw new Error("Téléchargement impossible.");
    var blob = await response.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "cardoria-export";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function renderShell(activePage, title, subtitle, mainHtml) {
    var navHtml = NAV.map(function (item) {
      if (item.section) return '<div class="admin-nav-section">' + esc(item.section) + "</div>";
      var cls = item.page === activePage ? " active" : "";
      return '<a class="' + cls.trim() + '" href="' + encodeURI(item.href) + '">' + esc(item.label) + "</a>";
    }).join("");

    document.body.className = "admin-app";
    document.body.innerHTML =
      '<div class="admin-layout">' +
      '<aside class="admin-sidebar">' +
      '<div class="admin-brand"><img src="/assets/logo/cardoria-premium.png" alt="Cardoria" onerror="this.onerror=null;this.src=\'/logo-cardoria.jpg\'"><span>CARDORIA</span></div>' +
      '<nav class="admin-nav">' + navHtml + "</nav>" +
      '<button type="button" class="btn btn-secondary" style="width:100%;margin-top:24px" id="adminLogoutBtn">Déconnexion</button>' +
      "</aside>" +
      '<main class="admin-main">' +
      '<div class="admin-topbar"><div><h1>' + esc(title) + "</h1>" + (subtitle ? "<p>" + esc(subtitle) + "</p>" : "") + "</div></div>" +
      mainHtml +
      "</main></div>";

    qs("#adminLogoutBtn").addEventListener("click", adminLogout);
  }

  function adminLogout() {
    var token = getSessionToken();
    if (token) fetch(BACKEND + "/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(function () {});
    clearAdminSession();
    location.href = "admin-login.html";
  }

  function drawChart(canvasId, labels, values) {
    var c = qs("#" + canvasId);
    if (!c) return;
    var ctx = c.getContext("2d"), w = c.width, h = c.height, pad = 48;
    var max = Math.max.apply(null, values.concat([1]));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(212,175,55,.2)";
    ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
    var pts = values.map(function (v, i) { return { x: pad + i * ((w - 2 * pad) / Math.max(values.length - 1, 1)), y: h - pad - (v / max) * (h - 2 * pad) }; });
    ctx.strokeStyle = "#ffe18a"; ctx.lineWidth = 3; ctx.beginPath();
    pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
    ctx.fillStyle = "#baaf97"; ctx.font = "11px Arial";
    labels.forEach(function (lb, i) { if (i % Math.ceil(labels.length / 8) === 0) ctx.fillText(lb, pts[i].x - 12, h - pad + 18); });
  }

  function periodButtons(containerId, callback) {
    var box = qs("#" + containerId); if (!box) return;
    box.querySelectorAll("button").forEach(function (btn) { btn.addEventListener("click", function () { box.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); }); btn.classList.add("active"); callback(btn.dataset.period); }); });
  }

  function fmtEv(e) { if (!e) return "—"; var sign = e.percent > 0 ? "+" : ""; return sign + (e.percent ?? 0) + " %"; }
  function formatMarketIndex(idx, rec) {
    if (!idx || (!idx.cardoriaMarketScore && idx.cardoriaMarketScore !== 0)) return "";
    var ev = idx.evolution || {}, recHtml = "";
    if (rec && rec.primary) recHtml = "<tr><th>Recommandation</th><td>" + esc(rec.primary.label) + "</td></tr>";
    return "<div class='admin-panel' style='padding:12px;margin-top:10px'><h3>Cardoria Market Score : " + esc(idx.cardoriaMarketScore) + "/100</h3><table class='admin-table'><tr><th>Demande</th><td>" + esc(idx.demand ?? "—") + "</td></tr><tr><th>Évolution 7 j</th><td>" + esc(fmtEv(ev.days7)) + "</td></tr>" + recHtml + "</table></div>";
  }
  function formatAdminPricing(p) { if (!p) return "<p>—</p>"; var m = p.market || p; return "<div class='admin-panel' style='padding:12px;margin-top:10px'><h3>Estimation achat / revente</h3><table class='admin-table'><tr><th>Marché bas</th><td>" + euro(m.low ?? p.low) + "</td></tr><tr><th>Marché moyen</th><td>" + euro(m.avg ?? p.avg) + "</td></tr><tr><th>Marché haut</th><td>" + euro(m.high ?? p.high) + "</td></tr><tr><th>Revente conseillée</th><td>" + euro(p.resell ?? p.recommended) + "</td></tr></table></div>" + formatMarketIndex(p.marketIndex, p.adminRecommendation); }
  function formatCardoriaIntelligence() { return ""; }

  window.CardoriaAdmin = { BACKEND: BACKEND, qs: qs, euro: euro, esc: esc, getCode: getCode, getSessionToken: getSessionToken, protectAdmin: protectAdmin, adminFetch: adminFetch, adminDownload: adminDownload, renderShell: renderShell, adminLogout: adminLogout, drawChart: drawChart, periodButtons: periodButtons, formatAdminPricing: formatAdminPricing, formatCardoriaIntelligence: formatCardoriaIntelligence, formatMarketIndex: formatMarketIndex };
})();