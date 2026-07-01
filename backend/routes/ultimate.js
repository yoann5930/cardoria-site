/**
 * API publique Cardoria Ultimate Enterprise.
 */
import { Router } from "express";
import {
  getUltimateClientByCardId,
  buildUltimateClientView,
  getPriceComparison,
  getInvestmentAdvice,
  getUltimateHistory,
  getAllUltimateHistories,
  searchNaturalLanguage,
  detectExceptionalTraits,
  buildClientExceptionalAlert,
  PERIODS
} from "../lib/ultimate/index.js";
import { getCardById } from "../lib/engine/cards.js";

const router = Router();

router.get("/card/:cardId", (req, res) => {
  try {
    const card = getCardById(req.params.cardId);
    if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable." });
    res.json({ ok: true, ultimate: getUltimateClientByCardId(req.params.cardId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/card/:cardId/prices", (req, res) => {
  try {
    res.json({ ok: true, comparison: getPriceComparison(req.params.cardId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/card/:cardId/advice", (req, res) => {
  try {
    res.json({ ok: true, advice: getInvestmentAdvice(req.params.cardId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/card/:cardId/history", (req, res) => {
  try {
    const period = req.query.period || "30";
    if (req.query.all === "1") {
      return res.json({ ok: true, histories: getAllUltimateHistories(req.params.cardId) });
    }
    if (!PERIODS[period] && period !== "max") {
      return res.status(400).json({ ok: false, error: "Période invalide." });
    }
    res.json({ ok: true, history: getUltimateHistory(req.params.cardId, period) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/search", (req, res) => {
  try {
    const q = req.query.q || "";
    if (q.length < 2) return res.status(400).json({ ok: false, error: "Requête trop courte." });
    res.json(searchNaturalLanguage(q, {
      page: Number(req.query.page) || 1,
      limit: Math.min(Number(req.query.limit) || 24, 50)
    }));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/detect-exceptional", (req, res) => {
  try {
    const body = req.body || {};
    const traits = detectExceptionalTraits({
      cardId: body.cardId,
      detection: body.detection,
      cardNotes: body.notes
    });
    res.json({
      ok: true,
      alert: buildClientExceptionalAlert(traits),
      traits
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/preview", (req, res) => {
  try {
    const body = req.body || {};
    res.json({
      ok: true,
      ultimate: buildUltimateClientView(body.cardId, {
        detection: body.detection,
        cardNotes: body.notes
      })
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
