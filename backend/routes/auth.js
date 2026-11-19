/**
 * Authentification Cardiashop — comptes clients/admin, sessions et 2FA facultatif.
 */
import { Router } from "express";
import { getDb as getDbForPokedex } from "../lib/engine/database.js";
import { getUserById, getUserByEmail, createUser, authenticateUser, setTotpSecret, getTotpSecret, updateClientProfile, ADMIN_ROLES } from "../lib/auth/users.js";
import { migrateAuth } from "../lib/auth/migrate.js";
import { createSession, revokeSession, validateSession } from "../lib/auth/session.js";
import { generateTotpSecret, verifyTotp, getTotpUri } from "../lib/auth/totp.js";
import { create2faChallenge, get2faChallenge, record2faFailure, consume2faChallenge, revokeUser2faChallenges } from "../lib/auth/2faChallenge.js";
import { requestPasswordReset, confirmPasswordReset } from "../lib/auth/passwordReset.js";
import { requestMagicLogin, consumeMagicLogin } from "../lib/auth/magicLink.js";
import { notifySafely, publicSiteOrigin, sendEmail } from "../lib/email.js";
import { validateBody, SCHEMAS } from "../lib/security/validate.js";
import { authRateLimit, passwordResetRateLimit, passwordResetConfirmRateLimit } from "../lib/security/rateLimit.js";
import { generateCsrfToken } from "../lib/security/csrf.js";
import { logAudit } from "../lib/audit.js";
import { readJson } from "../lib/storage.js";
import { resolveFrenchPostalCity } from "../lib/france-communes.js";
import { publicClientOrder as formatPublicClientOrder } from "../lib/boutique/shipping.js";
import { registerSeller } from "../lib/marketplace/sellers.js";
import { verifyFrenchProfessionalSiret } from "../lib/marketplace/professional-verification.js";

const router = Router();
const ADMIN_CODE_LOGIN_TEMP_DISABLED = true;
const CLIENT_SESSION_HOURS = Math.max(24, Math.min(24 * 365, Number(process.env.CLIENT_SESSION_DAYS || 30) * 24));
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
  return {
    id: user.id, email: user.email, role: user.role, name: user.name, totpEnabled: !!user.totpEnabled,
    firstName: user.firstName || "", lastName: user.lastName || "", phone: user.phone || "", accountType: user.accountType === "professional" ? "professional" : "individual",
    addressLine1: user.addressLine1 || "", addressLine2: user.addressLine2 || "",
    postalCode: user.postalCode || "", city: user.city || "", country: user.country || "FR",
    shippingPreference: user.shippingPreference || "mondial_relay",
    relay: user.relay || null, profileReady: !!user.profileReady, relayReady: !!user.relayReady
  };
}

function publicClientOrder(order) {
  return formatPublicClientOrder(order);
}

function rejectTemporaryCodeLogin(res) {
  return res.status(503).json({ ok: false, error: "Connexion par code temporairement désactivée." });
}

function completeSession(user, req) {
  const session = createSession(user.id, { ip: req.ip, userAgent: req.headers["user-agent"], ttlHours: user.role === "client" ? CLIENT_SESSION_HOURS : undefined });
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUser(user),
    csrfToken: generateCsrfToken(user.id)
  };
}

function beginAdmin2fa(user, req, origin = "password") {
  if (ADMIN_CODE_LOGIN_TEMP_DISABLED && !REQUIRE_ADMIN_2FA) return null;
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

router.post("/register", authRateLimit, async (req, res) => {
  try {
    const email = normalizedEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const accountType = req.body?.accountType === "professional" ? "professional" : "individual";
    const siret = String(req.body?.siret || "").replace(/\D/g, "");

    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: "Email invalide." });
    if (!validPassword(password)) return res.status(400).json({ ok: false, error: "Mot de passe: 10 caracteres minimum avec lettres et chiffres." });
    if (getUserByEmail(email)) return res.status(409).json({ ok: false, error: "Un compte existe deja pour cet email." });

    let professionalVerification = null;
    if (accountType === "professional") {
      if (!/^\d{14}$/.test(siret)) return res.status(400).json({ ok: false, error: "SIRET professionnel invalide : 14 chiffres requis." });
      professionalVerification = await verifyFrenchProfessionalSiret(siret);
    }

    const user = createUser({ email, password, role: "client", name, accountType });
    if (accountType === "professional") {
      registerSeller({
        email: user.email,
        authUserId: user.id,
        displayName: name || user.email.split("@")[0],
        sellerType: "professional",
        professionalVerification
      });
    }

    const session = createSession(user.id, { ip: req.ip, userAgent: req.headers["user-agent"], ttlHours: CLIENT_SESSION_HOURS });
    logAudit({ type: "auth", action: "client_register", user: email, detail: accountType === "professional" ? "professional_live" : "individual_marketplace" });
    notifySafely(sendEmail({
      kind: "welcome",
      to: email,
      subject: "Bienvenue chez Cardiashop",
      text: accountType === "professional"
        ? `Bonjour${name ? ` ${name}` : ""},\n\nVotre compte professionnel Cardiashop est créé et lié à votre profil Liveur.\nVotre SIRET a été enregistré pour l’accès au Studio Live.`
        : `Bonjour${name ? ` ${name}` : ""},\n\nVotre compte particulier Cardiashop est créé.\nLa Boutique et la Marketplace sont accessibles avec ce compte.`,
      actionUrl: `${publicSiteOrigin()}/client-login.html`,
      actionLabel: "Accéder à mon espace"
    }), "welcome");
    res.status(201).json({ ok: true, token: session.token, expiresAt: session.expiresAt, user: publicUser(user), accountType });
  } catch (e) {
    res.status(e.status || e.code || 400).json({ ok: false, error: e.message });
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
      const challenge = beginAdmin2fa(user, req, "password");
      if (challenge) return res.json(challenge);
    }
    res.json(completeSession(user, req));
  } catch (e) {
    console.warn(`[auth] login_failed status=${e.status || 500} reason=${e.message || "unknown"}`);
    logAudit({ type: "auth", action: "login_failed", user: normalizedEmail(req.body?.email) || req.ip || "unknown", detail: e.message });
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/2fa/login/verify", authRateLimit, (req, res) => {
  if (ADMIN_CODE_LOGIN_TEMP_DISABLED && !REQUIRE_ADMIN_2FA) return rejectTemporaryCodeLogin(res);
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
    if (REQUIRE_ADMIN_2FA) {
      const challenge = beginAdmin2fa(user, req, "magic_link");
      if (challenge) return res.json(challenge);
    }
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
  const sessionUser = validateSession(token);
  if (!sessionUser) return res.status(401).json({ ok: false, error: "Session expiree." });
  const user = getUserById(sessionUser.id) || sessionUser;
  res.json({ ok: true, user: publicUser(user) });
});

router.patch("/profile", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
    const sessionUser = validateSession(token);
    if (!sessionUser) return res.status(401).json({ ok: false, error: "Session expiree." });
    if (sessionUser.role !== "client") return res.status(403).json({ ok: false, error: "Compte client requis." });

    const patch = { ...(req.body || {}) };
    const current = getUserById(sessionUser.id);
    const country = String(patch.country == null ? current?.country || "FR" : patch.country || "FR").trim().toUpperCase();
    const postalCode = String(patch.postalCode == null ? current?.postalCode || "" : patch.postalCode || "").trim();
    const city = String(patch.city == null ? current?.city || "" : patch.city || "").trim();
    if (country === "FR" && (postalCode || city)) {
      const resolved = await resolveFrenchPostalCity(postalCode, city);
      patch.postalCode = resolved.postalCode;
      patch.city = resolved.city;
      patch.country = "FR";
    }

    const user = updateClientProfile(sessionUser.id, patch);
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, code: e.code || "", error: e.message });
  }
});

router.get("/orders", (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user) return res.status(401).json({ ok: false, error: "Session expiree." });
  if (user.role !== "client") return res.status(403).json({ ok: false, error: "Compte client requis." });

  const email = normalizedEmail(user.email);
  const orders = readJson("orders", [])
    .filter((order) => String(order?.userId || "") === String(user.id) || normalizedEmail(order?.email) === email)
    .sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")))
    .map(publicClientOrder);

  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, orders });
});

router.post("/password/request", passwordResetRateLimit, async (req, res) => {
  const v = validateBody(SCHEMAS.passwordResetRequest, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  try { res.json(await requestPasswordReset(v.data.email)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.post("/password/confirm", passwordResetConfirmRateLimit, (req, res) => {
  const v = validateBody(SCHEMAS.passwordResetConfirm, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  try { confirmPasswordReset(v.data.token, v.data.password); res.json({ ok: true, message: "Mot de passe mis a jour." }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.post("/2fa/setup", (req, res) => {
  if (ADMIN_CODE_LOGIN_TEMP_DISABLED && !REQUIRE_ADMIN_2FA) return rejectTemporaryCodeLogin(res);
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user || !ADMIN_ROLES.includes(user.role)) return res.status(401).json({ ok: false, error: "Session Admin requise." });
  const secret = generateTotpSecret();
  setTotpSecret(user.id, secret, false);
  res.json({ ok: true, secret, uri: getTotpUri(secret, user.email), enabled: false });
});

router.post("/2fa/enable", (req, res) => {
  if (ADMIN_CODE_LOGIN_TEMP_DISABLED && !REQUIRE_ADMIN_2FA) return rejectTemporaryCodeLogin(res);
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user || !ADMIN_ROLES.includes(user.role)) return res.status(401).json({ ok: false, error: "Session Admin requise." });
  const totp = getTotpSecret(user.id);
  if (!totp?.secret || !verifyTotp(totp.secret, req.body?.totpCode)) return res.status(400).json({ ok: false, error: "Code 2FA invalide." });
  setTotpSecret(user.id, totp.secret, true);
  logAudit({ type: "security", action: "2fa_enabled", user: user.email, detail: "session_rotation" });
  res.json({ ok: true, enabled: true });
});


/* Pokédex personnel — isolé par utilisateur authentifié. */
function requirePokedexClient(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
  const user = validateSession(token);
  if (!user) return res.status(401).json({ ok: false, error: "Connectez-vous pour utiliser votre Pokédex." });
  if (user.role !== "client") return res.status(403).json({ ok: false, error: "Un compte client est requis." });
  req.pokedexUserId = user.id;
  next();
}

function pokedexDb() {
  const db = getDbForPokedex();
  db.exec(`CREATE TABLE IF NOT EXISTS client_pokedex (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 999),
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,card_id),
    FOREIGN KEY(user_id) REFERENCES auth_users(id) ON DELETE CASCADE
  );`);
  return db;
}

router.get("/pokedex", requirePokedexClient, (req, res) => {
  try {
    const db = pokedexDb();
    const cards = db.prepare(`SELECT p.card_id AS id, p.quantity, p.added_at AS addedAt,
      c.name, c.language, c.extension, c.extension_code AS extensionCode, c.number,
      c.rarity, c.image_thumb AS imageThumb, c.image_hd AS imageHd, c.license_slug AS license
      FROM client_pokedex p LEFT JOIN cards c ON c.id=p.card_id
      WHERE p.user_id=? ORDER BY p.updated_at DESC LIMIT 5000`).all(req.pokedexUserId);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, cards, totalUnique: cards.length, totalCopies: cards.reduce((n,c)=>n+c.quantity,0) });
  } catch (e) { return res.status(500).json({ ok:false,error:"Impossible de charger le Pokédex." }); }
});

router.put("/pokedex/:cardId", requirePokedexClient, (req, res) => {
  try {
    const cardId=String(req.params.cardId||"").trim();
    const quantity=Number(req.body?.quantity);
    if (!/^[a-zA-Z0-9_:\-.]{1,140}$/.test(cardId) || !Number.isInteger(quantity) || quantity<0 || quantity>999) {
      return res.status(400).json({ok:false,error:"Carte ou quantité invalide (0 à 999)."});
    }
    const db=pokedexDb();
    const card=db.prepare("SELECT id FROM cards WHERE id=? AND license_slug='pokemon' AND active=1").get(cardId);
    if (!card) return res.status(404).json({ok:false,error:"Cette carte Pokémon n'existe pas dans le catalogue."});
    if (quantity===0) db.prepare("DELETE FROM client_pokedex WHERE user_id=? AND card_id=?").run(req.pokedexUserId,cardId);
    else {
      const now=new Date().toISOString();
      db.prepare(`INSERT INTO client_pokedex (user_id,card_id,quantity,added_at,updated_at)
       VALUES (?,?,?,?,?) ON CONFLICT(user_id,card_id)
       DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`).run(req.pokedexUserId,cardId,quantity,now,now);
    }
    res.setHeader("Cache-Control","no-store");
    return res.json({ok:true,cardId,quantity});
  } catch (e) { return res.status(500).json({ok:false,error:"Impossible d'enregistrer cette carte."}); }
});

export default router;
