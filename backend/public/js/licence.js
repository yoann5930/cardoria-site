(function () {
  "use strict";

  var E = window.CardoriaEngine;
  var params = new URLSearchParams(location.search);
  var slug = params.get("slug") || "pokemon";
  var root = document.getElementById("licensePage");
  var state = { page: 1, q: "", sort: "name" };

  function renderLicenseHeader(license, licenses) {
    var grid = licenses.map(function (l) {
      return '<a class="engine-license-tile' + (l.slug === slug ? '" style="border-color:rgba(212,175,55,.55)"' : '"') + ' href="licence.html?slug=' + l.slug + '"><span class="icon">' + l.icon + '</span><strong>' + l.name + "</strong><span>" + l.cardCount + " cartes</span></a>";
    }).join("");

    return '<nav class="engine-breadcrumb"><a href="index.html">Accueil</a> › Catalogue</nav>' +
      "<h1>Catalogue " + (license?.name || slug) + "</h1>" +
      '<div class="engine-license-grid">' + grid + "</div>" +
      '<div class="engine-filters">' +
      '<input id="catalogSearch" placeholder="Rechercher une carte…" value="' + state.q + '">' +
      '<select id="catalogSort"><option value="name">Nom</option><option value="price">Prix ↓</option><option value="price_asc">Prix ↑</option><option value="trend">Tendance</option><option value="sales">Ventes</option></select>' +
      "</div>" +
      '<div id="catalogGrid" class="engine-catalog-grid"></div>' +
      '<div id="catalogPages" class="engine-pagination"></div>';
  }

  function renderCards(data) {
    var grid = document.getElementById("catalogGrid");
    var pages = document.getElementById("catalogPages");
    if (!grid) return;

    grid.innerHTML = (data.cards || []).map(function (c) {
      var img = c.imageThumb
        ? '<img src="' + c.imageThumb + '" alt="' + c.name + '" loading="lazy" width="220" height="160">'
        : '<span class="emoji">🃏</span>';
      return '<a class="engine-card-tile" href="' + E.cardUrl(c) + '">' + img +
        "<h3>" + c.name + "</h3><p>" + c.extension + " • " + c.number + "</p><p class='price'>" + E.euro(c.prices.recommended) + "</p></a>";
    }).join("") || "<div class='panel'>Aucune carte trouvée.</div>";

    var p = data.pagination || { page: 1, pages: 1 };
    pages.innerHTML = "";
    for (var i = 1; i <= Math.min(p.pages, 12); i++) {
      var btn = document.createElement("button");
      btn.textContent = i;
      if (i === p.page) btn.className = "active";
      btn.onclick = (function (n) { return function () { state.page = n; loadCards(); }; })(i);
      pages.appendChild(btn);
    }

    if (license) {
      document.title = "Catalogue " + license.name + " — Cardoria";
      setMeta("description", "Parcourez " + license.cardCount + " cartes " + license.name + " sur Cardoria.");
    }
  }

  function setMeta(name, content) {
    var el = document.querySelector('meta[name="' + name + '"]');
    if (el) el.setAttribute("content", content);
  }

  var license;

  function loadCards() {
    E.searchCards({ license: slug, q: state.q, page: state.page, limit: 24, sort: state.sort }).then(renderCards);
  }

  function init() {
    E.getLicenses().then(function (licenses) {
      license = licenses.find(function (l) { return l.slug === slug; }) || { name: slug, slug: slug, cardCount: 0 };
      root.innerHTML = renderLicenseHeader(license, licenses);
      document.getElementById("catalogSearch").oninput = function (e) {
        state.q = e.target.value;
        state.page = 1;
        clearTimeout(window._catTimer);
        window._catTimer = setTimeout(loadCards, 300);
      };
      document.getElementById("catalogSort").value = state.sort;
      document.getElementById("catalogSort").onchange = function (e) {
        state.sort = e.target.value;
        state.page = 1;
        loadCards();
      };
      loadCards();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
