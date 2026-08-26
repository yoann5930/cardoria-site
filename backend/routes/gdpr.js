/**
 * Routes RGPD Cardoria.
 * Export/suppression ne peuvent viser que le compte de la session authentifiee.
 */
import { Router } from "express";
import { recordConsent, exportPersonalData, deletePersonalData } from "../lib/gdpr.js";
import { apiRateLimit } from "../lib/security/rateLimit.js";
import { validateSession } from "../lib/auth/session.js";

const router = Router();

function requireUser(req, res) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || String(req.headers["x-session-token"] || "");
  const user = validateSession(token);
  if (!user) {
    res.status(401).json({ ok: false, error: "Connexion Cardoria requise." });
    return null;
  }
  return user;
}

router.post("/consent", apiRateLimit, (req, res) => {
  const body = req.body || {};
  const result = recordConsent({
    visitorId: body.visitorId,
    email: body.email,
    analytics: body.analytics === true,
    marketing: body.marketing === true,
    preferences: body.preferences || {},
    ip: req.ip || ""
  });
  res.json({ ok: true, ...result });
});

router.post("/export", apiRateLimit, (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ ok: true, data: exportPersonalData(user.email) });
});

router.post("/delete", apiRateLimit, (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (String(req.body?.confirm || "") !== "SUPPRIMER") return res.status(400).json({ ok: false, error: "Confirmation SUPPRIMER requise." });
  try {
    const result = deletePersonalData(user.email, { confirmPhrase: "SUPPRIMER" });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

export default router;
