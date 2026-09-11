/** Helpers caméra/micro Live — utilisés par les tests et alignés sur le frontend. */

export const LIVE_PERMISSIONS_POLICY = "camera=(self), microphone=(self), geolocation=(), payment=(self)";

export function isMobileUserAgent(userAgent = "") {
  return /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(String(userAgent || ""));
}

export function permissionStateBlocksCamera(states = {}) {
  return states.camera === "denied" || states.microphone === "denied";
}

export function isCameraBlockedByPermissionsPolicy(doc = globalThis.document) {
  if (!doc) return false;
  const policy = doc.featurePolicy || doc.permissionsPolicy;
  if (policy && typeof policy.allowsFeature === "function") {
    try {
      return policy.allowsFeature("camera") === false || policy.allowsFeature("microphone") === false;
    } catch {
      return false;
    }
  }
  return false;
}

export function buildGetUserMediaAttempts({ isMobile = false, cameraId = "", microphoneId = "", audio = true } = {}) {
  const audioConstraint = microphoneId ? { deviceId: { exact: String(microphoneId) } } : audio;
  const attempts = [];
  if (cameraId) {
    attempts.push({ video: { deviceId: { exact: String(cameraId) } }, audio: audioConstraint });
    attempts.push({ video: { deviceId: { exact: String(cameraId) } }, audio: false });
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

export function explainGetUserMediaError(error, { host = "cardoriashop.fr" } = {}) {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  const denied = name === "NotAllowedError" || /permission denied/i.test(message);
  if (denied) {
    return {
      code: "NotAllowedError",
      retry: true,
      text: `Le navigateur a refusé l’accès à la caméra ou au microphone. Dans les paramètres du site, autorisez Caméra et Microphone pour ${host}, puis cliquez sur Réessayer.`
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "NotFoundError",
      retry: true,
      text: "Aucune caméra ou aucun microphone n’a été détecté. Branchez une webcam ou autorisez l’accès aux périphériques, puis réessayez."
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      code: "NotReadableError",
      retry: true,
      text: "La caméra ou le microphone est déjà utilisé par une autre application. Fermez cet autre programme, puis réessayez."
    };
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return {
      code: "OverconstrainedError",
      retry: true,
      text: "Cette caméra ne correspond pas aux contraintes demandées. Une autre webcam disponible va être utilisée, ou choisissez un périphérique dans la liste."
    };
  }
  if (name === "SecurityError" || /permissions-policy|feature is disabled/i.test(message)) {
    return {
      code: "SecurityError",
      retry: true,
      text: `L’accès caméra/micro est bloqué par la politique de sécurité de la page. Rechargez ${host} en HTTPS, puis réessayez.`
    };
  }
  if (name === "NotSupportedError") {
    return {
      code: "NotSupportedError",
      retry: false,
      text: "Ce navigateur ne peut pas ouvrir la caméra. Utilisez Edge ou Chrome à jour, en HTTPS."
    };
  }
  return {
    code: name || "MediaError",
    retry: true,
    text: "Impossible d’ouvrir la caméra. Vérifiez les autorisations Caméra et Microphone, puis réessayez."
  };
}
