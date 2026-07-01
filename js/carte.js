(function () {
  "use strict";

  var E = window.CardoriaEngine;
  var params = new URLSearchParams(location.search);
  var license = params.get("license");
  var slug = params.get("slug");
  var id = params.get("id");
  var root = document.getElementById("cardPage");
  var currentCardId = null;

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
      });
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
        if (mine) {
          box.innerHTML = "<p style='margin-top:12px'>" + trendLabel(mine.direction, mine.changePercent) + " sur 30 jours</p>";
        }
      });
  }

  function trendLabel(t, p) {
    var cls = t || "stable";
    var txt = cls === "up" ? "Hausse " + p + " %" : cls === "down" ? "Baisse " + Math.abs(p) + " %" : "Stable";
    return '<span class="engine-trend ' + cls + '">' + txt + "</span>";
  }

  function renderCard(card) {
    applySeo(card);
    var img = card.imageHd || card.imageThumb
      ? '<img src="' + card.imageHd + '" alt="' + card.name + '" loading="eager" fetchpriority="high" width="360" height="504">'
      : '<div class="placeholder">🃏</div>';

    var sales = (card.salesHistory || []).map(function (s) {
      return "<tr><td>" + s.date + "</td><td>" + E.euro(s.price) + "</td><td>" + (s.condition || "—") + "</td><td>" + (s.channel || "Cardoria") + "</td></tr>";
    }).join("") || "<tr><td colspan='4'>Aucune vente enregistrée</td></tr>";

    root.innerHTML =
      '<nav class="engine-breadcrumb"><a href="index.html">Accueil</a> › <a href="licence.html?slug=' + card.license + '">' + (card.licenseName || card.license) + '</a> › ' + card.name + "</nav>" +
      "<h1>" + card.name + "</h1>" +
      '<div class="engine-card-layout">' +
      '<div class="engine-card-visual">' + img + "</div>" +
      "<div>" +
      '<div class="engine-meta-grid">' +
      meta("Extension", card.extension) + meta("Numéro", card.number) + meta("Rareté", card.rarity) + meta("Illustrateur", card.illustration) +
      meta("État réf.", card.condition) + meta("Licence", card.licenseName || card.license) +
      "</div>" +
      '<div class="engine-prices">' +
      priceBox("Prix moyen", card.prices.avg) +
      priceBox("Prix bas", card.prices.low) +
      priceBox("Prix haut", card.prices.high) +
      priceBox("Prix conseillé", card.prices.recommended, true) +
      "</div>" +
      trendLabel(card.marketTrend, card.trendPercent) +
      '<div id="cardIntelligenceBox" style="margin-top:18px"></div>' +
      '<div class="actions" style="margin-top:18px"><a class="btn btn-primary" href="estimation.html?card=' + encodeURIComponent(card.id) + '">Faire estimer cette carte</a> <a class="btn btn-secondary" href="rachat-cartes.html">Vendre à Cardoria</a></div>' +
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
      });
  }

  function meta(label, val) {
    return '<div class="engine-meta-item"><label>' + label + '</label><strong>' + (val || "—") + "</strong></div>";
  }

  function priceBox(label, val, rec) {
    return '<div class="engine-price-box' + (rec ? " recommended" : "") + '"><label>' + label + "</label><strong>" + E.euro(val) + "</strong></div>";
  }

  function applySeo(card) {
    var title = card.meta?.title || card.name + " — " + card.extension + " | Cardoria";
    var desc = card.meta?.description || "Prix " + E.euro(card.prices.recommended) + " pour " + card.name + ". Fiche complète Cardoria.";
    var url = (window.CARDORIA_SEO?.siteUrl || "") + "/carte.html?license=" + card.license + "&slug=" + card.slug;
    document.title = title;
    setMeta("description", desc);
    setMeta("og:title", title, "property");
    setMeta("og:description", desc, "property");
    setMeta("twitter:title", title);
    setMeta("twitter:description", desc);
    setLink("canonical", url);
    if (card.imageHd) setMeta("og:image", card.imageHd, "property");

    var siteUrl = window.CARDORIA_SEO?.siteUrl || "https://cardoria.vercel.app";
    var ldProduct = document.createElement("script");
    ldProduct.type = "application/ld+json";
    ldProduct.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: card.name,
      description: desc,
      image: card.imageHd || undefined,
      brand: { "@type": "Brand", name: card.licenseName || card.license },
      sku: card.number,
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "EUR",
        lowPrice: card.prices.low,
        highPrice: card.prices.high,
        offerCount: card.salesCount || 1
      }
    });
    document.head.appendChild(ldProduct);

    var ldCrumb = document.createElement("script");
    ldCrumb.type = "application/ld+json";
    ldCrumb.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: siteUrl + "/index.html" },
        { "@type": "ListItem", position: 2, name: card.licenseName || card.license, item: siteUrl + "/pages/licences/" + card.license + "/" },
        { "@type": "ListItem", position: 3, name: card.name, item: url }
      ]
    });
    document.head.appendChild(ldCrumb);
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
      if (!card) { root.innerHTML = "<div class='panel'><h1>Carte introuvable</h1><p><a href='licence.html'>Retour au catalogue</a></p></div>"; return; }
      renderCard(card);
    }).catch(function () {
      root.innerHTML = "<div class='panel'><h1>Erreur de chargement</h1><p>Vérifiez la connexion au moteur Cardoria.</p></div>";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
