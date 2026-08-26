/**
 * Authentification Cardoria — comptes clients/admin, sessions et 2FA.
 */
import crypto from "crypto";
import { Router } from "express";
import { getUserById, getUserByEmail, createUser, authenticateUser, setTotpSecret, getTotpSecret, ADMIN_ROLES } from "../lib/auth/users.js";
import { createSession, revokeSession, validateSession } from "../lib/auth/session.js";
import { generateTotpSecret, verifyTotp, getTotpUri } from "../lib/auth/totp.js";
import { requestPasswordReset, confirmPasswordReset } from "../lib/auth/passwordReset.js";
import { requestMagicLogin, consumeMagicLogin } from "../lib/auth/magicLink.js";
import { validateBody, SCHEMAS } from "../lib/security/validate.js";
import { authRateLimit } from "../lib/security/rateLimit.js";
import { generateCsrfToken } from "../lib/security/csrf.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validPassword(value) {
  const p = String(value || "");
  return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function secureStringEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a || "")).digest();
  const right = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(left, right);
}

function authenticateConfiguredAdmin(email, password) {
  const adminEmail = normalizedEmail(process.env.ADMIN_EMAIL || "Cardoria59330@gmail.com");
  const adminPassword = String(process.env.ADMIN_LOGIN_PASSWORD || "");
  if (!adminPassword || email !== adminEmail) return null;
  if (!secureStringEqual(password, adminPassword)) {
    throw Object.assign(new Error("Email ou mot de passe incorrect."), { status: 401 });
  }
  const user = getUserByEmail(email);
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    throw Object.assign(new Error("Compte administrateur indisponible."), { status: 403 });
  }
  return user;
}

router.post("/register", authRateLimit, (req, res) => {
  try {
    const email = normalizedEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim().slice(0, 120);
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: "Email invalide." });
    if (!validPassword(password)) return res.status(400).json({ ok: false, error: "Mot de passe: 10 caracteres minimum avec lettres et chiffres." });
    if (getUserByEmail(email)) return res.status(409).json({ ok: false, error: "Un compte existe deja pour cet email." });
    const user = createUser({ email, password, role: "client", name });
    const session = createSession(user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
    logAudit({ type: "auth", action: "client_register", user: email, detail: "marketplace" });
    res.status(201).json({ ok: true, token: session.token, expiresAt: session.expiresAt, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/login", authRateLimit, (req, res) => {
  try {
    const email = normalizedEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const user = authenticateConfiguredAdmin(email, password) || authenticateUser(email, password);
    if (!user) return res.status(401).json({ ok: false, error: "Email ou mot de passe incorrect." });
    const session = createSession(user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
    logAudit({ type: "auth", action: "login_success", user: user.email, detail: user.role });
    res.json({ ok: true, token: session.token, expiresAt: session.expiresAt, user: { id: user.id, email: user.email, role: user.role, name: user.name }, csrfToken: generateCsrfToken(user.id) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/email/request", authRateLimit, async (req, res) => {
  const v = validateBody(SCHEMAS.passwordResetRequest, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  try { res.json(await requestMagicLogin(v.data.email)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.post("/email/confirm", authRateLimit, (req, res) => {
  try {
    const user = consumeMagicLogin(String(req.body?.token || ""));
    const session = createSession(user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
    logAudit({ type: "auth", action: "email_login_success", user: user.email, detail: user.role });
    res.json({ ok: true, token: session.token, expiresAt: session.expiresAt, user: { id: user.id, email: user.email, role: user.role, name: user.name }, csrfToken: generateCsrfToken(user.id) });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.post("/logout", (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  revokeSession(token);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user) return res.status(401).json({ ok: false, error: "Session expiree." });
  res.json({ ok: true, user });
});

router.post("/password/request", authRateLimit, async (req, res) => {
  const v = validateBody(SCHEMAS.passwordResetRequest, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  res.json(await requestPasswordReset(v.data.email));
});

router.post("/password/confirm", authRateLimit, (req, res) => {
  const v = validateBody(SCHEMAS.passwordResetConfirm, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  try { confirmPasswordReset(v.data.token, v.data.password); res.json({ ok: true, message: "Mot de passe mis a jour." }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.post("/2fa/setup", (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user || !ADMIN_ROLES.includes(user.role)) return res.status(401).json({ ok: false, error: "Session requise." });
  const secret = generateTotpSecret();
  setTotpSecret(user.id, secret, false);
  res.json({ ok: true, secret, uri: getTotpUri(secret, user.email), enabled: false });
});

router.post("/2fa/enable", (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user) return res.status(401).json({ ok: false, error: "Session requise." });
  const totp = getTotpSecret(user.id);
  if (!totp?.secret || !verifyTotp(totp.secret, req.body?.totpCode)) return res.status(400).json({ ok: false, error: "Code 2FA invalide." });
  setTotpSecret(user.id, totp.secret, true);
  res.json({ ok: true, enabled: true });
});

export default router;
