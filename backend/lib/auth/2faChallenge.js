import crypto from "crypto";

const CHALLENGE_TTL_MS = Math.max(2 * 60_000, Math.min(15 * 60_000, Number(process.env.AUTH_2FA_CHALLENGE_MS || 10 * 60_000)));
const MAX_ATTEMPTS = 5;
const challenges = new Map();

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function cleanup() {
  const now = Date.now();
  for (const [key, item] of challenges.entries()) {
    if (!item || item.expiresAtMs <= now) challenges.delete(key);
  }
}

export function create2faChallenge({ userId, mode = "login", setupSecret = "", ip = "", userAgent = "" } = {}) {
  cleanup();
  if (!userId) throw new Error("Utilisateur 2FA requis.");
  if (!["login", "setup"].includes(mode)) throw new Error("Mode 2FA invalide.");

  const token = crypto.randomBytes(48).toString("base64url");
  const now = Date.now();
  challenges.set(hashToken(token), {
    userId: String(userId),
    mode,
    setupSecret: mode === "setup" ? String(setupSecret || "") : "",
    ip: String(ip || "").slice(0, 120),
    userAgent: String(userAgent || "").slice(0, 255),
    createdAtMs: now,
    expiresAtMs: now + CHALLENGE_TTL_MS,
    attempts: 0
  });
  return { token, mode, expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString() };
}

export function get2faChallenge(token) {
  cleanup();
  const key = hashToken(token);
  const item = challenges.get(key);
  if (!item) return null;
  return { ...item, key };
}

export function record2faFailure(token) {
  const key = hashToken(token);
  const item = challenges.get(key);
  if (!item) return { valid: false, attemptsRemaining: 0 };
  item.attempts += 1;
  if (item.attempts >= MAX_ATTEMPTS) {
    challenges.delete(key);
    return { valid: false, attemptsRemaining: 0 };
  }
  challenges.set(key, item);
  return { valid: true, attemptsRemaining: MAX_ATTEMPTS - item.attempts };
}

export function consume2faChallenge(token) {
  const key = hashToken(token);
  const item = challenges.get(key) || null;
  challenges.delete(key);
  return item;
}

export function revokeUser2faChallenges(userId) {
  const id = String(userId || "");
  for (const [key, item] of challenges.entries()) {
    if (item?.userId === id) challenges.delete(key);
  }
}

export function get2faChallengeStats() {
  cleanup();
  return { active: challenges.size, ttlMs: CHALLENGE_TTL_MS, maxAttempts: MAX_ATTEMPTS };
}
