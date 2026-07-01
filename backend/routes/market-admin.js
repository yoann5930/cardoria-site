/**
 * Administration moteur de données marché Cardoria.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  getCardMarketStats,
  recomputeCardStats,
  recomputeAllCardStats,
  getMarketDashboard,
  listRecentTransactions
} from "../lib/market/stats.js";
import { ingestAdminManualSale } from "../lib/market/ingest.js";
import { getCardById, searchCards } from "../lib/engine/cards.js";

const router = Router();
router.use(requireAdmin);

router.get("/dashboard", (req, res) => {
  res.json({ ok: true, dashboard: getMarketDashboard() });
});

router.get("/transactions", (req, res) => {
  res.json({
    ok: true,
    transactions: listRecentTransactions({
      cardId: req.query.cardId,
      limit: Number(req.query.limit) || 50
    })
  });
});

router.get("/stats/:cardId", (req, res) => {
  const stats = getCardMarketStats(req.params.cardId);
  if (!stats) return res.status(404).json({ ok: false, error: "Aucune statistique pour cette carte." });
  const transactions = listRecentTransactions({ cardId: req.params.cardId, limit: 30 });
  res.json({ ok: true, stats, transactions, card: getCardById(req.params.cardId) });
});

router.post("/transactions", (req, res) => {
  const body = req.body || {};
  if (!body.cardId) return res.status(400).json({ ok: false, error: "cardId requis." });
  if (!getCardById(body.cardId)) return res.status(404).json({ ok: false, error: "Carte introuvable." });
  try {
    const tx = ingestAdminManualSale(body.cardId, body);
    logAudit({ type: "market", action: "transaction_add", user: "admin", detail: tx.id });
    res.json({ ok: true, transaction: tx, stats: getCardMarketStats(body.cardId) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/recompute/:cardId", (req, res) => {
  const stats = recomputeCardStats(req.params.cardId);
  if (!stats) return res.status(404).json({ ok: false, error: "Carte introuvable." });
  logAudit({ type: "market", action: "recompute", user: "admin", detail: req.params.cardId });
  res.json({ ok: true, stats });
});

router.post("/recompute-all", (req, res) => {
  const result = recomputeAllCardStats(Number(req.body?.limit) || 5000);
  logAudit({ type: "market", action: "recompute_all", user: "admin", detail: String(result.recomputed) });
  res.json({ ok: true, ...result });
});

router.get("/search", (req, res) => {
  res.json({ ok: true, ...searchCards({ q: req.query.q, limit: req.query.limit || 12 }) });
});

export default router;
