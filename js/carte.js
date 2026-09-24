(function () {
  "use strict";

  var E = window.CardoriaEngine;
  var params = new URLSearchParams(location.search);
  var routeCard = window.CARDORIA_CARD_ROUTE || {};
  var license = routeCard.license || params.get("license");
  var slug = routeCard.slug || params.get("slug");
  var id = params.get("id");
  var root = document.getElementById("cardPage");
  var currentCardId = null;
  var serverSeo = !!document.querySelector('meta[name="cardoria:server-seo"][content="true"]');
  if (!root || !E) return;

  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function safeImage(value) {
    try {
      var url = new URL(String(value || ""));
      return /^(https?:)$/.test(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch (error) { return ""; }
  }

  function loadPriceHistory(cardId, period) {
    currentCardId = cardId;
    var backend = (window.CardoriaAI && CardoriaAI.BACKEND) || E.BACKEND;
    fetch(backend + "/api/ai/history/" + encodeURIComponent(cardId) + "?period=" + period)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.history) return;
        drawHistoryChart(d.history.points || []);
        var box = document.getElementById("historyPeriods");
        if (box) {
          box.querySelectorAll("button").forEach(function (btn) {
            btn.classList.toggle("active", btn.dataset.period === String(period));
            btn.onclick = function () { loadPriceHistory(cardId, btn.dataset.period); };
          });
        }
      }).catch(function () { /* Optional history must not erase the card. */ });
  }

  function drawHistoryChart(points) {
    var c = document.getElementById("priceHistoryChart");
    if (!c || !points.length) return;
    var ctx = c.getContext("2d"), w = c.width, h = c.height, pad = 44;
    var vals = points.map(function (p) { return p.recommended || p.avg; });
    var max = Math.max.apply(null, vals.concat([1]));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(212,175,55,.2)";
    ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
    ctx.strokeStyle = "#ffe18a"; ctx.lineWidth = 2; ctx.beginPath();
    vals.forEach(function (v, i) {
      var x = pad + i * ((w - 2 * pad) / Math.max(vals.length - 1, 1));
      var y = h - pad - (v / max) * (h - 2 * pad);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  function loadTrendsHint() {
    var backend = (window.CardoriaAI && CardoriaAI.BACKEND) || E.BACKEND;
    fetch(backend + "/api/ai/trends?limit=5")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = document.getElementById("aiTrendsBox");
        if (!box || !d.trends) return;
        var mine = d.trends.filter(function (t) { return t.cardId === currentCardId; })[0];
        if (mine) box.innerHTML = "<p style='margin-top:12px'>" + trendLabel(mine.direction, mine.changePercent) + " sur 30 jours</p>";
      }).catch(function () { /* Optional trend data. */ });
  }

  function trendLabel(t, p) {
    var cls = ["up", "down", "stable"].indexOf(t) >= 0 ? t : "stable";
    var percent = Number.isFinite(Number(p)) ? Number(p) : 0;
    var txt = cls === "up" ? "Hausse " + percent + " %" : cls === "down" ? "Baisse " + Math.abs(percent) + " %" : "Stable";
    return '<span class="engine-trend ' + cls + '">' + txt + "</span>";
  }

  function renderCard(card) {
    applySeo(card);
    var image = safeImage(card.imageHd) || safeImage(card.imageThumb);
    var lang = { fr: "FR", en: "EN", ja: "JA", ko: "KO" }[String(card.language || "fr").toLowerCase()] || "FR";
    var alt = [card.name, card.extension, card.number, lang].filter(Boolean).join(" — ");
    var heading = [card.name, card.number].filter(Boolean).join(" ") + (card.extension ? " — " + card.extension : "");
    var img = image
      ? '<img src="' + escape(image) + '" alt="' + escape(alt) + '" loading="eager" fetchpriority="high" width="360" height="504">'
      : '<div class="placeholder">Visuel indisponible</div>';
    var prices = card.prices || {};
    var licenseSlug = card.license || card.licenseSlug || "pokemon";

    var sales = (card.salesHistory || []).map(function (s) {
      return "<tr><td>" + escape(s.date) + "</td><td>" + escape(E.euro(s.price)) + "</td><td>" + escape(s.condition || "—") + "</td><td>" + escape(s.channel || "Cardoria") + "</td></tr>";
    }).join("") || "<tr><td colspan='4'>Aucune vente enregistrée</td></tr>";

    root.innerHTML =
      '<nav class="engine-breadcrumb"><a href="/">Accueil</a> › <a href="/pages/licences/' + encodeURIComponent(licenseSlug) + '/">' + escape(card.licenseName || licenseSlug) + '</a> › ' + escape(card.name) + "</nav>" +
      "<h1>" + escape(heading) + "</h1>" +
      '<div class="engine-card-layout">' +
      '<div class="engine-card-visual">' + img + "</div>" +
      "<div>" +
      '<div class="engine-meta-grid">' +
      meta("Extension", card.extension) + meta("Numéro", card.number) + meta("Rareté", card.rarity) + meta("Illustrateur", card.illustration) +
      meta("État réf.", card.condition) + meta("Licence", card.licenseName || licenseSlug) +
      "</div>" +
      '<div class="engine-prices">' +
      priceBox("Prix moyen", prices.avg) +
      priceBox("Prix bas", prices.low) +
      priceBox("Prix haut", prices.high) +
      priceBox("Prix conseillé", prices.recommended, true) +
      "</div>" +
      '<p class="small">Données de référence lorsqu’elles sont disponibles, et non une offre de vente. La valeur dépend notamment de l’état, de la langue et de la version de la carte.</p>' +
      trendLabel(card.marketTrend, card.trendPercent) +
      '<div id="cardIntelligenceBox" style="margin-top:18px"></div>' +
      '<div class="actions" style="margin-top:18px"><a class="btn btn-primary" href="/estimation.html?card=' + encodeURIComponent(card.id) + '">Faire estimer cette carte</a> <a class="btn btn-secondary" href="/rachat-cartes.html">Vendre à Cardoria</a></div>' +
      '<section class="engine-section"><h2>Historique des ventes</h2><div class="table-wrap"><table class="engine-sales-table"><thead><tr><th>Date</th><th>Prix</th><th>État</th><th>Canal</th></tr></thead><tbody>' + sales + "</tbody></table></div></section>" +
      '<section class="engine-section" id="aiHistorySection"><h2>Évolution des prix</h2><div class="admin-periods" id="historyPeriods"><button data-period="7">7 j</button><button data-period="30" class="active">30 j</button><button data-period="90">90 j</button><button data-period="365">1 an</button></div><canvas class="ai-chart" id="priceHistoryChart" width="900" height="220"></canvas><div id="aiTrendsBox"></div></section>' +
      "</div></div>";

    loadPriceHistory(card.id, "30");
    loadTrendsHint();
    loadIntelligence(card.id);
  }

  function loadIntelligence(cardId) {
    var box = document.getElementById("cardIntelligenceBox");
    if (!box || !window.CardoriaAI) return;
    var backend = CardoriaAI.BACKEND || E.BACKEND;
    fetch(backend + "/api/ai/intelligence/" + encodeURIComponent(cardId))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.intelligence) return;
        box.innerHTML = CardoriaAI.renderIntelligencePanel(d.intelligence);
      }).catch(function () { /* Optional enrichment. */ });
  }

  function meta(label, val) {
    return '<div class="engine-meta-item"><label>' + escape(label) + '</label><strong>' + escape(val || "Non renseigné") + "</strong></div>";
  }

  function priceBox(label, val, rec) {
    var amount = (typeof val === "number" || typeof val === "string") ? Number(val) : NaN;
    var text = Number.isFinite(amount) && amount > 0 ? E.euro(amount) : "Non disponible";
    return '<div class="engine-price-box' + (rec ? " recommended" : "") + '"><label>' + escape(label) + "</label><strong>" + escape(text) + "</strong></div>";
  }

  function applySeo(card) {
    // The server owns canonical metadata and JSON-LD for dynamic card URLs.
    if (serverSeo) return;
    var title = card.meta?.title || card.name + " — " + card.extension + " | Cardoria";
    var desc = card.meta?.description || "Fiche " + card.name + " : extension, numéro, rareté et données de prix disponibles sur Cardoria.";
    var siteUrl = (window.CARDORIA_SEO?.siteUrl || location.origin || "https://www.cardoriashop.fr").replace(/\/$/, "");
    var licenseSlug = card.license || card.licenseSlug || "pokemon";
    var url = siteUrl + "/cartes/" + encodeURIComponent(licenseSlug) + "/" + encodeURIComponent(card.slug);
    var image = safeImage(card.imageHd) || safeImage(card.imageThumb);
    document.title = title;
    setMeta("description", desc);
    setMeta("og:title", title, "property");
    setMeta("og:description", desc, "property");
    setMeta("og:url", url, "property");
    setMeta("twitter:title", title);
    setMeta("twitter:description", desc);
    setLink("canonical", url);
    if (image) setMeta("og:image", image, "property");

    var ldProduct = document.getElementById("cardoria-reference-product") || document.createElement("script");
    ldProduct.id = "cardoria-reference-product";
    ldProduct.type = "application/ld+json";
    // Market reference prices and past sales are not current sale offers.
    ldProduct.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: card.name,
      description: desc,
      image: image || undefined,
      brand: { "@type": "Brand", name: card.licenseName || licenseSlug },
      sku: card.number || card.id,
      url: url
    });
    if (!ldProduct.parentNode) document.head.appendChild(ldProduct);

    var ldCrumb = document.getElementById("cardoria-reference-breadcrumb") || document.createElement("script");
    ldCrumb.id = "cardoria-reference-breadcrumb";
    ldCrumb.type = "application/ld+json";
    ldCrumb.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: siteUrl + "/" },
        { "@type": "ListItem", position: 2, name: card.licenseName || licenseSlug, item: siteUrl + "/pages/licences/" + encodeURIComponent(licenseSlug) + "/" },
        { "@type": "ListItem", position: 3, name: card.name, item: url }
      ]
    });
    if (!ldCrumb.parentNode) document.head.appendChild(ldCrumb);
  }

  function setMeta(name, content, attr) {
    attr = attr || "name";
    var el = document.querySelector('meta[' + attr + '="' + name + '"]') || document.createElement("meta");
    el.setAttribute(attr, name);
    el.setAttribute("content", content);
    if (!el.parentNode) document.head.appendChild(el);
  }

  function setLink(rel, href) {
    var el = document.querySelector('link[rel="' + rel + '"]') || document.createElement("link");
    el.setAttribute("rel", rel);
    el.setAttribute("href", href);
    if (!el.parentNode) document.head.appendChild(el);
  }

  function load() {
    var promise = id ? E.getCard(id) : (license && slug ? E.getCardBySlug(license, slug) : Promise.resolve(null));
    promise.then(function (card) {
      if (!card) { root.innerHTML = "<div class='panel'><h1>Carte introuvable</h1><p><a href='/licence.html'>Retour au catalogue</a></p></div>"; return; }
      renderCard(card);
    }).catch(function () {
      // A temporary API failure must not remove the useful server-rendered page.
      if (root.getAttribute("data-server-rendered") === "true") return;
      root.innerHTML = "<div class='panel'><h1>Erreur de chargement</h1><p>Vérifiez la connexion au moteur Cardoria.</p></div>";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();