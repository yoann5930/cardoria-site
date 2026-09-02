(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var route = window.CARDORIA_EXTENSION_ROUTE || {};
  var license = route.license || params.get("license") || "pokemon";
  var extSlug = route.ext || params.get("ext") || "";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-site-f2cy.onrender.com";
  var root = document.getElementById("extensionRoot");
  var E = window.CardoriaEngine;

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

  fetch(BACKEND + "/api/seo/extensions?license=" + encodeURIComponent(license))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var ext = (d.extensions || []).find(function (x) { return x.slug === extSlug; });
      if (!ext) throw new Error("extension_not_found");
      var name = ext.extension;
      var licName = (window.CARDORIA_SEO.licenses[license] || {}).name || license;
      var siteUrl = (window.CARDORIA_SEO && CARDORIA_SEO.siteUrl) || "https://cardoria-site-f2cy.onrender.com";
      var canonical = siteUrl + "/extensions/" + encodeURIComponent(license) + "/" + encodeURIComponent(extSlug);
      var title = name + " — cartes, prix & liste " + licName + " | Cardoria";
      var description = "Découvrez les cartes " + name + " (" + licName + ") : liste, numéros, raretés et données de prix. " + Number(ext.cardCount || 0) + " cartes référencées sur Cardoria.";

      window.CARDORIA_SEO_PAGE = {
        title: title,
        description: description,
        path: "/extensions/" + license + "/" + extSlug,
        type: "collection",
        breadcrumbs: [
          { name: "Accueil", url: "/" },
          { name: "Licences", url: "/pages/licences/" },
          { name: licName, url: "/pages/licences/" + license + "/" },
          { name: name, url: "/extensions/" + license + "/" + extSlug }
        ]
      };
      document.title = title;
      upsertMeta("description", description);
      upsertMeta("robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
      upsertMeta("og:title", title, "property");
      upsertMeta("og:description", description, "property");
      upsertMeta("og:url", canonical, "property");
      upsertMeta("twitter:title", title);
      upsertMeta("twitter:description", description);
      upsertLink("canonical", canonical);

      return E.searchCards({ license: license, extension: name, limit: 36, sort: "extension" }).then(function (cards) {
        var grid = (cards.cards || []).map(function (c) {
          var alt = c.name + " " + c.extension + " " + c.number;
          return '<a class="seo-card" href="/cartes/' + encodeURIComponent(c.license || license) + "/" + encodeURIComponent(c.slug) + '">' +
            (c.imageThumb ? '<img src="' + escapeHtml(c.imageThumb) + '" alt="' + escapeHtml(alt) + '" loading="lazy" width="200" height="280">' : "🃏") +
            "<h3>" + escapeHtml(c.name) + "</h3><p>" + escapeHtml(c.number) + "</p></a>";
        }).join("");

        root.innerHTML =
          '<nav class="engine-breadcrumb"><a href="/">Accueil</a> › <a href="/pages/licences/' + encodeURIComponent(license) + '/">' + escapeHtml(licName) + '</a> › ' + escapeHtml(name) + "</nav>" +
          "<h1>Cartes " + escapeHtml(name) + " — " + escapeHtml(licName) + "</h1>" +
          '<p class="seo-lead">Liste des cartes de l\'extension ' + escapeHtml(name) + " : numéros, raretés, visuels et données de prix disponibles sur Cardoria. " + Number(ext.cardCount || 0) + " cartes sont actuellement référencées.</p>" +
          '<div class="seo-links"><a href="/pages/licences/' + encodeURIComponent(license) + '/">Toutes les extensions ' + escapeHtml(licName) + '</a><a href="/pages/estimation/">Estimer une carte</a><a href="/marketplace.html">Marketplace</a></div>' +
          '<section class="seo-section"><h2>Liste des cartes ' + escapeHtml(name) + '</h2><div class="seo-grid">' + (grid || "<p>Aucune carte indexée.</p>") + "</div></section>" +
          '<section class="seo-section"><h2>Prix et cote de l\'extension ' + escapeHtml(name) + "</h2><p>Ouvrez une fiche carte pour consulter les informations disponibles sur son numéro, sa rareté, son image et ses données de prix. Les valeurs peuvent évoluer avec le marché et l'état réel de la carte.</p></section>";
      });
    })
    .catch(function () {
      if (root && !root.querySelector("h1")) root.innerHTML = '<h1>Extension introuvable</h1><p><a href="/pages/licences/">Retour aux catalogues</a></p>';
    });
})();
