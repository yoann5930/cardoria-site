(function () {
  "use strict";

  var root = document.getElementById("licenceSeoRoot");
  if (!root) return;

  var slug = root.dataset.slug || new URLSearchParams(location.search).get("slug") || "pokemon";
  var base = location.pathname.indexOf("/pages/") !== -1 ? "../../" : "";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";
  var licCfg = (window.CARDORIA_SEO && CARDORIA_SEO.licenses && CARDORIA_SEO.licenses[slug]) || { name: slug };

  window.CARDORIA_SEO_PAGE = {
    breadcrumbs: [
      { name: "Accueil", url: "/index.html" },
      { name: "Licences", url: "/pages/licences/" },
      { name: licCfg.name, url: "/pages/licences/" + slug + "/" }
    ],
    type: "collection"
  };

  function upsertMeta(name, content, attr) {
    if (!content) return;
    attr = attr || "name";
    var el = document.querySelector('meta[' + attr + '="' + name + '"]');
    if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
    el.setAttribute("content", content);
  }

  function upsertLink(rel, href) {
    var el = document.querySelector('link[rel="' + rel + '"]');
    if (!el) { el = document.createElement("link"); el.setAttribute("rel", rel); document.head.appendChild(el); }
    el.setAttribute("href", href);
  }

  function injectJsonLd(data) {
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }

  function updateSocialMeta(title, description, url, image) {
    document.title = title;
    upsertMeta("description", description);
    upsertMeta("og:title", title, "property");
    upsertMeta("og:description", description, "property");
    upsertMeta("og:url", url, "property");
    upsertMeta("twitter:title", title);
    upsertMeta("twitter:description", description);
    upsertLink("canonical", url);
  }

  function render(page, cards, extensions) {
    var siteUrl = (window.CARDORIA_SEO && CARDORIA_SEO.siteUrl) || "https://cardoria.vercel.app";
    var pageUrl = siteUrl + "/pages/licences/" + slug + "/";
    updateSocialMeta(page.title, page.metaDescription, pageUrl, siteUrl + (window.CARDORIA_SEO.defaultImage || "/assets/logo/cardoria-premium.png"));
    window.CARDORIA_SEO_PAGE.title = page.title;
    window.CARDORIA_SEO_PAGE.description = page.metaDescription;
    window.CARDORIA_SEO_PAGE.path = "/pages/licences/" + slug + "/";

    var extHtml = (extensions || []).slice(0, 12).map(function (e) {
      return '<a href="' + base + 'pages/extension/?license=' + encodeURIComponent(slug) + "&ext=" + encodeURIComponent(e.slug) + '">' + e.extension + " (" + e.cardCount + ")</a>";
    }).join("");

    var cardsHtml = (cards || []).slice(0, 8).map(function (c) {
      var alt = c.name + " — " + c.extension + " " + c.number;
      var img = c.imageThumb
        ? '<img src="' + c.imageThumb + '" alt="' + alt + '" loading="lazy" width="200" height="140">'
        : '<span aria-hidden="true">🃏</span>';
      return '<a class="seo-card" href="' + base + 'carte.html?license=' + encodeURIComponent(c.license || slug) + "&slug=" + encodeURIComponent(c.slug) + '">' + img + "<h3>" + c.name + "</h3><p>" + c.extension + "</p></a>";
    }).join("");

    root.innerHTML =
      '<nav class="engine-breadcrumb" aria-label="Fil d\'Ariane"><a href="' + base + 'index.html">Accueil</a> › <a href="' + base + 'pages/licences/">Licences</a> › ' + licCfg.name + "</nav>" +
      "<h1>" + (page.h1 || page.title) + "</h1>" +
      '<p class="seo-lead">' + (page.content && page.content.intro || "") + "</p>" +
      '<div class="seo-links">' +
      '<a href="' + base + 'pages/estimation/">Estimer une carte ' + licCfg.name + "</a>" +
      '<a href="' + base + 'rachat-cartes.html">Vendre à Cardoria</a>' +
      '<a href="' + base + 'licence.html?slug=' + slug + '">Catalogue complet</a>' +
      '<a href="' + base + 'marketplace.html">Marketplace</a></div>' +
      '<section class="seo-section"><h2>Extensions ' + licCfg.name + " populaires</h2><div class=\"seo-links\">" + (extHtml || "<span>Catalogue en cours de référencement</span>") + "</div></section>" +
      '<section class="seo-section"><h2>Cartes ' + licCfg.name + " référencées</h2><div class=\"seo-grid\">" + cardsHtml + "</div></section>" +
      '<section class="seo-section"><h2>Pourquoi Cardoria pour vos cartes ' + licCfg.name + " ?</h2>" +
      "<p>Estimation IA premium, historique des prix sur 7 à 365 jours, marketplace avec paiement SumUp et équipe d'experts TCG basée en France.</p></section>";

    injectJsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: siteUrl + "/index.html" },
        { "@type": "ListItem", position: 2, name: "Licences", item: siteUrl + "/pages/licences/" },
        { "@type": "ListItem", position: 3, name: licCfg.name, item: pageUrl }
      ]
    });
    injectJsonLd({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: page.h1 || page.title,
      description: page.metaDescription,
      url: pageUrl,
      isPartOf: { "@type": "WebSite", name: "Cardoria", url: siteUrl }
    });
  }

  Promise.all([
    fetch(BACKEND + "/api/seo/licences/" + encodeURIComponent(slug)).then(function (r) { return r.json(); }),
    fetch(BACKEND + "/api/engine/cards?license=" + encodeURIComponent(slug) + "&limit=8").then(function (r) { return r.json(); }),
    fetch(BACKEND + "/api/seo/extensions?license=" + encodeURIComponent(slug)).then(function (r) { return r.json(); })
  ]).then(function (results) {
    var pageData = results[0].page || { title: licCfg.name + " | Cardoria", h1: "Cartes " + licCfg.name, metaDescription: "", content: {} };
    render(pageData, results[1].cards || [], results[2].extensions || []);
  }).catch(function () {
    render({ title: licCfg.name + " TCG | Cardoria", h1: "Cartes " + licCfg.name, metaDescription: "Catalogue " + licCfg.name, content: { intro: "Page SEO " + licCfg.name + " Cardoria." } }, [], []);
  });
})();
