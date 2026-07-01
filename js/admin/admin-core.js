(function () {
  "use strict";

  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";
  var ADMIN_CODE_KEY = "cardoria_admin_code";
  var SESSION_KEY = "cardoria_session_token";
  var CSRF_KEY = "cardoria_csrf_token";

  var NAV = [
    { section: "Pilotage" },
    { href: "admin.html", label: "Tableau de bord", page: "dashboard" },
    { href: "admin-statistiques.html", label: "Statistiques site", page: "stats" },
    { section: "Opérations" },
    { href: "admin-comptabilite.html", label: "Comptabilité", page: "accounting" },
    { href: "admin-paiements.html", label: "Paiements SumUp", page: "payments" },
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

  function getCode() {
    return sessionStorage.getItem(ADMIN_CODE_KEY) || "";
  }

  function getSessionToken() {
    return sessionStorage.getItem(SESSION_KEY) || "";
  }

  function protectAdmin() {
    if (sessionStorage.getItem("cardoria_admin_connected") !== "yes") {
      location.href = "admin-login.html";
      return false;
    }
    return true;
  }

  function adminFetch(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var token = getSessionToken();
    if (token) opts.headers.Authorization = "Bearer " + token;
    var csrf = sessionStorage.getItem(CSRF_KEY);
    if (csrf) opts.headers["x-csrf-token"] = csrf;
    var code = getCode();
    if (code) opts.headers["x-cardoria-admin-code"] = code;
    opts.headers["Content-Type"] = opts.headers["Content-Type"] || "application/json";
    return fetch(BACKEND + path, opts).then(function (r) { return r.json(); });
  }

  function renderShell(activePage, title, subtitle, mainHtml) {
    var navHtml = NAV.map(function (item) {
      if (item.section) return '<div class="admin-nav-section">' + item.section + "</div>";
      var cls = item.page === activePage ? " active" : "";
      return '<a class="' + cls.trim() + '" href="' + item.href + '">' + item.label + "</a>";
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
      '<div class="admin-topbar"><div><h1>' + title + "</h1>" + (subtitle ? "<p>" + subtitle + "</p>" : "") + "</div></div>" +
      mainHtml +
      "</main></div>";

    qs("#adminLogoutBtn").addEventListener("click", adminLogout);
  }

  function adminLogout() {
    var token = sessionStorage.getItem(SESSION_KEY);
    if (token) {
      fetch(BACKEND + "/api/auth/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token }
      }).catch(function () {});
    }
    sessionStorage.removeItem("cardoria_admin_connected");
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(CSRF_KEY);
    sessionStorage.removeItem(ADMIN_CODE_KEY);
    sessionStorage.removeItem("cardoria_admin_email");
    location.href = "admin-login.html";
  }

  function drawChart(canvasId, labels, values) {
    var c = qs("#" + canvasId);
    if (!c) return;
    var ctx = c.getContext("2d"), w = c.width, h = c.height, pad = 48;
    var max = Math.max.apply(null, values.concat([1]));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(212,175,55,.2)";
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();
    var pts = values.map(function (v, i) {
      return { x: pad + i * ((w - 2 * pad) / Math.max(values.length - 1, 1)), y: h - pad - (v / max) * (h - 2 * pad) };
    });
    ctx.strokeStyle = "#ffe18a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke();
    ctx.fillStyle = "#baaf97";
    ctx.font = "11px Arial";
    labels.forEach(function (lb, i) {
      if (i % Math.ceil(labels.length / 8) === 0) {
        ctx.fillText(lb, pts[i].x - 12, h - pad + 18);
      }
    });
  }

  function periodButtons(containerId, callback) {
    var box = qs("#" + containerId);
    if (!box) return;
    box.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        box.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        callback(btn.dataset.period);
      });
    });
  }

  function formatMarketIndex(idx, rec) {
    if (!idx || !idx.cardoriaMarketScore && idx.cardoriaMarketScore !== 0) return "";
    var ev = idx.evolution || {};
    var recHtml = "";
    if (rec && rec.primary) {
      recHtml = "<tr><th>Recommandation</th><td><span class='admin-badge admin-badge--gold'>" + rec.primary.label + "</span>" +
        (rec.maxBuyPrice != null ? " — max " + euro(rec.maxBuyPrice) : "") +
        "<br><span style='font-size:12px;color:#baaf97'>" + (rec.primary.detail || "") + "</span></td></tr>";
      if (rec.resale && rec.resale.label !== rec.primary.label) {
        recHtml += "<tr><th>Stratégie revente</th><td><span class='admin-badge'>" + rec.resale.label + "</span>" +
          "<br><span style='font-size:12px;color:#baaf97'>" + (rec.resale.detail || "") + "</span></td></tr>";
      }
    }
    return "<div class='admin-panel' style='padding:12px;margin-top:10px;border:1px solid rgba(212,175,55,.25)'>" +
      "<h3 style='margin:0 0 10px;color:#ffe18a;font-size:16px'>Cardoria Market Score : <strong style='font-size:22px'>" + idx.cardoriaMarketScore + "</strong>/100</h3>" +
      "<table class='admin-table' style='font-size:13px'>" +
      "<tr><th>Demande actuelle</th><td>" + (idx.demand ?? "—") + " / 100</td></tr>" +
      "<tr><th>Rareté réelle</th><td>" + (idx.rarity?.label || "—") + (idx.rarity?.raw ? " (" + idx.rarity.raw + ")" : "") + "</td></tr>" +
      "<tr><th>Vitesse de vente</th><td>" + (idx.salesVelocity?.label || "—") + " (" + (idx.salesVelocity?.perWeek ?? 0) + "/sem.)</td></tr>" +
      "<tr><th>Ventes récentes (30 j)</th><td>" + (idx.recentSalesCount ?? 0) + "</td></tr>" +
      "<tr><th>Évolution 7 j</th><td>" + fmtEv(ev.days7) + "</td></tr>" +
      "<tr><th>Évolution 30 j</th><td>" + fmtEv(ev.days30) + "</td></tr>" +
      "<tr><th>Évolution 90 j</th><td>" + fmtEv(ev.days90) + "</td></tr>" +
      "<tr><th>Tendance</th><td>" + (idx.trend?.label || "—") + "</td></tr>" +
      "<tr><th>Liquidité</th><td>" + (idx.liquidity?.label || "—") + " (score " + (idx.liquidity?.score ?? "—") + ")</td></tr>" +
      "<tr><th>Niveau collection</th><td>" + (idx.collectionLevel?.label || "—") + "</td></tr>" +
      "<tr><th>Popularité licence</th><td>" + (idx.popularity?.score ?? "—") + " / 100</td></tr>" +
      recHtml +
      "</table></div>";
  }

  function fmtEv(e) {
    if (!e) return "—";
    var sign = e.percent > 0 ? "+" : "";
    return sign + (e.percent ?? 0) + " %";
  }

  function formatAdminPricing(p) {
    if (!p) return "<p>—</p>";
    var m = p.market || p;
    var rot = p.estimatedRotationLabel ? "<tr><th>Rotation estimée</th><td>" + p.estimatedRotationLabel +
      (p.estimatedRotationDays != null ? " (" + p.estimatedRotationDays + " j)" : "") + "</td></tr>" : "";
    return "<div class='admin-panel' style='padding:12px;margin-top:10px'>" +
      "<h3 style='margin:0 0 10px;color:#ffe18a;font-size:16px'>Estimation achat / revente</h3>" +
      "<table class='admin-table' style='font-size:13px'>" +
      "<tr><th>Marché bas</th><td>" + euro(m.low ?? p.low) + "</td></tr>" +
      "<tr><th>Marché moyen</th><td>" + euro(m.avg ?? p.avg) + "</td></tr>" +
      "<tr><th>Marché haut</th><td>" + euro(m.high ?? p.high) + "</td></tr>" +
      "<tr><th>Rachat Cardoria</th><td>" + (p.buyback != null ? euro(p.buyback) : "<span class='admin-badge admin-badge--danger'>À vérifier en main</span>") + "</td></tr>" +
      "<tr><th>Revente conseillée</th><td>" + euro(p.resell ?? p.recommended) + "</td></tr>" +
      "<tr><th>Marge estimée</th><td>" + (p.margin != null ? euro(p.margin) + " (" + (p.marginPercent || "—") + " %)" : "—") + "</td></tr>" +
      "<tr><th>Marge cible</th><td>" + (p.targetMarginRate != null ? p.targetMarginRate + " %" : "—") + "</td></tr>" +
      rot +
      "<tr><th>Liquidité</th><td>" + (p.liquidityLabel || "—") + "</td></tr>" +
      "<tr><th>Niveau confiance</th><td>" + (p.confidenceLevel || "—") + (p.confidenceScore != null ? " — " + p.confidenceScore + " %" : "") + "</td></tr>" +
      (p.adminNote ? "<tr><th>Note</th><td>" + p.adminNote + "</td></tr>" : "") +
      "</table></div>" +
      formatCardoriaIntelligence(p.intelligence) +
      formatMarketIndex(p.marketIndex, p.adminRecommendation);
  }

  function formatCardoriaIntelligence(intel) {
    if (!intel) return "";
    var s = intel.scores || {};
    var p = intel.pricing || {};
    var f = intel.forecasts || {};
    var h = intel.history || {};
    var rec = intel.recommendation || {};

    function histRow(key, label) {
      var pts = h[key]?.points?.length || 0;
      return "<tr><th>Historique " + label + "</th><td>" + pts + " point(s)</td></tr>";
    }

    return "<div class='admin-panel' style='padding:12px;margin-top:10px;border:1px solid rgba(212,175,55,.35)'>" +
      "<h3 style='margin:0 0 10px;color:#ffe18a;font-size:16px'>Intelligence Cardoria Premium — Score global : <strong style='font-size:22px'>" + (s.overall ?? "—") + "</strong>/100</h3>" +
      "<table class='admin-table' style='font-size:13px'>" +
      "<tr><th colspan='2' style='color:#ffe18a'>Score Cardoria (composantes)</th></tr>" +
      (s.authenticity != null ? "<tr><th>Authenticité</th><td>" + s.authenticity + " %</td></tr>" : "") +
      "<tr><th>État</th><td>" + (s.condition ?? "—") + " %</td></tr>" +
      "<tr><th>Liquidité</th><td>" + (s.liquidity ?? "—") + " %</td></tr>" +
      "<tr><th>Popularité</th><td>" + (s.popularity ?? "—") + " %</td></tr>" +
      "<tr><th>Rareté</th><td>" + (s.rarity ?? "—") + " %</td></tr>" +
      "<tr><th>Potentiel futur</th><td>" + (s.futurePotential ?? "—") + " %</td></tr>" +
      "<tr><th colspan='2' style='color:#ffe18a'>Prix marché</th></tr>" +
      "<tr><th>Moyen</th><td>" + euro(p.marketAverage ?? intel.market?.average) + "</td></tr>" +
      "<tr><th>Minimum actuel</th><td>" + euro(p.marketMinimum ?? intel.market?.minimum) + "</td></tr>" +
      "<tr><th>Maximum actuel</th><td>" + euro(p.marketMaximum ?? intel.market?.maximum) + "</td></tr>" +
      "<tr><th>Prix conseillé Cardoria</th><td>" + euro(p.cardoriaRecommended) + "</td></tr>" +
      "<tr><th>Vente rapide</th><td>" + euro(p.quickSale) + "</td></tr>" +
      "<tr><th>Vente optimale</th><td>" + euro(p.optimalSale) + "</td></tr>" +
      "<tr><th>Achat professionnel</th><td>" + (p.professionalBuy != null ? euro(p.professionalBuy) : "—") + "</td></tr>" +
      "<tr><th>Marge potentielle</th><td>" + (intel.margin?.amount != null ? euro(intel.margin.amount) + " (" + (intel.margin.percent ?? "—") + " %)" : "—") + "</td></tr>" +
      "<tr><th>Rentabilité estimée</th><td>" + (intel.margin?.estimatedProfitability != null ? intel.margin.estimatedProfitability + " % / an (proxy)" : "—") + "</td></tr>" +
      "<tr><th colspan='2' style='color:#ffe18a'>Indices & tendance</th></tr>" +
      "<tr><th>Indice rareté</th><td>" + (intel.indices?.rarity?.score ?? "—") + " — " + (intel.indices?.rarity?.label || "") + "</td></tr>" +
      "<tr><th>Indice liquidité</th><td>" + (intel.indices?.liquidity?.score ?? "—") + " — " + (intel.indices?.liquidity?.label || "") + "</td></tr>" +
      "<tr><th>Tendance</th><td>" + (intel.trend?.label || "—") + " (" + (intel.trend?.direction || "stable") + ")</td></tr>" +
      histRow("7d", "7 j") + histRow("30d", "30 j") + histRow("90d", "90 j") + histRow("1y", "1 an") +
      "<tr><th colspan='2' style='color:#ffe18a'>Prévisions IA</th></tr>" +
      "<tr><th>30 jours</th><td>" + euro(f.days30?.price) + " (" + (f.days30?.changePercent ?? 0) + " %, conf. " + (f.days30?.confidence ?? "—") + " %)</td></tr>" +
      "<tr><th>90 jours</th><td>" + euro(f.days90?.price) + " (" + (f.days90?.changePercent ?? 0) + " %, conf. " + (f.days90?.confidence ?? "—") + " %)</td></tr>" +
      "<tr><th>1 an</th><td>" + euro(f.days365?.price) + " (" + (f.days365?.changePercent ?? 0) + " %, conf. " + (f.days365?.confidence ?? "—") + " %)</td></tr>" +
      "<tr><th>Recommandation client</th><td><span class='admin-badge admin-badge--gold'>" + (rec.label || "—") + "</span><br><span style='font-size:12px;color:#baaf97'>" + (rec.detail || rec.clientHint || "") + "</span></td></tr>" +
      (intel.marketStats ? formatMarketStatsBlock(intel.marketStats) : "") +
      "</table></div>";
  }

  function formatMarketStatsBlock(ms) {
    if (!ms) return "";
    var ev = ms.evolution || {};
    return "<tr><th colspan='2' style='color:#ffe18a;padding-top:12px'>Données marché Cardoria (moteur collecte)</th></tr>" +
      "<tr><th>Volume ventes</th><td>" + (ms.volume || 0) + "</td></tr>" +
      "<tr><th>Prix médian</th><td>" + euro(ms.medianPrice) + "</td></tr>" +
      "<tr><th>Rachat moyen</th><td>" + euro(ms.buybackAvg) + "</td></tr>" +
      "<tr><th>Évol. 7 j</th><td>" + (ev.days7 ?? 0) + " %</td></tr>" +
      "<tr><th>Évol. 30 j</th><td>" + (ev.days30 ?? 0) + " %</td></tr>" +
      "<tr><th>Évol. 90 j</th><td>" + (ev.days90 ?? 0) + " %</td></tr>" +
      "<tr><th>Évol. 1 an</th><td>" + (ev.days1y ?? 0) + " %</td></tr>" +
      "<tr><th>Indice liquidité</th><td>" + (ms.indices?.liquidity ?? "—") + " / 100</td></tr>" +
      "<tr><th>Indice demande</th><td>" + (ms.indices?.demand ?? "—") + " / 100</td></tr>" +
      "<tr><th>Indice rareté</th><td>" + (ms.indices?.rarity ?? "—") + " / 100</td></tr>";
  }

  window.CardoriaAdmin = {
    BACKEND: BACKEND,
    protectAdmin: protectAdmin,
    adminFetch: adminFetch,
    renderShell: renderShell,
    adminLogout: adminLogout,
    drawChart: drawChart,
    periodButtons: periodButtons,
    euro: euro,
    qs: qs,
    formatAdminPricing: formatAdminPricing,
    formatCardoriaIntelligence: formatCardoriaIntelligence,
    formatMarketStatsBlock: formatMarketStatsBlock,
    formatMarketIndex: formatMarketIndex
  };
})();
