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

export const LIVE_SOURCE_PRIMARY = "primary";
export const LIVE_SOURCE_SECONDARY = "secondary";
export const LIVE_MAX_PUBLISHERS = 2;

export function sameCameraSelected(cameraIdA, cameraIdB) {
  const a = String(cameraIdA || "");
  const b = String(cameraIdB || "");
  return Boolean(a && b && a === b);
}

export function assignDistinctCameras({ cameras = [], primaryId = "", secondaryId = "", occupiedIds = [] } = {}) {
  const ids = (cameras || []).map((item) => String(item?.deviceId || item || "")).filter(Boolean);
  const occupied = new Set((occupiedIds || []).map((item) => String(item || "")).filter(Boolean));
  let primary = String(primaryId || "");
  let secondary = String(secondaryId || "");
  if (!primary) primary = ids.find((id) => !occupied.has(id)) || ids[0] || "";
  if (!secondary) secondary = ids.find((id) => id !== primary && !occupied.has(id)) || "";
  const conflict = sameCameraSelected(primary, secondary);
  return {
    primary,
    secondary,
    conflict,
    distinctAvailable: ids.filter((id, index) => ids.indexOf(id) === index).length >= 2
  };
}

export function describeSourceState(state = "inactive") {
  const key = String(state || "inactive");
  const labels = {
    inactive: "inactive",
    connecting: "connexion",
    live: "diffusion",
    error: "erreur",
    phone: "téléphone"
  };
  return labels[key] || labels.inactive;
}

export function canStartSecondaryPc({ phonePaired = false, sourceCount = 0, max = LIVE_MAX_PUBLISHERS } = {}) {
  if (phonePaired) {
    return {
      ok: false,
      code: "PHONE_SECONDARY",
      retry: true,
      text: "Caméra 2 est déjà utilisée par le téléphone. Arrêtez Caméra 2 / téléphone avant de lancer Caméra 2 PC."
    };
  }
  if (Number(sourceCount) >= Number(max) && Number(max) > 0) {
    return {
      ok: false,
      code: "LIVE_CAMERA_LIMIT",
      retry: false,
      text: "Deux caméras maximum sont autorisées sur ce Live."
    };
  }
  return { ok: true, code: "", retry: false, text: "" };
}

export function thirdSourceMessage() {
  return "Deux caméras maximum sont autorisées sur ce Live. Arrêtez une source avant d’en lancer une troisième.";
}
