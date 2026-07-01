/**
 * Routes RGPD publiques.
 */
import { Router } from "express";
import { recordConsent, exportPersonalData, deletePersonalData } from "../lib/gdpr.js";
import { validateBody, SCHEMAS } from "../lib/security/validate.js";
import { apiRateLimit } from "../lib/security/rateLimit.js";

const router = Router();

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
  const v = validateBody(SCHEMAS.gdprExport, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  res.json({ ok: true, data: exportPersonalData(v.data.email) });
});

router.post("/delete", apiRateLimit, (req, res) => {
  const v = validateBody({
    ...SCHEMAS.gdprDelete,
    confirm: { type: "string", required: true, minLength: 6, maxLength: 32, allowNewlines: false }
  }, req.body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  try {
    const result = deletePersonalData(v.data.email, { confirmPhrase: v.data.confirm });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

export default router;
