(function (global) {
  "use strict";

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  async function fileToOptimizedDataUrl(file) {
    if (!file || !/^image\//i.test(file.type || "")) throw new Error("Fichier image requis.");
    var source = await readFile(file);
    var img = await loadImage(source);
    var maxDimension = 1600;
    var width = img.naturalWidth || img.width;
    var height = img.naturalHeight || img.height;
    var scale = Math.min(1, maxDimension / Math.max(width, height));
    var targetWidth = Math.max(1, Math.round(width * scale));
    var targetHeight = Math.max(1, Math.round(height * scale));
    var canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    var ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    var quality = 0.86;
    var out = canvas.toDataURL("image/jpeg", quality);
    while (out.length > 1800000 && quality > 0.58) {
      quality -= 0.08;
      out = canvas.toDataURL("image/jpeg", quality);
    }
    return out;
  }

  global.CardoriaEstimationImage = {
    fileToOptimizedDataUrl: fileToOptimizedDataUrl
  };
})(window);
