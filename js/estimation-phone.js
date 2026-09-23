(function () {
  "use strict";

  function qs(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  var params = new URLSearchParams(location.search);
  var sessionId = params.get("session") || "";
  var count = 0;
  var stream = null;
  var cameraStarting = false;
  var cameraReady = false;

  function sendEvent(event, detail) {
    if (!sessionId) return;
    fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(sessionId) + "/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: event, detail: String(detail || "").slice(0, 160) }),
      keepalive: true
    }).catch(function () {});
  }

  function setStatus(message, isError) {
    var el = qs("phonePhotoStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-error", !!isError);
  }

  function setLoading(message, hint, showActivate) {
    var loading = qs("phoneCameraLoading");
    var text = qs("phoneCameraLoadingText");
    var hintEl = qs("phoneCameraLoadingHint");
    var activate = qs("phoneCameraActivate");
    if (loading) loading.hidden = false;
    if (text) text.textContent = message || "Ouverture de la caméra";
    if (hintEl) hintEl.textContent = hint || "Autorisez l’accès à la caméra si votre téléphone le demande.";
    if (activate) activate.hidden = !showActivate;
  }

  function hideLoading() {
    var loading = qs("phoneCameraLoading");
    if (loading) loading.hidden = true;
  }

  function setCount(nextCount) {
    count = Math.max(0, Math.min(6, Number(nextCount || 0)));
    var counter = qs("phonePhotoCount");
    if (counter) counter.textContent = count + " / 6";
    var shot = qs("phoneCameraShot");
    if (shot) shot.disabled = count >= 6 || !cameraReady;
    var file = qs("phoneCameraFile");
    if (file) file.disabled = count >= 6;
    if (count >= 6) {
      setStatus("6 photos reçues. Revenez sur le PC pour lancer l'estimation.");
      stopCamera();
    }
  }

  function stopCamera() {
    cameraReady = false;
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
      return "Autorisez la caméra pour cardoriashop.fr puis appuyez sur « Activer la caméra ».";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "Aucune caméra n'a été détectée sur ce téléphone.";
    }
    if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
      return "La caméra est encore utilisée par le lecteur de QR. Patientez une seconde puis réessayez.";
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return "Ce navigateur ne permet pas l'ouverture directe de la caméra.";
    }
    return "Impossible d'ouvrir la caméra. Appuyez sur « Activer la caméra ».";
  }

  async function getCameraStream() {
    var constraints = [
      { video: { facingMode: { exact: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false },
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false },
      { video: true, audio: false }
    ];
    var lastError = null;
    for (var i = 0; i < constraints.length; i += 1) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints[i]);
      } catch (error) {
        lastError = error;
        if (String(error && error.name || "") === "NotAllowedError") break;
      }
    }
    throw lastError || new Error("Caméra indisponible");
  }

  async function startCamera(fromUserGesture) {
    if (cameraStarting || count >= 6) return;
    cameraStarting = true;
    cameraReady = false;

    var retry = qs("phoneCameraRetry");
    var fallback = qs("phoneCameraFallback");
    var shot = qs("phoneCameraShot");
    var activate = qs("phoneCameraActivate");
    var video = qs("phoneCameraPreview");

    if (retry) retry.hidden = true;
    if (fallback) fallback.hidden = true;
    if (activate) activate.hidden = true;
    if (shot) shot.disabled = true;
    setLoading("Ouverture de la caméra", "Autorisez l’accès à la caméra si votre téléphone le demande.", false);
    stopCamera();
    sendEvent("camera_start", fromUserGesture ? "user" : "auto");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error("getUserMedia indisponible"), { name: "NotSupportedError" });
      }

      var attempts = fromUserGesture ? 1 : 3;
      var lastError = null;
      for (var attempt = 0; attempt < attempts; attempt += 1) {
        try {
          if (attempt) await sleep(650 * attempt);
          stream = await getCameraStream();
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          var n = String(error && error.name || "");
          if (n === "NotAllowedError" || n === "SecurityError" || n === "NotFoundError") break;
        }
      }
      if (lastError) throw lastError;
      if (!stream) throw new Error("Caméra indisponible");

      if (!video) throw new Error("Aperçu caméra introuvable.");
      video.srcObject = stream;

      await new Promise(function (resolve, reject) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          resolve();
        }
        function fail() {
          if (done) return;
          done = true;
          reject(new Error("Flux caméra non prêt."));
        }
        if (video.readyState >= 2 && video.videoWidth > 0) return finish();
        video.onloadedmetadata = finish;
        video.oncanplay = finish;
        setTimeout(function () {
          if (video.videoWidth > 0) finish(); else fail();
        }, 5000);
      });

      await video.play().catch(function () {});
      cameraReady = Boolean(video.videoWidth && video.videoHeight);
      if (!cameraReady) throw new Error("La caméra ne fournit pas d'image.");

      hideLoading();
      if (shot) shot.disabled = count >= 6;
      setStatus("Caméra prête. Cadrez la carte puis prenez la photo.");
      sendEvent("camera_ready", video.videoWidth + "x" + video.videoHeight);
    } catch (error) {
      stopCamera();
      var message = cameraErrorMessage(error);
      setLoading("Caméra à activer", message, true);
      if (retry) retry.hidden = false;
      if (fallback) fallback.hidden = false;
      setStatus(message, true);
      sendEvent("camera_error", String(error && error.name || "error"));
    } finally {
      cameraStarting = false;
    }
  }

  async function refreshStatus() {
    if (!sessionId) {
      setStatus("Lien photo invalide. Re-scanez le QR code affiché sur le PC.", true);
      return false;
    }
    sendEvent("page_loaded", "v4");
    try {
      var response = await fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(sessionId), {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      });
      if (!response.ok) {
        setStatus("Cette session photo a expiré. Générez un nouveau QR code sur le PC.", true);
        sendEvent("session_invalid", String(response.status));
        return false;
      }
      var data = await response.json();
      setCount(data.count || 0);
      sendEvent("session_ready", String(data.count || 0));
      return true;
    } catch (e) {
      setStatus("Connexion Cardoria impossible.", true);
      sendEvent("session_error", e && e.name || "fetch");
      return false;
    }
  }

  async function postImages(images) {
    var response = await fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(sessionId) + "/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({ imagesBase64: images.slice(0, Math.max(0, 6 - count)) })
    });
    var text = await response.text();
    var data = {};
    try { data = JSON.parse(text || "{}"); } catch (_) {}
    if (!response.ok || !data.ok) {
      throw new Error(data.error || ("Envoi impossible (HTTP " + response.status + ")."));
    }
    return data;
  }

  async function uploadImages(images) {
    if (!images || !images.length || count >= 6) return;
    setStatus("Envoi de la photo vers le PC…");
    sendEvent("upload_start", String(images[0] && images[0].length || 0));

    var lastError = null;
    for (var attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (attempt) await sleep(500 * attempt);
        var data = await postImages(images);
        setCount(data.count || count);
        if (!data.full) setStatus("Photo reçue sur le PC. Vous pouvez prendre la suivante.");
        sendEvent("upload_success", String(data.count || count));
        return;
      } catch (error) {
        lastError = error;
      }
    }
    sendEvent("upload_error", lastError && lastError.message || "unknown");
    throw lastError || new Error("Envoi impossible.");
  }

  function videoFrameToDataUrl() {
    var video = qs("phoneCameraPreview");
    if (!video || !cameraReady || !video.videoWidth || !video.videoHeight) {
      throw new Error("La caméra n'est pas encore prête.");
    }

    var maxDimension = 1280;
    var scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    var width = Math.max(1, Math.round(video.videoWidth * scale));
    var height = Math.max(1, Math.round(video.videoHeight * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(video, 0, 0, width, height);

    var quality = 0.78;
    var out = canvas.toDataURL("image/jpeg", quality);
    while (out.length > 900000 && quality > 0.5) {
      quality -= 0.07;
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
      sendEvent("photo_taken", String(image.length));
      await uploadImages([image]);
    } catch (error) {
      setStatus("Erreur : " + error.message, true);
    } finally {
      if (shot && cameraReady && count < 6) shot.disabled = false;
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
    var shot = qs("phoneCameraShot");
    if (shot) shot.addEventListener("click", takePhoto);

    var retry = qs("phoneCameraRetry");
    if (retry) retry.addEventListener("click", function () { startCamera(true); });

    var activate = qs("phoneCameraActivate");
    if (activate) activate.addEventListener("click", function () { startCamera(true); });

    var input = qs("phoneCameraFile");
    if (input) {
      input.addEventListener("change", function () {
        uploadFiles(input.files);
      });
    }

    var valid = await refreshStatus();
    if (!valid || count >= 6) return;
    startCamera(false);
  }

  window.addEventListener("pagehide", stopCamera);
  window.addEventListener("pageshow", function (event) {
    if (event.persisted && sessionId && count < 6) {
      refreshStatus().then(function (valid) {
        if (valid) startCamera(false);
      });
    }
  });
  document.addEventListener("DOMContentLoaded", init);
})();
