import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { ALERT_EMAIL, isSmtpConfigured, smtpMissingReason, sendEmail } from "../lib/email.js";

const router = Router();
router.use(requireAdmin);

router.get("/test", async (req, res) => {
  if (!isSmtpConfigured()) {
    return res.status(503).json({ ok: false, configured: false, error: smtpMissingReason() || "SMTP non configure." });
  }

  const sent = await sendEmail({
    to: ALERT_EMAIL,
    subject: "Cardoria - Test e-mail administrateur",
    text: "Test de configuration e-mail Cardoria."
  });

  if (!sent) return res.status(502).json({ ok: false, configured: true, error: "SMTP configure mais envoi impossible." });
  return res.json({ ok: true, configured: true, sent: true });
});

export default router;
