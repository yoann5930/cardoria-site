(function (global) {
  "use strict";

  function isMobileUserAgent(userAgent) {
    return /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(String(userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "") || ""));
  }

  function isCameraBlockedByPermissionsPolicy() {
    var doc = typeof document !== "undefined" ? document : null;
    if (!doc) return false;
    var policy = doc.featurePolicy || doc.permissionsPolicy;
    if (policy && typeof policy.allowsFeature === "function") {
      try {
        return policy.allowsFeature("camera") === false || policy.allowsFeature("microphone") === false;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  function buildGetUserMediaAttempts(opts) {
    opts = opts || {};
    var isMobile = Boolean(opts.isMobile);
    var cameraId = String(opts.cameraId || "");
    var microphoneId = String(opts.microphoneId || "");
    var audio = opts.audio !== false;
    var audioConstraint = microphoneId ? { deviceId: { exact: microphoneId } } : audio;
    var attempts = [];
    if (cameraId) {
      attempts.push({ video: { deviceId: { exact: cameraId } }, audio: audioConstraint });
      attempts.push({ video: { deviceId: { exact: cameraId } }, audio: false });
      return attempts;
    }
    if (isMobile) {
      attempts.push({ video: { facingMode: { ideal: "environment" } }, audio: audioConstraint });
      attempts.push({ video: { facingMode: { ideal: "user" } }, audio: audioConstraint });
    }
    attempts.push({ video: true, audio: audioConstraint });
    attempts.push({ video: true, audio: false });
    return attempts;
  }

  function explainGetUserMediaError(error, opts) {
    opts = opts || {};
    var host = opts.host || (typeof location !== "undefined" && location.hostname) || "cardoriashop.fr";
    var name = String(error && error.name || "");
    var message = String(error && error.message || "");
    if (name === "NotAllowedError" || /permission denied/i.test(message)) {
      return {
        code: "NotAllowedError",
        retry: true,
        text: "Le navigateur a refusé l’accès à la caméra ou au microphone. Dans les paramètres du site, autorisez Caméra et Microphone pour " + host + ", puis cliquez sur Réessayer."
      };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { code: "NotFoundError", retry: true, text: "Aucune caméra ou aucun microphone n’a été détecté. Branchez une webcam ou autorisez l’accès aux périphériques, puis réessayez." };
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return { code: "NotReadableError", retry: true, text: "La caméra ou le microphone est déjà utilisé par une autre application. Fermez cet autre programme, puis réessayez." };
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return { code: "OverconstrainedError", retry: true, text: "Cette caméra ne correspond pas aux contraintes demandées. Une autre webcam disponible va être utilisée, ou choisissez un périphérique dans la liste." };
    }
    if (name === "SecurityError" || /permissions-policy|feature is disabled/i.test(message)) {
      return { code: "SecurityError", retry: true, text: "L’accès caméra/micro est bloqué par la politique de sécurité de la page. Rechargez " + host + " en HTTPS, puis réessayez." };
    }
    if (name === "NotSupportedError") {
      return { code: "NotSupportedError", retry: false, text: "Ce navigateur ne peut pas ouvrir la caméra. Utilisez Edge ou Chrome à jour, en HTTPS." };
    }
    return { code: name || "MediaError", retry: true, text: "Impossible d’ouvrir la caméra. Vérifiez les autorisations Caméra et Microphone, puis réessayez." };
  }

  function permissionStateBlocksCamera(states) {
    states = states || {};
    return states.camera === "denied" || states.microphone === "denied";
  }

  async function queryPermissionStates() {
    if (!navigator.permissions || !navigator.permissions.query) return {};
    var states = {};
    try { states.camera = (await navigator.permissions.query({ name: "camera" })).state; } catch (error) {}
    try { states.microphone = (await navigator.permissions.query({ name: "microphone" })).state; } catch (error) {}
    return states;
  }

  async function listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { cameras: [], microphones: [] };
    var list = await navigator.mediaDevices.enumerateDevices();
    return {
      cameras: list.filter(function (item) { return item.kind === "videoinput"; }),
      microphones: list.filter(function (item) { return item.kind === "audioinput"; })
    };
  }

  async function detectAvailability() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, reason: "unsupported", cameras: [], microphones: [] };
    }
    if (isCameraBlockedByPermissionsPolicy()) {
      return { ok: false, reason: "permissions-policy", cameras: [], microphones: [] };
    }
    var states = await queryPermissionStates();
    if (permissionStateBlocksCamera(states)) {
      return { ok: false, reason: "denied", cameras: [], microphones: [] };
    }
    var devices = { cameras: [], microphones: [] };
    try {
      devices = await listDevices();
    } catch (error) {}
    return { ok: true, reason: "", cameras: devices.cameras, microphones: devices.microphones, permissionStates: states };
  }

  async function getUserMediaStream(opts) {
    opts = opts || {};
    var availability = await detectAvailability();
    if (availability.reason === "unsupported") {
      throw Object.assign(new Error(explainGetUserMediaError({ name: "NotSupportedError" }).text), { name: "NotSupportedError", cardoriaRetry: false, cardoriaCode: "NotSupportedError" });
    }
    if (availability.reason === "permissions-policy" || availability.reason === "denied") {
      var blocked = explainGetUserMediaError({ name: "NotAllowedError" });
      throw Object.assign(new Error(blocked.text), { name: "NotAllowedError", cardoriaRetry: true, cardoriaCode: blocked.code });
    }
    var attempts = buildGetUserMediaAttempts({
      isMobile: opts.isMobile != null ? opts.isMobile : isMobileUserAgent(),
      cameraId: opts.cameraId,
      microphoneId: opts.microphoneId,
      audio: opts.audio
    });
    var lastError = null;
    for (var i = 0; i < attempts.length; i += 1) {
      try {
        return await navigator.mediaDevices.getUserMedia(attempts[i]);
      } catch (error) {
        lastError = error;
        if (error && error.name === "NotAllowedError") break;
      }
    }
    var explained = explainGetUserMediaError(lastError || { name: "NotFoundError" });
    throw Object.assign(new Error(explained.text), { name: lastError && lastError.name || explained.code, cardoriaRetry: explained.retry, cardoriaCode: explained.code });
  }

  global.CardoriaLiveMedia = {
    isMobileUserAgent: isMobileUserAgent,
    isCameraBlockedByPermissionsPolicy: isCameraBlockedByPermissionsPolicy,
    permissionStateBlocksCamera: permissionStateBlocksCamera,
    buildGetUserMediaAttempts: buildGetUserMediaAttempts,
    explainGetUserMediaError: explainGetUserMediaError,
    listDevices: listDevices,
    detectAvailability: detectAvailability,
    getUserMediaStream: getUserMediaStream
  };
})(typeof window !== "undefined" ? window : globalThis);
