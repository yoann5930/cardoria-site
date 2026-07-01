(function () {
  "use strict";
  var AI = window.CardoriaAI;
  var root = document.getElementById("trendsPage");

  function load(direction) {
    fetch(AI.BACKEND + "/api/ai/trends?limit=30&direction=" + (direction || ""))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var up = (d.trends || []).filter(function (t) { return t.direction === "up"; });
        var down = (d.trends || []).filter(function (t) { return t.direction === "down"; });
        var list = direction === "up" ? up : direction === "down" ? down : d.trends || [];

        root.innerHTML =
          "<h1>Tendances du marché TCG</h1>" +
          "<p style='color:#baaf97'>Cartes identifiées en hausse ou en baisse par l'IA Cardoria (30 derniers jours).</p>" +
          '<div class="admin-periods" style="margin:20px 0">' +
          '<button type="button" data-f="">Toutes</button>' +
          '<button type="button" data-f="up">En hausse</button>' +
          '<button type="button" data-f="down">En baisse</button></div>' +
          '<div class="ai-detection">' +
          list.map(function (t) {
            var cls = t.direction === "up" ? "up" : "down";
            var sign = t.changePercent > 0 ? "+" : "";
            return '<div><label>' + (t.license || "TCG") + '</label><strong><a href="carte.html?id=' +
              encodeURIComponent(t.cardId) + '" style="color:#ffe18a">' + (t.name || t.cardId) +
              '</a></strong><span class="ai-trend ' + cls + '" style="display:block;margin-top:6px">' +
              sign + t.changePercent + " %</span></div>";
          }).join("") +
          "</div>" +
          (list.length ? "" : "<div class='panel'>Aucune tendance significative pour le moment.</div>") +
          '<p style="margin-top:24px"><a href="estimation.html" style="color:#ffe18a">Faire estimer une carte →</a></p>';

        root.querySelectorAll("[data-f]").forEach(function (btn) {
          btn.onclick = function () { load(btn.dataset.f); };
        });
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { load(""); });
  else load("");
})();
