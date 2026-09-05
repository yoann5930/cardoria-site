/**
 * Authentification Cardoria — comptes clients/admin, sessions et 2FA facultatif.
 */
import { Router } from "express";
import { getUserById, getUserByEmail, createUser, authenticateUser, setTotpSecret, getTotpSecret, ADMIN_ROLES } from "../lib/auth/users.js";
import { migrateAuth } from "../lib/auth/migrate.js";
import { createSession, revokeSession, validateSession } from "../lib/auth/session.js";
import { generateTotpSecret, verifyTotp, getTotpUri } from "../lib/auth/totp.js";
import { create2faChallenge, get2faChallenge, record2faFailure, consume2faChallenge, revokeUser2faChallenges } from "../lib/auth/2faChallenge.js";
import { requestPasswordReset, confirmPasswordReset } from "../lib/auth/passwordReset.js";
import { requestMagicLogin, consumeMagicLogin } from "../lib/auth/magicLink.js";
import { validateBody, SCHEMAS } from "../lib/security/validate.js";
import { authRateLimit } from "../lib/security/rateLimit.js";
import { generateCsrfToken } from "../lib/security/csrf.js";
import { logAudit } from "../lib/audit.js";

const router = Router();
const ADMIN_CODE_LOGIN_TEMP_DISABLED = false;
const REQUIRE_ADMIN_2FA = String(
  process.env.ADMIN_REQUIRE_2FA ?? (process.env.NODE_ENV === "test" ? "true" : "false")
).trim().toLowerCase() === "true";

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validPassword(value) {
  const p = String(value || "");
  return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, name: user.name, totpEnabled: !!user.totpEnabled };
}

function rejectTemporaryCodeLogin(res) {
  return res.status(503).json({ ok: false, error: "Connexion par code temporairement désactivée." });
}

function completeSession(user, req) {
  const session = createSession(user.id, { ip: req.ip, userAgent: req.headers["user-agent"] });
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(user),
    csrfToken: generateCsrfToken(user.id)
  };
}

function beginAdmin2fa(user, req, origin = "password") {
  if (ADMIN_CODE_LOGIN_TEMP_DISABLED) return null;
  const totp = getTotpSecret(user.id);
  const enabled = !!totp?.enabled && !!totp?.secret;
  const setupSecret = enabled ? "" : generateTotpSecret();
  const challenge = create2faChallenge({
    userId: user.id,
    mode: enabled ? "login" : "setup",
    setupSecret,
    ip: req.ip,
    userAgent: req.headers["user-agent"]
  });
  logAudit({ type: "auth", action: enabled ? "2fa_challenge_required" : "2fa_setup_required", user: user.email, detail: `${user.role}:${origin}` });
  return {
    ok: true,
    requires2fa: true,
    challengeToken: challenge.token,
    challengeExpiresAt: challenge.expiresAt,
    mode: challenge.mode,
    user: publicUser(user),
    setup: challenge.mode === "setup" ? { secret: setupSecret, uri: getTotpUri(setupSecret, user.email) } : undefined
  };
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
    res.status(201).json({ ok: true, token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/login", authRateLimit, (req, res) => {
  try {
    migrateAuth();

    const email = normalizedEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const user = authenticateUser(email, password);
    if (!user) {
      console.warn("[auth] login_failed invalid_credentials");
      logAudit({ type: "auth", action: "login_failed", user: email || req.ip || "unknown", detail: "invalid_credentials" });
      return res.status(401).json({ ok: false, error: "Email ou mot de passe incorrect." });
    }
    console.log(`[auth] login_success role=${user.role}`);
    logAudit({ type: "auth", action: "login_success", user: user.email, detail: user.role });
    if (ADMIN_ROLES.includes(user.role) && REQUIRE_ADMIN_2FA) {
      return res.json(beginAdmin2fa(user, req, "password"));
    }
    res.json(completeSession(user, req));
  } catch (e) {
    console.warn(`[auth] login_failed status=${e.status || 500} reason=${e.message || "unknown"}`);
    logAudit({ type: "auth", action: "login_failed", user: normalizedEmail(req.body?.email) || req.ip || "unknown", detail: e.message });
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/2fa/login/verify", authRateLimit, (req, res) => {
  if (ADMIN_CODE_LOGIN_TEMP_DISABLED) return rejectTemporaryCodeLogin(res);
  try {
    const challengeToken = String(req.body?.challengeToken || "");
    const code = String(req.body?.totpCode || "").replace(/\s/g, "");
    const challenge = get2faChallenge(challengeToken);
    if (!challenge) return res.status(401).json({ ok: false, error: "Challenge 2FA expiré ou invalide." });
    const user = getUserById(challenge.userId);
    if (!user || !user.active || !ADMIN_ROLES.includes(user.role)) {
      consume2faChallenge(challengeToken);
      return res.status(403).json({ ok: false, error: "Compte administrateur indisponible." });
    }

    const totp = getTotpSecret(user.id);
    const secret = challenge.mode === "setup" ? challenge.setupSecret : totp?.secret;
    if (!secret || !verifyTotp(secret, code)) {
      const failure = record2faFailure(challengeToken);
      logAudit({ type: "security", action: "2fa_failed", user: user.email, detail: `remaining:${failure.attemptsRemaining}` });
      return res.status(401).json({ ok: false, error: failure.attemptsRemaining ? `Code 2FA invalide. ${failure.attemptsRemaining} tentative(s) restante(s).` : "Challenge 2FA bloqué après trop d’échecs." });
    }

    consume2faChallenge(challengeToken);
    if (challenge.mode === "setup") {
      setTotpSecret(user.id, challenge.setupSecret, true);
      user.totpEnabled = true;
      logAudit({ type: "security", action: "2fa_enabled", user: user.email, detail: user.role });
    }
    revokeUser2faChallenges(user.id);
    logAudit({ type: "auth", action: "login_success_2fa", user: user.email, detail: user.role });
    res.json(completeSession(user, req));
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

async function handleMagicLinkRequest(req, res) {
  const v = validateBody(SCHEMAS.passwordResetRequest, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  try { res.json(await requestMagicLogin(v.data.email)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
}

router.post("/email/request", authRateLimit, handleMagicLinkRequest);
router.post("/request-magic-link", authRateLimit, handleMagicLinkRequest);

router.post("/email/confirm", authRateLimit, (req, res) => {
  try {
    const user = consumeMagicLogin(String(req.body?.token || ""));
    logAudit({ type: "auth", action: "email_link_validated", user: user.email, detail: user.role });
    if (REQUIRE_ADMIN_2FA) return res.json(beginAdmin2fa(user, req, "magic_link"));
    res.json(completeSession(user, req));
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
  try { res.json(await requestPasswordReset(v.data.email)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.post("/password/confirm", authRateLimit, (req, res) => {
  const v = validateBody(SCHEMAS.passwordResetConfirm, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  try { confirmPasswordReset(v.data.token, v.data.password); res.json({ ok: true, message: "Mot de passe mis a jour." }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.post("/2fa/setup", (req, res) => {
  if (ADMIN_CODE_LOGIN_TEMP_DISABLED) return rejectTemporaryCodeLogin(res);
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user || !ADMIN_ROLES.includes(user.role)) return res.status(401).json({ ok: false, error: "Session Admin requise." });
  const secret = generateTotpSecret();
  setTotpSecret(user.id, secret, false);
  res.json({ ok: true, secret, uri: getTotpUri(secret, user.email), enabled: false });
});

router.post("/2fa/enable", (req, res) => {
  if (ADMIN_CODE_LOGIN_TEMP_DISABLED) return rejectTemporaryCodeLogin(res);
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user || !ADMIN_ROLES.includes(user.role)) return res.status(401).json({ ok: false, error: "Session Admin requise." });
  const totp = getTotpSecret(user.id);
  if (!totp?.secret || !verifyTotp(totp.secret, req.body?.totpCode)) return res.status(400).json({ ok: false, error: "Code 2FA invalide." });
  setTotpSecret(user.id, totp.secret, true);
  logAudit({ type: "security", action: "2fa_enabled", user: user.email, detail: "session_rotation" });
  res.json({ ok: true, enabled: true });
});

export default router;
