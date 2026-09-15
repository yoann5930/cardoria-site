(function () {
  "use strict";

  var STORAGE = {
    cam1: "cardoria_live_camera_primary",
    cam2: "cardoria_live_camera_secondary",
    mic1: "cardoria_live_mic_primary",
    mic2: "cardoria_live_mic_secondary"
  };

  function qs(selector) { return document.querySelector(selector); }

  function remember(select, key) {
    if (!select) return;
    try {
      var saved = localStorage.getItem(key) || "";
      if (saved && Array.prototype.some.call(select.options || [], function (option) { return option.value === saved; })) select.value = saved;
    } catch (e) {}
    if (!select.dataset.cardoriaRememberBound) {
      select.dataset.cardoriaRememberBound = "1";
      select.addEventListener("change", function () {
        try { localStorage.setItem(key, select.value || ""); } catch (e) {}
      });
    }
  }

  function fillSelect(select, items, placeholder, savedKey, itemLabel) {
    if (!select) return;
    var current = select.value || "";
    var saved = "";
    try { saved = localStorage.getItem(savedKey) || ""; } catch (e) {}
    select.innerHTML = "";
    var automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = placeholder;
    select.appendChild(automatic);
    (items || []).forEach(function (device, index) {
      var option = document.createElement("option");
      option.value = String(device.deviceId || "");
      option.textContent = device.label || ((itemLabel || "Périphérique") + " " + (index + 1));
      select.appendChild(option);
    });
    var preferred = saved || current;
    if (preferred && Array.prototype.some.call(select.options, function (option) { return option.value === preferred; })) select.value = preferred;
  }

  function buildVisibleControls() {
    var cam1Block = qs("#liveCam1Block");
    var cam2Block = qs("#liveCam2Block");
    var cam1 = qs("#liveCameraSelect1");
    var cam2 = qs("#liveCameraSelect2");
    var mic1 = qs("#liveMicSelect1");
    var mic2 = qs("#liveMicSelect2");
    if (!cam1Block || !cam2Block || !cam1 || !cam2) return false;

    var wrap1 = qs("#liveCam1DevicePicker");
    if (!wrap1) {
      wrap1 = document.createElement("div");
      wrap1.id = "liveCam1DevicePicker";
      wrap1.className = "admin-filters live-camera-device-picker";
      wrap1.innerHTML = "<label for='liveCameraSelect1'><strong>Entrée vidéo Caméra 1</strong></label>";
      cam1Block.insertBefore(wrap1, cam1Block.querySelector(".admin-live-actions"));
    }
    wrap1.appendChild(cam1);
    if (mic1) wrap1.appendChild(mic1);

    var wrap2 = qs("#liveCam2DevicePicker");
    if (!wrap2) {
      wrap2 = document.createElement("div");
      wrap2.id = "liveCam2DevicePicker";
      wrap2.className = "admin-filters live-camera-device-picker";
      wrap2.innerHTML = "<label for='liveCameraSelect2'><strong>Entrée vidéo Caméra 2</strong></label>";
      cam2Block.insertBefore(wrap2, cam2Block.querySelector(".admin-live-actions"));
    }
    wrap2.appendChild(cam2);
    if (mic2) wrap2.appendChild(mic2);

    var button = qs("#liveRefreshDevices");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.id = "liveRefreshDevices";
      button.className = "live-studio-btn";
      button.textContent = "Autoriser / actualiser les caméras";
      wrap1.appendChild(button);
    }
    var status = qs("#liveDevicePickerStatus");
    if (!status) {
      status = document.createElement("p");
      status.id = "liveDevicePickerStatus";
      status.className = "admin-live-camera-warn";
      status.setAttribute("aria-live", "polite");
      wrap1.appendChild(status);
    }

    remember(cam1, STORAGE.cam1);
    remember(cam2, STORAGE.cam2);
    remember(mic1, STORAGE.mic1);
    remember(mic2, STORAGE.mic2);
    return true;
  }

  async function enumerateAndFill() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) throw new Error("Ce navigateur ne permet pas de lister les caméras.");
    var devices = await navigator.mediaDevices.enumerateDevices();
    var cameras = devices.filter(function (device) { return device.kind === "videoinput"; });
    var microphones = devices.filter(function (device) { return device.kind === "audioinput"; });
    fillSelect(qs("#liveCameraSelect1"), cameras, "Caméra automatique", STORAGE.cam1, "Caméra");
    fillSelect(qs("#liveCameraSelect2"), cameras, "Caméra automatique", STORAGE.cam2, "Caméra");
    fillSelect(qs("#liveMicSelect1"), microphones, "Micro automatique", STORAGE.mic1, "Micro");
    fillSelect(qs("#liveMicSelect2"), microphones, "Micro automatique", STORAGE.mic2, "Micro");
    var status = qs("#liveDevicePickerStatus");
    if (status) status.textContent = cameras.length ? (cameras.length + " caméra(s) détectée(s). Choisissez l’entrée avant de démarrer.") : "Aucune caméra détectée.";
    return { cameras: cameras, microphones: microphones };
  }

  async function requestPermissionAndRefresh() {
    var status = qs("#liveDevicePickerStatus");
    if (status) status.textContent = "Autorisation caméra en cours…";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Caméra non prise en charge par ce navigateur.");
    var temp = null;
    try {
      temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } finally {
      if (temp && temp.getTracks) temp.getTracks().forEach(function (track) { track.stop(); });
    }
    return enumerateAndFill();
  }

  function bind() {
    if (!buildVisibleControls()) return false;
    var button = qs("#liveRefreshDevices");
    if (button && !button.dataset.bound) {
      button.dataset.bound = "1";
      button.addEventListener("click", function () {
        requestPermissionAndRefresh().catch(function (error) {
          var status = qs("#liveDevicePickerStatus");
          if (status) status.textContent = "Erreur caméra : " + (error && error.message ? error.message : "autorisation refusée ou caméra indisponible");
        });
      });
    }
    enumerateAndFill().catch(function () {});
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener && !navigator.mediaDevices.__cardoriaDeviceChangeBound) {
      navigator.mediaDevices.__cardoriaDeviceChangeBound = true;
      navigator.mediaDevices.addEventListener("devicechange", function () { enumerateAndFill().catch(function () {}); });
    }
    return true;
  }

  if (!bind()) {
    var observer = new MutationObserver(function () {
      if (bind()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 10000);
  }
})();
