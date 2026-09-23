(function (global) {
  "use strict";

  var state = {
    sessionId: "",
    qrUrl: "",
    remoteImages: [],
    lastCount: 0,
    pollTimer: null,
    starting: false
  };

  function qs(id) { return document.getElementById(id); }

  function localCount() {
    return qs("cardFiles") && qs("cardFiles").files ? qs("cardFiles").files.length : 0;
  }

  function totalCount() {
    return Math.min(6, localCount() + state.remoteImages.length);
  }

  function updateSubmitState() {
    var button = qs("estimateSubmit");
    var requirement = qs("photoRequirement");
    var count = totalCount();
    if (button) button.disabled = count < 1;
    if (requirement) {
      requirement.textContent = count
        ? count + " photo" + (count > 1 ? "s" : "") + " prête" + (count > 1 ? "s" : "") + " pour l'estimation."
        : "Au moins 1 photo est obligatoire pour lancer l'estimation.";
      requirement.classList.toggle("is-ready", count > 0);
    }
  }

  function renderRemoteImages() {
    var box = qs("phoneCaptureThumbs");
    if (!box) return;
    box.innerHTML = "";
    state.remoteImages.forEach(function (src, index) {
      var figure = document.createElement("figure");
      figure.className = "estimate-phone-thumb";
      var img = document.createElement("img");
      img.src = src;
      img.alt = "Photo téléphone " + (index + 1);
      figure.appendChild(img);
      box.appendChild(figure);
    });
    updateSubmitState();
  }

  async function fetchRemotePhotos() {
    if (!state.sessionId) return;
    var response = await fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(state.sessionId) + "/photos", { cache: "no-store" });
    if (!response.ok) return;
    var data = await response.json();
    state.remoteImages = Array.isArray(data.imagesBase64) ? data.imagesBase64.slice(0, 6) : [];
    state.lastCount = state.remoteImages.length;
    renderRemoteImages();
  }

  async function poll() {
    if (!state.sessionId) return;
    try {
      var response = await fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(state.sessionId), { cache: "no-store" });
      if (response.status === 404) {
        stopPolling();
        var statusExpired = qs("phoneCaptureStatus");
        if (statusExpired) statusExpired.textContent = "Session expirée. Générez un nouveau QR code.";
        return;
      }
      var data = await response.json();
      if (data.ok && Number(data.count || 0) !== state.lastCount) {
        await fetchRemotePhotos();
      }
      var status = qs("phoneCaptureStatus");
      if (status && data.ok) {
        status.textContent = data.count
          ? data.count + " photo" + (data.count > 1 ? "s" : "") + " reçue" + (data.count > 1 ? "s" : "") + " depuis le téléphone."
          : "En attente des photos du téléphone…";
      }
    } catch (e) {
      var statusError = qs("phoneCaptureStatus");
      if (statusError) statusError.textContent = "Connexion temporairement interrompue.";
    }
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function startSession() {
    if (state.starting || state.sessionId) return;
    state.starting = true;
    var status = qs("phoneCaptureStatus");
    if (status) status.textContent = "Création du QR code…";
    try {
      var response = await fetch("/api/estimation-carte/capture/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      var data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "QR indisponible.");
      state.sessionId = data.sessionId;
      state.qrUrl = data.qrUrl;
      var panel = qs("phoneCaptureSession");
      var qr = qs("phoneCaptureQr");
      if (panel) panel.hidden = false;
      if (qr) qr.src = data.qrUrl;
      if (status) status.textContent = "Scannez le QR code avec votre téléphone.";
      stopPolling();
      state.pollTimer = setInterval(poll, 2000);
      poll();
    } catch (e) {
      if (status) status.textContent = "Impossible de créer le QR code : " + e.message;
    } finally {
      state.starting = false;
    }
  }

  function init() {
    if (!qs("estimateSubmit")) return;

    var files = qs("cardFiles");
    if (files) files.addEventListener("change", updateSubmitState);

    var start = qs("startPhoneCapture");
    if (start) start.addEventListener("click", startSession);

    updateSubmitState();

    if (global.matchMedia && global.matchMedia("(min-width: 900px)").matches) {
      startSession();
    }
  }

  global.CardoriaEstimationCapture = {
    getImages: function () { return state.remoteImages.slice(0, 6); },
    hasPhotos: function () { return totalCount() > 0; },
    updateSubmitState: updateSubmitState,
    startSession: startSession
  };

  document.addEventListener("DOMContentLoaded", init);
})(window);
