(function () {
  "use strict";

  var root = document.getElementById("licenceSeoRoot");
  if (!root) return;

  var slug = root.dataset.slug || new URLSearchParams(location.search).get("slug") || "pokemon";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://www.cardoriashop.fr";
  var licCfg = (window.CARDORIA_SEO && CARDORIA_SEO.licenses && CARDORIA_SEO.licenses[slug]) || { name: slug };

  window.CARDORIA_SEO_PAGE = {
    breadcrumbs: [
      { name: "Accueil", url: "/" },
      { name: "Licences", url: "/pages/licences/" },
      { name: licCfg.name, url: "/pages/licences/" + slug + "/" }
    ],
    type: "collection"
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

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
    upsertMeta("robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
    upsertMeta("og:type", "website", "property");
    upsertMeta("og:title", title, "property");
    upsertMeta("og:description", description, "property");
    upsertMeta("og:url", url, "property");
    upsertMeta("og:image", image, "property");
    upsertMeta("twitter:card", "summary_large_image");
    upsertMeta("twitter:title", title);
    upsertMeta("twitter:description", description);
    upsertLink("canonical", url);
  }

  function render(page, cards, extensions) {
    var siteUrl = (window.CARDORIA_SEO && CARDORIA_SEO.siteUrl) || "https://www.cardoriashop.fr";
    var pageUrl = siteUrl + "/pages/licences/" + slug + "/";
    var defaultImage = siteUrl + ((window.CARDORIA_SEO && CARDORIA_SEO.defaultImage) || "/assets/logo/cardoria-premium.png");
    updateSocialMeta(page.title, page.metaDescription, pageUrl, defaultImage);
    window.CARDORIA_SEO_PAGE.title = page.title;
    window.CARDORIA_SEO_PAGE.description = page.metaDescription;
    window.CARDORIA_SEO_PAGE.path = "/pages/licences/" + slug + "/";

    var extHtml = (extensions || []).slice(0, 30).map(function (e) {
      return '<a href="/extensions/' + encodeURIComponent(slug) + "/" + encodeURIComponent(e.slug) + '">' + escapeHtml(e.extension) + " (" + Number(e.cardCount || 0) + ")</a>";
    }).join("");

    var cardsHtml = (cards || []).slice(0, 12).map(function (c) {
      var alt = c.name + " — " + c.extension + " " + c.number;
      var img = c.imageThumb
        ? '<img src="' + escapeHtml(c.imageThumb) + '" alt="' + escapeHtml(alt) + '" loading="lazy" width="200" height="280">'
        : '<span aria-hidden="true">🃏</span>';
      return '<a class="seo-card" href="/cartes/' + encodeURIComponent(c.license || slug) + "/" + encodeURIComponent(c.slug) + '">' + img + "<h3>" + escapeHtml(c.name) + "</h3><p>" + escapeHtml(c.extension) + "</p></a>";
    }).join("");

    var pokemonGuides = slug === "pokemon"
      ? '<a href="/pages/prix-carte-pokemon/">Prix carte Pokémon</a><a href="/pages/combien-vaut-ma-carte-pokemon/">Combien vaut ma carte Pokémon ?</a>'
      : "";

    root.innerHTML =
      '<nav class="engine-breadcrumb" aria-label="Fil d\'Ariane"><a href="/">Accueil</a> › <a href="/pages/licences/">Licences</a> › ' + escapeHtml(licCfg.name) + "</nav>" +
      "<h1>" + escapeHtml(page.h1 || page.title) + "</h1>" +
      '<p class="seo-lead">' + escapeHtml(page.content && page.content.intro || "") + "</p>" +
      '<div class="seo-links">' + pokemonGuides +
      '<a href="/estimation.html">Estimer une carte ' + escapeHtml(licCfg.name) + "</a>" +
      '<a href="/rachat-cartes.html">Vendre à Cardoria</a>' +
      '<a href="/licence.html?slug=' + encodeURIComponent(slug) + '">Recherche avancée</a>' +
      '<a href="/marketplace.html">Marketplace</a></div>' +
      '<section class="seo-section"><h2>Extensions ' + escapeHtml(licCfg.name) + "</h2><p>Parcourez les extensions référencées pour accéder directement aux listes de cartes, numéros et raretés.</p><div class=\"seo-links\">" + (extHtml || "<span>Catalogue en cours de référencement</span>") + "</div></section>" +
      '<section class="seo-section"><h2>Cartes ' + escapeHtml(licCfg.name) + " référencées</h2><div class=\"seo-grid\">" + cardsHtml + "</div></section>" +
      '<section class="seo-section"><h2>Prix, cote et estimation des cartes ' + escapeHtml(licCfg.name) + "</h2>" +
      "<p>Les fiches Cardoria regroupent les informations disponibles pour identifier une carte, son extension, son numéro, sa rareté et ses données de prix. Utilisez ensuite l'espace estimation pour analyser une carte que vous possédez.</p></section>";

    injectJsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: siteUrl + "/" },
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
      inLanguage: "fr-FR",
      isPartOf: { "@type": "WebSite", name: "Cardoria", url: siteUrl }
    });
  }

  Promise.all([
    fetch(BACKEND + "/api/seo/licences/" + encodeURIComponent(slug)).then(function (r) { return r.json(); }),
    fetch(BACKEND + "/api/engine/cards?license=" + encodeURIComponent(slug) + "&limit=12&sort=views").then(function (r) { return r.json(); }),
    fetch(BACKEND + "/api/seo/extensions?license=" + encodeURIComponent(slug)).then(function (r) { return r.json(); })
  ]).then(function (results) {
    var pageData = results[0].page || { title: licCfg.name + " | Cardoria", h1: "Cartes " + licCfg.name, metaDescription: "", content: {} };
    render(pageData, results[1].cards || [], results[2].extensions || []);
  }).catch(function () {
    render({ title: licCfg.name + " TCG | Cardoria", h1: "Cartes " + licCfg.name, metaDescription: "Catalogue " + licCfg.name, content: { intro: "Explorez le catalogue " + licCfg.name + " sur Cardoria." } }, [], []);
  });
})();
