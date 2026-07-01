/**
 * Affichage client IA Premium — Intelligence Cardoria (champs limités).
 */
(function (global) {
  "use strict";

  var BACKEND = (global.CARDORIA_SEO && global.CARDORIA_SEO.backendUrl) || global.CARDORIA_BACKEND || "https://cardoria-backend.onrender.com";

  function euro(n) {
    if (n == null || n === "") return "—";
    return Number(n || 0).toFixed(2).replace(".", ",") + " €";
  }

  function recClass(code) {
    if (code === "ACHETER") return "buy";
    if (code === "VENDRE") return "sell";
    if (code === "ATTENDRE") return "wait";
    return "hold";
  }

  function renderEnterprisePanel(ent) {
    if (!ent || !ent.estimation) return "";
    var est = ent.estimation;
    var mi = ent.marketIndex || {};
    var ev = ent.evolution || {};
    var fc = ent.forecast || {};

    var trendIcon = ev.direction === "up" ? "↗" : ev.direction === "down" ? "↘" : "→";
    var forecastHtml = (fc.horizons || []).map(function (h) {
      return "<div class='ai-forecast-row'><span>" + h.label + "</span><strong>" + euro(h.price) + "</strong>" +
        "<em>" + h.confidencePercent + "% conf.</em></div>";
    }).join("");

    return (
      "<div class='ai-enterprise'>" +
      "<h3 style='color:#ffe18a;margin:18px 0 10px'>Indice du marché Cardoria</h3>" +
      "<div class='ai-prices ai-prices--premium'>" +
      "<div class='ai-price-box rec'><label>Prix conseillé</label><strong>" + euro(est.recommendedPrice) + "</strong></div>" +
      "<div class='ai-price-box'><label>Indice marché</label><strong>" + (mi.score != null ? mi.score + "/100" : "—") + "</strong>" +
        (mi.label ? "<small>" + mi.label + "</small>" : "") + "</div>" +
      "<div class='ai-price-box'><label>Évolution</label><strong>" + trendIcon + " " + (mi.trendPercent != null ? mi.trendPercent + "%" : "—") + "</strong></div>" +
      "</div>" +
      (ev.values && ev.values.length
        ? "<div class='ai-evolution-chart'><canvas class='ai-chart ai-chart--enterprise' width='640' height='140'></canvas></div>"
        : "") +
      (forecastHtml
        ? "<h4 style='color:#ffe18a;margin:16px 0 8px;font-size:15px'>Prévisions</h4><div class='ai-forecast-list'>" + forecastHtml + "</div>"
        : "") +
      "</div>"
    );
  }

  function drawEnterpriseChart(root, ent) {
    if (!root || !ent || !ent.evolution || !ent.evolution.values || !ent.evolution.values.length) return;
    var canvas = root.querySelector(".ai-chart--enterprise");
    if (!canvas) return;
    var ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height, pad = 36;
    var vals = ent.evolution.values;
    var max = Math.max.apply(null, vals.concat([1]));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(212,175,55,.25)";
    ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
    ctx.strokeStyle = "#d4af37"; ctx.lineWidth = 2; ctx.beginPath();
    vals.forEach(function (v, i) {
      var x = pad + i * ((w - 2 * pad) / Math.max(vals.length - 1, 1));
      var y = h - pad - (v / max) * (h - 2 * pad);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  function renderIntelligencePanel(intel, estimate) {
    var data = intel || estimate || {};
    if (!data.recommendedPrice && !data.cardoriaScore) return "";

    var rec = data.recommendation || {};
    return (
      "<div class='ai-intelligence'>" +
      "<h3 style='color:#ffe18a;margin:16px 0 10px'>Intelligence Cardoria</h3>" +
      "<div class='ai-prices ai-prices--premium'>" +
      "<div class='ai-price-box rec'><label>Prix conseillé</label><strong>" + euro(data.recommendedPrice) + "</strong></div>" +
      "<div class='ai-price-box'><label>Vente conseillée</label><strong>" + euro(data.salePrice) + "</strong></div>" +
      "<div class='ai-price-box'><label>Rachat Cardoria</label><strong>" + (data.buybackPrice != null ? euro(data.buybackPrice) : "Sur examen") + "</strong></div>" +
      (data.cardoriaScore != null
        ? "<div class='ai-score-ring'><label>Score Cardoria</label><strong>" + data.cardoriaScore + "<span>/100</span></strong></div>"
        : "") +
      "</div>" +
      (rec.label
        ? "<div class='ai-rec ai-rec--" + recClass(rec.code) + "'><span class='ai-rec-label'>" + rec.label + "</span>" +
          (rec.hint ? "<p>" + rec.hint + "</p>" : "") + "</div>"
        : "") +
      (data.requiresExpertReview ? "<p style='color:#baaf97;font-size:14px;margin-top:10px'>Examen expert requis avant offre de rachat.</p>" : "") +
      "</div>"
    );
  }

  function renderAiResult(container, data) {
    if (!container || !data) return;
    var det = data.detection || {};
    var intel = data.intelligence || data.estimate || {};

    var detectionHtml = [
      ["Licence", det.license],
      ["Carte", det.name],
      ["Extension", det.extension],
      ["Numéro", det.number],
      ["Rareté", det.rarity],
      ["Langue", det.language],
      ["Version", det.version],
      ["État", data.condition]
    ].filter(function (x) { return x[1]; }).map(function (x) {
      return "<div><label>" + x[0] + "</label><strong>" + x[1] + "</strong></div>";
    }).join("");

    container.innerHTML =
      '<div class="ai-result">' +
      (detectionHtml ? "<h3 style='color:#ffe18a;margin:16px 0 8px'>Reconnaissance automatique</h3><div class='ai-detection'>" + detectionHtml + "</div>" : "") +
      renderIntelligencePanel(intel) +
      renderEnterprisePanel(data.enterprise) +
      "<h3 style='color:#ffe18a;margin:20px 0 8px'>Analyse Cardoria</h3>" +
      "<div class='ai-message'>" + (data.clientResult || "") + "</div>" +
      (data.cardId ? "<p style='margin-top:14px'><a href='carte.html?id=" + encodeURIComponent(data.cardId) + "' style='color:#ffe18a'>Voir la fiche catalogue →</a></p>" : "") +
      "</div>";

    drawEnterpriseChart(container.querySelector(".ai-result"), data.enterprise);

    if (data.cardId) {
      fetchHistory(data.cardId, "30", function (h) {
        if (h && h.points && h.points.length) {
          drawHistoryChart(container.querySelector(".ai-result"), data.cardId, h.points, "30");
        }
      });
    }
  }

  function drawHistoryChart(root, cardId, points, period) {
    if (!root || !points.length) return;
    var wrap = document.createElement("div");
    wrap.className = "ai-history-wrap";
    wrap.innerHTML =
      "<h3 style='color:#ffe18a;margin:20px 0 8px'>Historique des prix</h3>" +
      '<div class="admin-periods ai-periods">' +
      '<button type="button" data-p="7">7 j</button>' +
      '<button type="button" data-p="30" class="active">30 j</button>' +
      '<button type="button" data-p="90">90 j</button>' +
      '<button type="button" data-p="365">1 an</button></div>' +
      '<canvas class="ai-chart" width="700" height="180"></canvas>';
    root.appendChild(wrap);

    function renderChart(pts, p) {
      var c = wrap.querySelector("canvas");
      if (!c || !pts.length) return;
      var ctx = c.getContext("2d"), w = c.width, h = c.height, pad = 40;
      var vals = pts.map(function (x) { return x.recommended || x.avg; });
      var max = Math.max.apply(null, vals.concat([1]));
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(212,175,55,.2)";
      ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
      ctx.strokeStyle = "#ffe18a"; ctx.lineWidth = 2; ctx.beginPath();
      vals.forEach(function (v, i) {
        var x = pad + i * ((w - 2 * pad) / Math.max(vals.length - 1, 1));
        var y = h - pad - (v / max) * (h - 2 * pad);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      wrap.querySelectorAll(".ai-periods button").forEach(function (btn) {
        btn.classList.toggle("active", btn.dataset.p === String(p));
      });
    }

    renderChart(points, period);
    if (cardId) {
      wrap.querySelectorAll(".ai-periods button").forEach(function (btn) {
        btn.onclick = function () {
          fetchHistory(cardId, btn.dataset.p, function (h) {
            if (h && h.points) renderChart(h.points, btn.dataset.p);
          });
        };
      });
    }
  }

  function fetchHistory(cardId, period, callback) {
    fetch(BACKEND + "/api/ai/history/" + encodeURIComponent(cardId) + "?period=" + (period || "30"))
      .then(function (r) { return r.json(); })
      .then(function (d) { if (callback) callback(d.history); });
  }

  global.CardoriaAI = {
    renderAiResult: renderAiResult,
    renderIntelligencePanel: renderIntelligencePanel,
    renderEnterprisePanel: renderEnterprisePanel,
    fetchHistory: fetchHistory,
    euro: euro,
    BACKEND: BACKEND
  };
})(window);
