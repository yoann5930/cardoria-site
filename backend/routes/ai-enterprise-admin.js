/**
 * Administration IA Enterprise auto-apprenante.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  getEnterpriseDashboard,
  getEnterpriseStatsSummary,
  listEnterpriseHistory,
  getReliability,
  computeReliabilityForCard,
  getPredictions,
  getTrendSignals,
  getCardoriaTrendIndex,
  runEnterpriseWorker,
  getWorkerStatus,
  refreshAllReliabilityScores,
  refreshAllPredictions,
  detectTrendSignals
} from "../lib/ai-enterprise/index.js";
import { getCardById } from "../lib/engine/cards.js";

const router = Router();
router.use(requireAdmin);

router.get("/dashboard", (req, res) => {
  const refresh = req.query.refresh === "1";
  res.json({
    ok: true,
    dashboard: getEnterpriseDashboard({ refresh }),
    summary: getEnterpriseStatsSummary(),
    worker: getWorkerStatus()
  });
});

router.get("/history", (req, res) => {
  res.json({
    ok: true,
    history: listEnterpriseHistory({
      cardId: req.query.cardId,
      license: req.query.license,
      limit: Number(req.query.limit) || 100
    })
  });
});

router.get("/reliability/:entityKey", (req, res) => {
  const key = req.params.entityKey;
  let result = getReliability(key);
  if (!result && getCardById(key)) {
    result = computeReliabilityForCard(key);
  }
  if (!result) return res.status(404).json({ ok: false, error: "Fiabilité introuvable." });
  res.json({ ok: true, reliability: result });
});

router.get("/predictions/:cardId", (req, res) => {
  const card = getCardById(req.params.cardId);
  if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable." });
  res.json({ ok: true, predictions: getPredictions(req.params.cardId) });
});

router.get("/trends", (req, res) => {
  res.json({
    ok: true,
    cardoriaTrendIndex: getCardoriaTrendIndex(),
    signals: getTrendSignals({ type: req.query.type, limit: Number(req.query.limit) || 40 })
  });
});

router.post("/worker/run", (req, res) => {
  runEnterpriseWorker("admin_manual").then((result) => {
    logAudit({ type: "ai_enterprise", action: "worker_run", user: "admin", detail: result.at || "ok" });
    res.json({ ok: true, result, worker: getWorkerStatus() });
  }).catch((e) => {
    res.status(500).json({ ok: false, error: e.message });
  });
});

router.post("/refresh/reliability", (req, res) => {
  refreshAllReliabilityScores(Number(req.body?.limit) || 500);
  logAudit({ type: "ai_enterprise", action: "refresh_reliability", user: "admin" });
  res.json({ ok: true });
});

router.post("/refresh/predictions", (req, res) => {
  const list = refreshAllPredictions(Number(req.body?.limit) || 300);
  logAudit({ type: "ai_enterprise", action: "refresh_predictions", user: "admin", detail: String(list.length) });
  res.json({ ok: true, count: list.length });
});

router.post("/refresh/trends", (req, res) => {
  const result = detectTrendSignals(Number(req.body?.limit) || 200);
  logAudit({ type: "ai_enterprise", action: "refresh_trends", user: "admin" });
  res.json({ ok: true, ...result });
});

export default router;
