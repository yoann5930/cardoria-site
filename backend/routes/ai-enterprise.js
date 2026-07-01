/**
 * API client IA Enterprise — données publiques uniquement.
 */
import { Router } from "express";
import { getEnterpriseClientByCardId, buildEnterpriseClientView } from "../lib/ai-enterprise/index.js";

const router = Router();

router.get("/client/:cardId", (req, res) => {
  try {
    const view = getEnterpriseClientByCardId(req.params.cardId);
    res.json({ ok: true, enterprise: view });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/preview", (req, res) => {
  try {
    const body = req.body || {};
    const view = buildEnterpriseClientView({
      cardId: body.cardId,
      intelligence: body.intelligence,
      pricing: body.pricing,
      detection: body.detection
    });
    res.json({ ok: true, enterprise: view });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
