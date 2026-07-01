/**
 * API publique Scanner Intelligent Cardoria.
 */
import { Router } from "express";
import { scanCardIntelligent } from "../lib/scanner/analyze.js";
import { validateBody } from "../lib/security/validate.js";

const router = Router();

router.get("/", (req, res) => {
  res.json({ ok: true, service: "Cardoria Scanner", version: "1.0" });
});

router.post("/scan", async (req, res) => {
  const body = req.body || {};
  const v = validateBody({
    customerName: { type: "string", maxLength: 120 },
    customerEmail: { type: "email" },
    cardName: { type: "string", maxLength: 200 },
    cardGame: { type: "string", maxLength: 80 },
    cardId: { type: "string", maxLength: 180 },
    notes: { type: "string", maxLength: 2000 },
    deviceInfo: { type: "string", maxLength: 200 }
  }, body);

  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });

  const hasImage = body.rectoBase64 || body.versoBase64 ||
    (body.imagesBase64 && body.imagesBase64.length) ||
    (body.extraImages && body.extraImages.length);

  if (!hasImage) {
    return res.status(400).json({ ok: false, error: "Photo requise (recto, verso ou import)." });
  }

  try {
    const result = await scanCardIntelligent({ ...body, ...v.data });
    res.json(result);
  } catch (e) {
    console.error("[Scanner]", e);
    res.status(500).json({ ok: false, error: e.message || "Erreur scan" });
  }
});

export default router;
