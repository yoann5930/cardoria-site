/**
 * Protection CSRF — token double-submit pour routes admin mutantes.
 */
import crypto from "crypto";

const tokens = new Map();
const TTL = 4 * 3600_000;

export function generateCsrfToken(sessionKey = "default") {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, { sessionKey, expiresAt: Date.now() + TTL });
  if (tokens.size > 5000) {
    const now = Date.now();
    for (const [k, v] of tokens) if (v.expiresAt < now) tokens.delete(k);
  }
  return token;
}

export function validateCsrfToken(token, sessionKey = "default") {
  if (!token) return false;
  const entry = tokens.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    tokens.delete(token);
    return false;
  }
  if (entry.sessionKey !== sessionKey) return false;
  tokens.delete(token);
  return true;
}

export function csrfProtection(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (process.env.CSRF_ENABLED !== "true") return next();

  const token = req.headers["x-csrf-token"] || req.body?._csrf;
  const sessionKey = req.authUser?.id || req.adminCode || req.ip || "default";

  if (!validateCsrfToken(token, sessionKey)) {
    return res.status(403).json({ ok: false, error: "Token CSRF invalide ou expiré." });
  }
  next();
}
