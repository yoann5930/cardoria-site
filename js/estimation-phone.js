(function () {
  "use strict";

  function qs(id) { return document.getElementById(id); }

  var params = new URLSearchParams(location.search);
  var sessionId = params.get("session") || "";
  var count = 0;
  var stream = null;
  var cameraStarting = false;

  function setStatus(message, isError) {
    var el = qs("phonePhotoStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-error", !!isError);
  }

  function setCount(nextCount) {
    count = Math.max(0, Math.min(6, Number(nextCount || 0)));
    var counter = qs("phonePhotoCount");
    if (counter) counter.textContent = count + " / 6";
    var shot = qs("phoneCameraShot");
    if (shot) shot.disabled = count >= 6 || !stream;
    var file = qs("phoneCameraFile");
    if (file) file.disabled = count >= 6;
    if (count >= 6) {
      setStatus("6 photos reçues. Revenez sur le PC pour lancer l'estimation.");
      stopCamera();
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    var video = qs("phoneCameraPreview");
    if (video) video.srcObject = null;
    var shot = qs("phoneCameraShot");
    if (shot) shot.disabled = true;
  }

  function cameraErrorMessage(error) {
    var name = String(error && error.name || "");
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "L'accès à la caméra a été refusé. Autorisez la caméra pour cardoriashop.fr dans votre navigateur puis appuyez sur Réessayer.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "Aucune caméra n'a été détectée sur ce téléphone.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "La caméra est déjà utilisée par une autre application. Fermez-la puis réessayez.";
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return "Ce navigateur ne permet pas l'ouverture directe de la caméra.";
    }
    return "Impossible d'ouvrir directement la caméra. Vérifiez les autorisations puis réessayez.";
  }

  async function startCamera() {
    if (cameraStarting || count >= 6) return;
    cameraStarting = true;

    var loading = qs("phoneCameraLoading");
    var retry = qs("phoneCameraRetry");
    var fallback = qs("phoneCameraFallback");
    var shot = qs("phoneCameraShot");
    var video = qs("phoneCameraPreview");

    if (loading) {
      loading.hidden = false;
      loading.textContent = "Ouverture de la caméra arrière…";
    }
    if (retry) retry.hidden = true;
    if (fallback) fallback.hidden = true;
    if (shot) shot.disabled = true;

    stopCamera();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error("getUserMedia indisponible"), { name: "NotSupportedError" });
      }

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      if (!video) throw new Error("Aperçu caméra introuvable.");
      video.srcObject = stream;
      await video.play();

      if (loading) loading.hidden = true;
      if (shot) shot.disabled = count >= 6;
      setStatus("Caméra prête. Cadrez la carte puis appuyez sur « Prendre la photo ».");
    } catch (error) {
      stopCamera();
      if (loading) {
        loading.hidden = false;
        loading.textContent = "Caméra directe indisponible.";
      }
      if (retry) retry.hidden = false;
      if (fallback) fallback.hidden = false;
      setStatus(cameraErrorMessage(error), true);
    } finally {
      cameraStarting = false;
    }
  }

  async function refreshStatus() {
    if (!sessionId) {
      setStatus("Lien photo invalide. Re-scanez le QR code affiché sur le PC.", true);
      return false;
    }
    try {
      var response = await fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(sessionId), { cache: "no-store" });
      if (!response.ok) {
        setStatus("Cette session photo a expiré. Générez un nouveau QR code sur le PC.", true);
        return false;
      }
      var data = await response.json();
      setCount(data.count || 0);
      return true;
    } catch (e) {
      setStatus("Connexion Cardoria impossible.", true);
      return false;
    }
  }

  async function uploadImages(images) {
    if (!images || !images.length || count >= 6) return;
    setStatus("Envoi de la photo vers le PC…");

    var response = await fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(sessionId) + "/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagesBase64: images.slice(0, Math.max(0, 6 - count)) })
    });
    var data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Envoi impossible.");

    setCount(data.count || count);
    if (!data.full) {
      setStatus("Photo reçue sur le PC. Vous pouvez photographier l'autre face ou un détail.");
    }
  }

  function videoFrameToDataUrl() {
    var video = qs("phoneCameraPreview");
    if (!video || !video.videoWidth || !video.videoHeight) {
      throw new Error("La caméra n'est pas encore prête.");
    }

    var maxDimension = 1600;
    var scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    var width = Math.max(1, Math.round(video.videoWidth * scale));
    var height = Math.max(1, Math.round(video.videoHeight * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(video, 0, 0, width, height);

    var quality = 0.88;
    var out = canvas.toDataURL("image/jpeg", quality);
    while (out.length > 1800000 && quality > 0.56) {
      quality -= 0.08;
      out = canvas.toDataURL("image/jpeg", quality);
    }
    return out;
  }

  async function takePhoto() {
    var shot = qs("phoneCameraShot");
    var flash = qs("phoneCameraFlash");
    if (shot) shot.disabled = true;
    if (flash) {
      flash.classList.remove("is-active");
      void flash.offsetWidth;
      flash.classList.add("is-active");
    }
    try {
      var image = videoFrameToDataUrl();
      await uploadImages([image]);
    } catch (error) {
      setStatus("Erreur : " + error.message, true);
    } finally {
      if (shot && stream && count < 6) shot.disabled = false;
    }
  }

  async function uploadFiles(files) {
    var remaining = Math.max(0, 6 - count);
    var selected = Array.prototype.slice.call(files || [], 0, remaining);
    if (!selected.length) return;

    setStatus("Préparation et envoi des photos…");
    try {
      var images = [];
      for (var i = 0; i < selected.length; i += 1) {
        images.push(await window.CardoriaEstimationImage.fileToOptimizedDataUrl(selected[i]));
      }
      await uploadImages(images);
      var input = qs("phoneCameraFile");
      if (input) input.value = "";
    } catch (e) {
      setStatus("Erreur : " + e.message, true);
    }
  }

  async function init() {
    var valid = await refreshStatus();
    if (!valid || count >= 6) return;

    var shot = qs("phoneCameraShot");
    if (shot) shot.addEventListener("click", takePhoto);

    var retry = qs("phoneCameraRetry");
    if (retry) retry.addEventListener("click", startCamera);

    var input = qs("phoneCameraFile");
    if (input) {
      input.addEventListener("change", function () {
        uploadFiles(input.files);
      });
    }

    startCamera();
  }

  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("DOMContentLoaded", init);
})();
