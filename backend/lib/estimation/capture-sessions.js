import crypto from "crypto";

const SESSION_TTL_MS = 10 * 60_000;
const MAX_IMAGES = 6;
const MAX_DATA_URL_LENGTH = 2_000_000;
const sessions = new Map();

export function isValidEstimationImageDataUrl(value) {
  return typeof value === "string" &&
    /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(value) &&
    value.length <= MAX_DATA_URL_LENGTH;
}

function cleanupExpiredSessions(now = Date.now()) {
  for (const [id, session] of sessions.entries()) {
    if (session.expiresAtMs <= now) sessions.delete(id);
  }
}

export function createCaptureSession({ origin = "https://www.cardoriashop.fr" } = {}) {
  cleanupExpiredSessions();
  const id = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  const expiresAtMs = now + SESSION_TTL_MS;
  const safeOrigin = String(origin || "https://www.cardoriashop.fr").replace(/\/$/, "");
  const session = {
    id,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAtMs,
    expiresAt: new Date(expiresAtMs).toISOString(),
    captureUrl: `${safeOrigin}/estimation-photo.html?session=${encodeURIComponent(id)}`,
    imagesBase64: []
  };
  sessions.set(id, session);
  return {
    sessionId: id,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    captureUrl: session.captureUrl
  };
}

function getSession(id) {
  cleanupExpiredSessions();
  const key = String(id || "").trim();
  if (!key) return null;
  return sessions.get(key) || null;
}

export function getCaptureStatus(id) {
  const session = getSession(id);
  if (!session) return null;
  return {
    sessionId: session.id,
    count: session.imagesBase64.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt
  };
}

export function getCapturePhotos(id) {
  const session = getSession(id);
  if (!session) return null;
  return {
    sessionId: session.id,
    count: session.imagesBase64.length,
    imagesBase64: [...session.imagesBase64],
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt
  };
}

export function addCapturePhotos(id, images = []) {
  const session = getSession(id);
  if (!session) return { ok: false, status: 404, error: "Session photo expirée ou introuvable." };

  const incoming = Array.isArray(images) ? images : [];
  const valid = incoming.filter(isValidEstimationImageDataUrl);
  if (!valid.length) {
    return { ok: false, status: 400, error: "Aucune photo valide reçue." };
  }

  const deduped = [];
  const existingHashes = new Set(
    session.imagesBase64.map((img) => crypto.createHash("sha256").update(img).digest("hex"))
  );

  for (const image of valid) {
    const hash = crypto.createHash("sha256").update(image).digest("hex");
    if (existingHashes.has(hash)) continue;
    existingHashes.add(hash);
    deduped.push(image);
  }

  const capacity = Math.max(0, MAX_IMAGES - session.imagesBase64.length);
  const accepted = deduped.slice(0, capacity);
  session.imagesBase64.push(...accepted);
  session.updatedAt = new Date().toISOString();

  return {
    ok: true,
    count: session.imagesBase64.length,
    accepted: accepted.length,
    full: session.imagesBase64.length >= MAX_IMAGES,
    expiresAt: session.expiresAt
  };
}

export function deleteCaptureSession(id) {
  return sessions.delete(String(id || "").trim());
}

export const CAPTURE_LIMITS = {
  ttlMs: SESSION_TTL_MS,
  maxImages: MAX_IMAGES,
  maxDataUrlLength: MAX_DATA_URL_LENGTH
};
