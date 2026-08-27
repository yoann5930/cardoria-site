(function () {
  "use strict";

  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";
  var ADMIN_CODE_KEY = "cardoria_admin_code";
  var SESSION_KEY = "cardoria_session_token";
  var CSRF_KEY = "cardoria_csrf_token";

  var NAV_GROUPS = [
    {
      label: "Pilotage",
      icon: "◈",
      items: [
        { href: "admin.html", label: "Tableau de bord", page: "dashboard" },
        { href: "admin-statistiques.html", label: "Statistiques site", page: "stats" }
      ]
    },
    {
      label: "Commerce & gestion",
      icon: "€",
      items: [
        { href: "admin-comptabilite.html", label: "Comptabilité", page: "accounting" },
        { href: "admin-achats.html", label: "Achats", page: "purchases" },
        { href: "admin-paiements.html", label: "Paiements SumUp", page: "payments" },
        { href: "admin-commandes.html", label: "Commandes", page: "orders" },
        { href: "admin-stock.html", label: "Stock", page: "stock" },
        { href: "admin-estimations.html", label: "Estimations", page: "estimations" }
      ]
    },
    {
      label: "Catalogue & ventes",
      icon: "▣",
      items: [
        { href: "admin-catalogue.html", label: "Catalogue de référence", page: "catalog" },
        { href: "admin-marketplace.html", label: "Marketplace", page: "marketplace" }
      ]
    },
    {
      label: "IA & marché",
      icon: "✦",
      items: [
        { href: "admin-ia.html", label: "IA Premium", page: "ai" },
        { href: "admin-scanner.html", label: "Scanner IA", page: "scanner" },
        { href: "admin-marche.html", label: "Données marché", page: "marche" },
        { href: "admin-sante.html", label: "Santé & fiabilité", page: "sante" },
        { href: "admin-performance-ia.html", label: "Performance IA", page: "performance" },
        { href: "admin-ai-enterprise.html", label: "IA Enterprise", page: "ai-enterprise" },
        { href: "admin-ultimate.html", label: "Ultimate Enterprise", page: "ultimate" },
        { href: "admin-bigdata.html", label: "Big Data Engine", page: "bigdata" }
      ]
    },
    {
      label: "Administration",
      icon: "⚙",
      items: [
        { href: "admin-utilisateurs.html", label: "Utilisateurs", page: "users" },
        { href: "admin-journal.html", label: "Journal", page: "audit" },
        { href: "admin-integrations.html", label: "Google & SEO", page: "integrations" },
        { href: "admin-seo.html", label: "SEO Enterprise", page: "seo" }
      ]
    }
  ];

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }

  function getCode() { return sessionStorage.getItem(ADMIN_CODE_KEY) || ""; }
  function getSessionToken() { return sessionStorage.getItem(SESSION_KEY) || ""; }
  function protectAdmin() {
    if (sessionStorage.getItem("cardoria_admin_connected") !== "yes") {
      location.href = "admin-login.html";
      return false;
    }
    return true;
  }

  function adminHeaders(extra) {
    var h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    var token = getSessionToken();
    var code = getCode();
    var csrf = sessionStorage.getItem(CSRF_KEY) || "";
    if (token) h["Authorization"] = "Bearer " + token;
    if (code) h["x-cardoria-admin-code"] = code;
    if (csrf) h["x-csrf-token"] = csrf;
    return h;
  }

  function adminFetch(path, options) {
    var opts = Object.assign({}, options || {});
    opts.headers = adminHeaders(opts.headers);
    return fetch(BACKEND + path, opts).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        sessionStorage.removeItem("cardoria_admin_connected");
        sessionStorage.removeItem(SESSION_KEY);
        if (location.pathname.indexOf("admin-login") === -1) location.href = "admin-login.html";
      }
      return r.json().catch(function () { return { ok: false, error: "Réponse serveur invalide" }; });
    }).catch(function () { return { ok: false, error: "Serveur Cardoria indisponible" }; });
  }

  function navHtml(active) {
    return NAV_GROUPS.map(function (group, groupIndex) {
      var isActiveGroup = group.items.some(function (item) { return item.page === active; });
      return '<div class="admin-nav-group' + (isActiveGroup ? ' is-open' : '') + '" data-nav-group="' + groupIndex + '">' +
        '<button type="button" class="admin-nav-group-btn" aria-expanded="' + (isActiveGroup ? 'true' : 'false') + '">' +
        '<span class="admin-nav-group-icon">' + group.icon + '</span><span class="admin-nav-group-label">' + group.label + '</span><span class="admin-nav-chevron">›</span></button>' +
        '<div class="admin-subnav">' + group.items.map(function (item) {
          return '<a class="admin-subnav-link ' + (item.page === active ? 'active' : '') + '" href="' + item.href + '"><span class="admin-subnav-dot">•</span>' + item.label + '</a>';
        }).join("") + '</div></div>';
    }).join("");
  }

  function renderShell(active, title, subtitle, content) {
    document.body.className = "admin-app";
    document.body.innerHTML = '<div class="admin-layout"><aside class="admin-sidebar"><div class="admin-brand"><img src="/assets/logo/cardoria-premium.png" alt="Cardoria"><span>CARDORIA ADMIN</span></div><nav class="admin-nav">' + navHtml(active) + '</nav></aside><main class="admin-main"><div class="admin-topbar"><div><h1>' + title + '</h1><p>' + subtitle + '</p></div><button class="btn btn-secondary" id="adminLogout" type="button">Déconnexion</button></div>' + content + '</main></div>';
    qs("#adminLogout").onclick = adminLogout;
    document.querySelectorAll(".admin-nav-group-btn").forEach(function (button) {
      button.onclick = function () {
        var group = button.closest(".admin-nav-group");
        document.querySelectorAll(".admin-nav-group").forEach(function (other) {
          if (other !== group) { other.classList.remove("is-open"); var b = other.querySelector(".admin-nav-group-btn"); if (b) b.setAttribute("aria-expanded", "false"); }
        });
        var open = group.classList.toggle("is-open");
        button.setAttribute("aria-expanded", open ? "true" : "false");
      };
    });
  }

  function adminLogout() {
    ["cardoria_admin_connected", ADMIN_CODE_KEY, SESSION_KEY, CSRF_KEY, "cardoria_admin_email"].forEach(function (key) { sessionStorage.removeItem(key); });
    location.href = "admin-login.html";
  }

  function drawChart(canvas, points, opts) {
    var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    if (!ctx) return;
    var w = canvas.width, h = canvas.height, pad = 28;
    ctx.clearRect(0,0,w,h);
    var values = (points || []).map(function (p) { return Number(p.value != null ? p.value : p); }).filter(Number.isFinite);
    if (!values.length) { ctx.fillStyle = "#baaf97"; ctx.fillText("Aucune donnée", pad, h / 2); return; }
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values); if (max === min) max = min + 1;
    ctx.strokeStyle = "#d4af37"; ctx.lineWidth = 2; ctx.beginPath();
    values.forEach(function (v, i) { var x = pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2); var y = h - pad - ((v - min) / (max - min)) * (h - pad * 2); if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
    ctx.stroke();
  }

  function periodButtons(active, cb) {
    return [7,30,90,365].map(function (d) { return '<button type="button" class="' + (Number(active) === d ? 'active' : '') + '" data-period="' + d + '">' + (d === 365 ? '1 an' : d + ' j') + '</button>'; }).join("");
  }

  function formatMarketIndex() { return ""; }
  function formatAdminPricing() { return ""; }
  function formatCardoriaIntelligence() { return ""; }
  function formatMarketStatsBlock() { return ""; }

  window.CardoriaAdmin = { BACKEND: BACKEND, protectAdmin: protectAdmin, adminFetch: adminFetch, renderShell: renderShell, adminLogout: adminLogout, drawChart: drawChart, periodButtons: periodButtons, euro: euro, qs: qs, formatAdminPricing: formatAdminPricing, formatCardoriaIntelligence: formatCardoriaIntelligence, formatMarketStatsBlock: formatMarketStatsBlock, formatMarketIndex: formatMarketIndex };
})();
