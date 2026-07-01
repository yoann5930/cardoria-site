/**
 * API publique IA Premium Cardoria.
 */
import { Router } from "express";
import { analyzeCardPremium, getPriceHistory, getTrends, buildIntelligenceForCard, toClientIntelligence } from "../lib/ai/analyze.js";

const router = Router();

router.post("/analyze", async (req, res) => {
  try {
    const result = await analyzeCardPremium(req.body || {});
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || "Erreur analyse IA" });
  }
});

router.get("/history/:cardId", (req, res) => {
  const history = getPriceHistory(req.params.cardId, req.query.period || "30");
  res.json({ ok: true, history });
});

router.get("/trends", (req, res) => {
  res.json({
    ok: true,
    trends: getTrends({ direction: req.query.direction, limit: req.query.limit })
  });
});

router.get("/intelligence/:cardId", (req, res) => {
  try {
    const intelligence = buildIntelligenceForCard(req.params.cardId, req.query.condition || "Near Mint");
    if (!intelligence) return res.status(404).json({ ok: false, error: "Carte introuvable." });
    const admin = req.query.admin === "1" && req.headers.authorization;
    if (admin) {
      return res.json({ ok: true, intelligence });
    }
    res.json({ ok: true, intelligence: toClientIntelligence(intelligence) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
