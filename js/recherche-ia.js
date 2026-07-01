(function () {
  "use strict";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";

  function euro(n) {
    if (n == null) return "—";
    return Number(n).toFixed(2).replace(".", ",") + " €";
  }

  function renderUnderstood(u) {
    if (!u) return "";
    var parts = [];
    if (u.license) parts.push("Licence : <strong>" + u.license + "</strong>");
    if (u.rarity) parts.push("Rareté : <strong>" + u.rarity + "</strong>");
    if (u.grade) parts.push("Grade : <strong>" + u.grade + "</strong>");
    if (u.terms && u.terms.length) parts.push("Termes : <strong>" + u.terms.join(", ") + "</strong>");
    return parts.length ? "<p>Compris par l'IA : " + parts.join(" · ") + "</p>" : "";
  }

  function renderCards(cards) {
    if (!cards || !cards.length) return "<p>Aucun résultat.</p>";
    return cards.map(function (c) {
      return "<a class='ultimate-card' href='fiche-ultimate.html?id=" + encodeURIComponent(c.id) + "'>" +
        "<strong>" + c.name + "</strong>" +
        "<span>" + (c.licenseName || c.license) + " · " + (c.extension || "") + "</span>" +
        "<em>" + euro(c.recommendedPrice || c.avgPrice) + "</em>" +
        (c.gradeHint ? "<small>" + c.gradeHint + "</small>" : "") +
        "</a>";
    }).join("");
  }

  document.getElementById("searchForm").onsubmit = function (e) {
    e.preventDefault();
    var q = document.getElementById("searchInput").value.trim();
    if (q.length < 2) return;
    document.getElementById("results").innerHTML = "Recherche…";
    fetch(BACKEND + "/api/ultimate/search?q=" + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        document.getElementById("understood").innerHTML = renderUnderstood(d.understood);
        document.getElementById("results").innerHTML = renderCards(d.cards);
      })
      .catch(function () {
        document.getElementById("results").innerHTML = "<p>Erreur de recherche.</p>";
      });
  };
})();
