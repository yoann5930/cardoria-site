(function () {
  "use strict";

  var PHOTO_KEY = "cardoria_marketplace_estimation_photos";
  var DRAFT_KEY = "cardoria_marketplace_sell_draft";
  var MAX_PHOTOS = 6;
  var MAX_SIDE = 1400;
  var JPEG_QUALITY = 0.82;

  function safeParse(raw, fallback) {
    try { return JSON.parse(raw || "") || fallback; } catch { return fallback; }
  }

  function getDraft() {
    return safeParse(sessionStorage.getItem(DRAFT_KEY), {});
  }

  function saveDraft(draft) {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft || {}));
  }

  function getPhotos() {
    var photos = safeParse(sessionStorage.getItem(PHOTO_KEY), []);
    return Array.isArray(photos) ? photos.slice(0, MAX_PHOTOS) : [];
  }

  function savePhotos(photos) {
    sessionStorage.setItem(PHOTO_KEY, JSON.stringify((photos || []).slice(0, MAX_PHOTOS)));
  }

  function fileToCompressedDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var original = String(reader.result || "");
        var img = new Image();
        img.onload = function () {
          try {
            var scale = Math.min(1, MAX_SIDE / Math.max(img.width || 1, img.height || 1));
            var width = Math.max(1, Math.round(img.width * scale));
            var height = Math.max(1, Math.round(img.height * scale));
            var canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            var ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
          } catch (e) {
            resolve(original);
          }
        };
        img.onerror = function () { resolve(original); };
        img.src = original;
      };
      reader.readAsDataURL(file);
    });
  }

  function saveFiles(files) {
    var list = Array.prototype.slice.call(files || [], 0, MAX_PHOTOS);
    return Promise.all(list.map(fileToCompressedDataUrl)).then(function (photos) {
      try {
        savePhotos(photos);
      } catch (e) {
        throw new Error("Les photos sont trop volumineuses pour le transfert temporaire. Réessayez avec moins de photos.");
      }
      return photos;
    });
  }

  function dataUrlToFile(dataUrl, index) {
    var parts = String(dataUrl || "").split(",");
    var meta = parts[0] || "";
    var mimeMatch = meta.match(/data:([^;]+)/);
    var mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    var binary = atob(parts[1] || "");
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], "cardoria-marketplace-" + (index + 1) + ".jpg", { type: mime });
  }

  function restoreFilesIntoEstimation() {
    var params = new URLSearchParams(location.search);
    if (params.get("source") !== "marketplace") return;

    var photos = getPhotos();
    var draft = getDraft();
    var fileInput = document.getElementById("cardFiles");

    if (fileInput && photos.length && typeof DataTransfer !== "undefined") {
      try {
        var transfer = new DataTransfer();
        photos.forEach(function (photo, index) { transfer.items.add(dataUrlToFile(photo, index)); });
        fileInput.files = transfer.files;
      } catch (e) { /* le résumé visuel reste affiché même si le navigateur bloque DataTransfer */ }
    }

    var cardName = document.getElementById("cardName");
    var cardGame = document.getElementById("cardGame");
    var cardCondition = document.getElementById("cardCondition");
    if (cardName && draft.title && !cardName.value) cardName.value = draft.title;
    if (cardGame && draft.gameLabel) cardGame.value = draft.gameLabel;
    if (cardCondition && draft.estimationCondition) cardCondition.value = draft.estimationCondition;

    var form = fileInput ? fileInput.closest(".form") : null;
    if (!form || document.getElementById("marketplaceEstimateReturn")) return;

    var box = document.createElement("div");
    box.id = "marketplaceEstimateReturn";
    box.className = "notice";
    box.innerHTML = '<b>Photos Marketplace récupérées :</b> ' + photos.length +
      ' photo' + (photos.length > 1 ? 's' : '') +
      '. Vous pouvez lancer l\'estimation puis revenir à votre annonce sans les sélectionner de nouveau.' +
      '<div style="margin-top:12px"><button class="secondary" type="button" id="backToMarketplaceSell">Retour à la mise en vente</button></div>';
    form.insertBefore(box, document.getElementById("estimateResult") || null);

    document.getElementById("backToMarketplaceSell").onclick = function () {
      location.href = "/vendre.html?from=estimation";
    };
  }

  window.CardoriaMarketplaceEstimateBridge = {
    getDraft: getDraft,
    saveDraft: saveDraft,
    getPhotos: getPhotos,
    savePhotos: savePhotos,
    saveFiles: saveFiles
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restoreFilesIntoEstimation);
  else restoreFilesIntoEstimation();
})();
