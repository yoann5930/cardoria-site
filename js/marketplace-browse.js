(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var state = { page: 1, q: "", license: "", sort: "recent", negotiable: false };

  function renderCards(data) {
    var grid = document.getElementById("mkGrid");
    var pages = document.getElementById("mkPages");
    var ms = document.getElementById("mkMs");
    if (!grid) return;

    grid.innerHTML = (data.listings || []).map(function (l) {
      var img = l.photos && l.photos[0]
        ? '<img src="' + l.photos[0] + '" alt="' + l.title + '" loading="lazy" width="240" height="200">'
        : '<span style="font-size:64px">🃏</span>';
      var neg = l.negotiable ? '<span class="mk-badge mk-badge-neg">Négociable</span>' : "";
      return '<a class="mk-card" href="' + M.listingUrl(l.id) + '"><div class="mk-card-img">' + img + '</div><div class="mk-card-body">' +
        "<h3>" + l.title + "</h3>" +
        '<p class="mk-card-meta">' + l.condition + " • " + (l.license || "TCG") + " • Stock : " + l.stock + "</p>" +
        '<div class="mk-card-price">' + M.euro(l.price) + "</div>" + neg +
        '<div class="mk-seller-row">' + M.sellerBadge(l.seller) + (l.seller ? l.seller.displayName : "") + "</div></div></a>";
    }).join("") || "<div class='panel'>Aucune annonce trouvée.</div>";

    if (ms) ms.textContent = data.ms ? data.ms + " ms" : "";
    if (pages) {
      pages.innerHTML = "";
      var p = data.pagination || { page: 1, pages: 1 };
      for (var i = 1; i <= Math.min(p.pages, 15); i++) {
        var btn = document.createElement("button");
        btn.textContent = i;
        if (i === p.page) btn.className = "active";
        btn.onclick = (function (n) { return function () { state.page = n; load(); }; })(i);
        pages.appendChild(btn);
      }
    }
  }

  function load() {
    var params = new URLSearchParams({
      q: state.q, license: state.license, sort: state.sort, page: state.page, limit: 24
    });
    if (state.negotiable) params.set("negotiable", "1");
    fetch(M.BACKEND + "/api/marketplace/search?" + params).then(function (r) { return r.json(); }).then(renderCards);
  }

  function init() {
    var search = document.getElementById("mkSearch");
    var license = document.getElementById("mkLicense");
    var sort = document.getElementById("mkSort");
    var neg = document.getElementById("mkNeg");

    if (search) {
      search.addEventListener("input", function () {
        state.q = search.value;
        state.page = 1;
        clearTimeout(window._mkTimer);
        window._mkTimer = setTimeout(load, 250);
      });
    }
    if (license) license.onchange = function () { state.license = license.value; state.page = 1; load(); };
    if (sort) sort.onchange = function () { state.sort = sort.value; load(); };
    if (neg) neg.onclick = function () { state.negotiable = !state.negotiable; neg.classList.toggle("active", state.negotiable); load(); };

    M.api("/shipping/options").then(function (d) {
      window._shippingOptions = d.options || [];
    });
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
