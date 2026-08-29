(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var license = params.get("license") || "pokemon";
  var extSlug = params.get("ext") || "";
  var base = "../../";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";
  var root = document.getElementById("extensionRoot");
  var E = window.CardoriaEngine;

  fetch(BACKEND + "/api/seo/extensions?license=" + encodeURIComponent(license))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var ext = (d.extensions || []).find(function (x) { return x.slug === extSlug || x.extension.toLowerCase().indexOf(extSlug) >= 0; });
      var name = ext ? ext.extension : extSlug.replace(/-/g, " ");
      var licName = (window.CARDORIA_SEO.licenses[license] || {}).name || license;

      window.CARDORIA_SEO_PAGE = {
        title: name + " — " + licName + " | Cardoria",
        description: "Cartes " + name + " (" + licName + ") : prix, rareté et fiches Cardoria.",
        path: "/pages/extension/?license=" + license + "&ext=" + extSlug,
        type: "collection",
        breadcrumbs: [
          { name: "Accueil", url: "/index.html" },
          { name: "Licences", url: "/pages/licences/" },
          { name: licName, url: "/pages/licences/" + license + "/" },
          { name: name, url: "/pages/extension/?license=" + license + "&ext=" + extSlug }
        ]
      };
      document.title = window.CARDORIA_SEO_PAGE.title;

      return E.searchCards({ license: license, q: name, limit: 24 }).then(function (cards) {
        var grid = (cards.cards || []).map(function (c) {
          var alt = c.name + " " + c.extension + " " + c.number;
          return '<a class="seo-card" href="' + base + 'carte.html?license=' + encodeURIComponent(c.license) + "&slug=" + encodeURIComponent(c.slug) + '">' +
            (c.imageThumb ? '<img src="' + c.imageThumb + '" alt="' + alt + '" loading="lazy" width="200" height="140">' : "🃏") +
            "<h3>" + c.name + "</h3><p>" + c.number + "</p></a>";
        }).join("");

        root.innerHTML =
          '<nav class="engine-breadcrumb"><a href="' + base + 'index.html">Accueil</a> › <a href="' + base + 'pages/licences/' + license + '/">' + licName + '</a> › ' + name + "</nav>" +
          "<h1>Extension " + name + "</h1>" +
          "<p class=\"seo-lead\">Catalogue Cardoria — cartes " + licName + " de l'extension " + name + ".</p>" +
          '<div class="seo-grid">' + (grid || "<p>Aucune carte indexée.</p>") + "</div>" +
          '<p class="seo-links"><a href="' + base + 'licence.html?slug=' + license + '">Voir tout le catalogue ' + licName + "</a></p>";
      });
    });
})();
