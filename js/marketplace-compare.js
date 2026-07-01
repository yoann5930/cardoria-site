(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var params = new URLSearchParams(location.search);
  var root = document.getElementById("comparePage");

  M.api("/compare?" + params.toString()).then(function (d) {
    if (!d.ok) { root.innerHTML = "<div class='panel'>Comparaison impossible</div>"; return; }
    document.title = "Comparateur de prix — Cardoria";
    var rows = (d.comparison || []).map(function (c, i) {
      var cls = i === 0 ? "mk-compare-best" : "";
      return "<tr><td class='" + cls + "'>" + c.source + "</td><td class='" + cls + "'>" + M.euro(c.price) + "</td><td>" + c.type + "</td></tr>";
    }).join("");

    root.innerHTML =
      "<h1>Comparateur de prix Cardoria</h1>" +
      "<p style='color:#baaf97'>" + (d.summary?.recommendation || "") + "</p>" +
      '<div class="mk-stats">' +
      '<div class="mk-stat"><strong>' + M.euro(d.summary?.lowest?.price) + '</strong><span>Meilleur prix</span></div>' +
      '<div class="mk-stat"><strong>' + M.euro(d.summary?.average) + '</strong><span>Moyenne</span></div>' +
      '<div class="mk-stat"><strong>' + M.euro(d.summary?.potentialSavings) + '</strong><span>Économie possible</span></div></div>' +
      "<table class='mk-compare-table'><thead><tr><th>Source</th><th>Prix</th><th>Type</th></tr></thead><tbody>" + rows + "</tbody></table>" +
      '<p style="margin-top:20px"><a class="mk-btn mk-btn-secondary" href="marketplace.html">Retour marketplace</a></p>';
  });
})();
