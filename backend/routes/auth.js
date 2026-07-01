/**
 * Authentification publique — login, 2FA, reset password.
 */
import { Router } from "express";
import { authenticateUser, getUserById, setTotpSecret, getTotpSecret, ADMIN_ROLES } from "../lib/auth/users.js";
import { createSession, revokeSession, validateSession } from "../lib/auth/session.js";
import { generateTotpSecret, verifyTotp, getTotpUri } from "../lib/auth/totp.js";
import { requestPasswordReset, confirmPasswordReset } from "../lib/auth/passwordReset.js";
import { validateBody, SCHEMAS } from "../lib/security/validate.js";
import { authRateLimit } from "../lib/security/rateLimit.js";
import { generateCsrfToken } from "../lib/security/csrf.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.post("/login", authRateLimit, (req, res) => {
  const v = validateBody({
    email: SCHEMAS.login.email,
    password: SCHEMAS.login.password,
    totpCode: { type: "string", maxLength: 8, allowNewlines: false }
  }, req.body);

  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });

  try {
    const user = authenticateUser(v.data.email, v.data.password);
    if (!user) {
      logAudit({ type: "auth", action: "login_failed", user: v.data.email, detail: "Identifiants invalides" });
      return res.status(401).json({ ok: false, error: "Email ou mot de passe incorrect." });
    }

    if (!ADMIN_ROLES.includes(user.role)) {
      return res.status(403).json({ ok: false, error: "Accès réservé au back-office." });
    }

    const totp = getTotpSecret(user.id);
    if (totp?.enabled) {
      if (!v.data.totpCode || !verifyTotp(totp.secret, v.data.totpCode)) {
        return res.status(401).json({ ok: false, error: "Code 2FA requis ou invalide.", requires2fa: true });
      }
    }

    const session = createSession(user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
    logAudit({ type: "auth", action: "login_success", user: user.email, detail: user.role });

    res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
      csrfToken: generateCsrfToken(user.id)
    });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.headers["x-session-token"];
  revokeSession(token);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user) return res.status(401).json({ ok: false, error: "Session expirée." });
  res.json({ ok: true, user });
});

router.post("/password/request", authRateLimit, async (req, res) => {
  const v = validateBody(SCHEMAS.passwordResetRequest, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  const result = await requestPasswordReset(v.data.email);
  res.json(result);
});

router.post("/password/confirm", authRateLimit, (req, res) => {
  const v = validateBody(SCHEMAS.passwordResetConfirm, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  try {
    confirmPasswordReset(v.data.token, v.data.password);
    res.json({ ok: true, message: "Mot de passe mis à jour." });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/2fa/setup", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    return res.status(401).json({ ok: false, error: "Session requise." });
  }
  const secret = generateTotpSecret();
  setTotpSecret(user.id, secret, false);
  res.json({ ok: true, secret, uri: getTotpUri(secret, user.email), enabled: false });
});

router.post("/2fa/enable", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user) return res.status(401).json({ ok: false, error: "Session requise." });

  const totp = getTotpSecret(user.id);
  const code = req.body?.totpCode;
  if (!totp?.secret || !verifyTotp(totp.secret, code)) {
    return res.status(400).json({ ok: false, error: "Code 2FA invalide." });
  }
  setTotpSecret(user.id, totp.secret, true);
  res.json({ ok: true, enabled: true });
});

/** Compatibilité legacy code admin */
router.post("/legacy", authRateLimit, (req, res) => {
  const v = validateBody(SCHEMAS.legacyAdminLogin, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });

  const expected = process.env.ADMIN_CODE;
  if (!expected || v.data.code !== expected) {
    logAudit({ type: "auth", action: "legacy_login_failed", user: "unknown", detail: "" });
    return res.status(401).json({ ok: false, error: "Code incorrect." });
  }

  logAudit({ type: "auth", action: "legacy_login_success", user: "admin", detail: "" });
  res.json({ ok: true, token: expected, legacy: true });
});

export default router;
