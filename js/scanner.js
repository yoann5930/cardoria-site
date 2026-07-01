/**
 * Scanner Intelligent Cardoria — client mobile.
 */
(function () {
  "use strict";

  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-backend.onrender.com";
  var MAX_DIM = 1280;
  var JPEG_QUALITY = 0.82;

  var state = {
    images: [],
    recto: null,
    verso: null,
    activeIndex: 0
  };

  function qs(id) { return document.getElementById(id); }

  function euro(n) {
    if (n == null || n === "") return "—";
    return Number(n).toFixed(2).replace(".", ",") + " €";
  }

  function optimizeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width;
          var h = img.height;
          var scale = Math.min(1, MAX_DIM / Math.max(w, h));
          var cw = Math.round(w * scale);
          var ch = Math.round(h * scale);
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function addImage(dataUrl, label) {
    state.images.push({ dataUrl: dataUrl, label: label || "photo" });
    state.activeIndex = state.images.length - 1;
    renderThumbs();
    showPreview(dataUrl);
  }

  function showPreview(dataUrl) {
    qs("scanPreviewImg").src = dataUrl;
    qs("scanPreviewImg").style.display = "block";
    qs("scanPlaceholder").style.display = "none";
  }

  function renderThumbs() {
    var box = qs("scanThumbs");
    box.innerHTML = state.images.map(function (img, i) {
      return '<button type="button" class="scanner-thumb' + (i === state.activeIndex ? " active" : "") + '" data-i="' + i + '">' +
        '<img src="' + img.dataUrl + '" alt="' + img.label + '"></button>';
    }).join("");
    box.querySelectorAll(".scanner-thumb").forEach(function (btn) {
      btn.onclick = function () {
        state.activeIndex = Number(btn.dataset.i);
        renderThumbs();
        showPreview(state.images[state.activeIndex].dataUrl);
      };
    });
  }

  function bindFileInput(inputId, handler) {
    qs(inputId).onchange = function (e) {
      var files = Array.from(e.target.files || []);
      if (!files.length) return;
      Promise.all(files.map(function (f) { return optimizeImage(f); }))
        .then(function (urls) {
          urls.forEach(function (url, i) { handler(url, files.length > 1 ? i : 0); });
        })
        .catch(function () { alert("Impossible de lire l'image."); });
      e.target.value = "";
    };
  }

  bindFileInput("fileCapture", function (url) { addImage(url, "capture"); });
  bindFileInput("fileImport", function (url) { addImage(url, "import"); });
  bindFileInput("fileRecto", function (url) {
    state.recto = url;
    addImage(url, "recto");
  });
  bindFileInput("fileVerso", function (url) {
    state.verso = url;
    addImage(url, "verso");
  });

  qs("btnCapture").onclick = function () { qs("fileCapture").click(); };
  qs("btnImport").onclick = function () { qs("fileImport").click(); };
  qs("btnRecto").onclick = function () { qs("fileRecto").click(); };
  qs("btnVerso").onclick = function () { qs("fileVerso").click(); };

  function renderResult(data) {
    var c = data.client || {};
    var rec = c.recognized || {};
    var html = "";

    if (data.fallback || c.fallback) {
      html += '<div class="scanner-fallback">Mode secours — reconnaissance partielle. Une validation manuelle peut être nécessaire.</div>';
    }

    html += '<div class="scanner-result">';
    html += '<h3>Carte reconnue</h3>';
    html += '<p class="scanner-card-name">' + (rec.name || "Carte TCG") + '</p>';
    html += '<div class="scanner-meta">';
    if (rec.license) html += "Licence : <strong>" + rec.license + "</strong><br>";
    if (rec.extension) html += "Extension : " + rec.extension + "<br>";
    if (rec.number) html += "N° : " + rec.number + "<br>";
    if (rec.rarity) html += "Rareté : " + rec.rarity + "<br>";
    if (c.condition) html += "État estimé : <strong>" + c.condition + "</strong><br>";
    if (c.multiCardHint) html += "<em>" + c.multiCardHint + "</em><br>";
    html += "</div>";

    if (c.visibleDefects && c.visibleDefects.length) {
      html += '<ul class="scanner-defects"><li>' + c.visibleDefects.join("</li><li>") + "</li></ul>";
    }

    if (c.generalEstimate != null) {
      html += '<div class="scanner-price"><label>Estimation générale</label><strong>' + euro(c.generalEstimate) + "</strong></div>";
    }
    if (c.recommendedPrice != null && c.recommendedPrice !== c.generalEstimate) {
      html += '<div class="scanner-price" style="margin-top:8px"><label>Prix conseillé</label><strong>' + euro(c.recommendedPrice) + "</strong></div>";
    }

    var ent = data.enterprise || c.enterprise;
    if (ent && ent.marketIndex) {
      html += '<div class="scanner-enterprise" style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(212,175,55,.2)">';
      html += '<h4 style="color:#ffe18a;margin:0 0 8px;font-size:14px">Indice marché</h4>';
      html += '<p>Score : <strong>' + (ent.marketIndex.score != null ? ent.marketIndex.score + "/100" : "—") + "</strong>";
      if (ent.marketIndex.label) html += " · " + ent.marketIndex.label;
      html += "</p>";
      if (ent.forecast && ent.forecast.horizons && ent.forecast.horizons.length) {
        html += '<p style="font-size:12px;color:#baaf97;margin-top:6px">Prévision 30 j : <strong style="color:#ffe18a">' +
          euro(ent.forecast.horizons[1] ? ent.forecast.horizons[1].price : ent.forecast.horizons[0].price) + "</strong></p>";
      }
      html += "</div>";
    }

    html += '<div class="scanner-cta">';
    if (c.canOfferBuyback) {
      html += '<button type="button" class="scan-btn scan-btn-primary" id="btnBuyback">Demander une offre de rachat</button>';
    } else {
      html += '<p style="font-size:13px;color:#baaf97">Examen expert requis avant toute offre de rachat automatique.</p>';
    }
    html += '<button type="button" class="scan-btn scan-btn-secondary" id="btnCollection">Ajouter à ma collection</button>';
    if (c.catalogUrl) {
      html += '<a class="scan-btn" href="' + c.catalogUrl + '" style="text-decoration:none;text-align:center">Voir fiche catalogue</a>';
    }
    if (c.pendingCatalog) {
      html += '<p style="font-size:12px;color:#baaf97;margin-top:8px">Fiche catalogue en cours de validation par Cardoria.</p>';
    }
    html += "</div></div>";

    qs("scanResult").innerHTML = html;

    var buybackBtn = qs("btnBuyback");
    if (buybackBtn) {
      buybackBtn.onclick = function () {
        var email = qs("scanEmail").value.trim();
        if (!email) { alert("Indiquez votre email pour recevoir une offre."); qs("scanEmail").focus(); return; }
        var params = new URLSearchParams({
          card: c.cardId || "",
          email: email,
          scan: data.scanId || ""
        });
        location.href = "rachat-cartes.html?" + params.toString();
      };
    }

    qs("btnCollection").onclick = function () {
      var col = [];
      try { col = JSON.parse(localStorage.getItem("cardoria_collection") || "[]"); } catch (e) { col = []; }
      col.unshift({
        at: new Date().toISOString(),
        name: rec.name,
        license: rec.license,
        extension: rec.extension,
        number: rec.number,
        condition: c.condition,
        estimate: c.recommendedPrice,
        scanId: data.scanId,
        cardId: c.cardId
      });
      localStorage.setItem("cardoria_collection", JSON.stringify(col.slice(0, 200)));
      alert("Carte ajoutée à votre collection locale Cardoria.");
    };
  }

  qs("btnAnalyze").onclick = function () {
    if (!state.images.length && !state.recto) {
      alert("Ajoutez au moins une photo.");
      return;
    }

    qs("scanResult").innerHTML = '<div class="scanner-loading"><div class="pulse"></div>Analyse Cardoria en cours…</div>';

    var payload = {
      customerName: qs("scanName").value.trim(),
      customerEmail: qs("scanEmail").value.trim(),
      rectoBase64: state.recto || state.images[0]?.dataUrl,
      versoBase64: state.verso || null,
      imagesBase64: state.images.map(function (i) { return i.dataUrl; }),
      deviceInfo: navigator.userAgent.slice(0, 180)
    };

    if (window.CardoriaAttribution) {
      var attr = CardoriaAttribution.getPayload();
      Object.assign(payload, attr);
    }

    var t0 = Date.now();
    fetch(BACKEND + "/api/scanner/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) {
          qs("scanResult").innerHTML = '<div class="scanner-result"><p style="color:#ff8a8a">Erreur : ' + (d.error || "Analyse impossible") + "</p></div>";
          return;
        }
        d._clientMs = Date.now() - t0;
        renderResult(d);
      })
      .catch(function (e) {
        qs("scanResult").innerHTML = '<div class="scanner-result"><p style="color:#ff8a8a">Connexion impossible : ' + e.message + "</p></div>";
      });
  };
})();
