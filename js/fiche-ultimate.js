(function () {
  "use strict";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-backend.onrender.com";
  var params = new URLSearchParams(location.search);
  var cardId = params.get("id");
  var root = document.getElementById("ultimatePage");
  var currentPeriod = "30";

  function euro(n) {
    if (n == null) return "—";
    return Number(n).toFixed(2).replace(".", ",") + " €";
  }

  function periodButtons() {
    var keys = [
      { k: "7", l: "7 j" }, { k: "30", l: "30 j" }, { k: "90", l: "90 j" },
      { k: "180", l: "6 m" }, { k: "365", l: "1 an" }, { k: "1095", l: "3 ans" },
      { k: "1825", l: "5 ans" }, { k: "max", l: "Max" }
    ];
    return keys.map(function (p) {
      return "<button type='button' data-p='" + p.k + "' class='" + (p.k === currentPeriod ? "active" : "") + "'>" + p.l + "</button>";
    }).join("");
  }

  function renderPrices(pc) {
    if (!pc) return "";
    return "<div class='ultimate-prices'>" +
      ["cardmarket", "ebay", "pricecharting", "tcgplayer", "psa", "worldAverage"].map(function (k) {
        var label = { cardmarket: "Cardmarket", ebay: "Ebay", pricecharting: "PriceCharting", tcgplayer: "TCGPlayer", psa: "PSA", worldAverage: "Moyenne mondiale" }[k];
        var val = pc[k];
        return "<div><label>" + label + "</label><strong>" + (val != null ? euro(val) : "N/A") + "</strong></div>";
      }).join("") +
      "</div>";
  }

  function renderAdvice(inv) {
    if (!inv) return "";
    var tags = (inv.tags || []).map(function (t) { return "<span class='ult-tag'>" + t.label + "</span>"; }).join("");
    return "<div class='ultimate-advice'>" +
      "<div class='ult-action'><label>Conseil IA</label><strong>" + (inv.action && inv.action.label) + "</strong></div>" +
      "<div><label>Confiance</label><strong>" + inv.confidence + "/100</strong></div>" +
      (tags ? "<div class='ult-tags'>" + tags + "</div>" : "") +
      "</div>";
  }

  function drawChart(points) {
    var c = document.getElementById("ultChart");
    if (!c || !points || !points.length) return;
    var ctx = c.getContext("2d"), w = c.width, h = c.height, pad = 44;
    var vals = points.map(function (p) { return p.price; });
    var max = Math.max.apply(null, vals.concat([1]));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(212,175,55,.25)";
    ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
    ctx.strokeStyle = "#ffe18a"; ctx.lineWidth = 2; ctx.beginPath();
    vals.forEach(function (v, i) {
      var x = pad + i * ((w - 2 * pad) / Math.max(vals.length - 1, 1));
      var y = h - pad - (v / max) * (h - 2 * pad);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  function render(data) {
    var u = data.ultimate;
    if (!u) { root.innerHTML = "<p>Carte introuvable.</p>"; return; }
    var card = u.card;
    var alert = u.exceptionalAlert;
    document.title = card.name + " — Cardoria Ultimate";
    var classic = document.getElementById("classicLink");
    if (classic) classic.href = "carte.html?id=" + encodeURIComponent(card.id);

    root.innerHTML =
      "<h1>" + card.name + "</h1>" +
      "<p class='ultimate-meta'>" + card.license + " · " + (card.extension || "") + " · " + (card.rarity || "") + "</p>" +
      (alert ? "<div class='ultimate-alert ult-alert--" + alert.severity + "'><strong>" + alert.title + "</strong><p>" + alert.message + "</p></div>" : "") +
      "<section class='ultimate-section'><h2>Comparateur de prix</h2>" +
      (u.priceComparison && u.priceComparison.globalIndex
        ? "<p>Cardoria Global Index : <strong>" + u.priceComparison.globalIndex.score + "/100</strong> — " + (u.priceComparison.globalIndex.label || "") + "</p>"
        : "") +
      renderPrices(u.priceComparison) + "</section>" +
      "<section class='ultimate-section'><h2>Conseiller investissement</h2>" + renderAdvice(u.investment) + "</section>" +
      "<section class='ultimate-section'><h2>Historique des prix</h2>" +
      "<div class='ultimate-periods'>" + periodButtons() + "</div>" +
      "<canvas id='ultChart' width='720' height='220'></canvas></section>" +
      (u.forecast ? "<section class='ultimate-section'><h2>Prévisions</h2><div class='ultimate-forecast'>" +
        (u.forecast.horizons || []).map(function (f) {
          return "<div><span>" + f.label + "</span><strong>" + euro(f.price) + "</strong><em>" + f.confidence + "%</em></div>";
        }).join("") + "</div></section>" : "");

    var hist = u.history && u.history[currentPeriod];
    drawChart(hist && hist.points);

    root.querySelectorAll(".ultimate-periods button").forEach(function (btn) {
      btn.onclick = function () {
        currentPeriod = btn.dataset.p;
        var pts = u.history[currentPeriod] && u.history[currentPeriod].points;
        root.querySelectorAll(".ultimate-periods button").forEach(function (b) {
          b.classList.toggle("active", b.dataset.p === currentPeriod);
        });
        drawChart(pts);
      };
    });
  }

  if (!cardId) {
    root.innerHTML = "<p>Paramètre id manquant.</p>";
    return;
  }

  fetch(BACKEND + "/api/ultimate/card/" + encodeURIComponent(cardId))
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () { root.innerHTML = "<p>Erreur de chargement.</p>"; });
})();
