/**
 * Administration Cardoria Ultimate Enterprise.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  getUltimateDashboard,
  getUltimateStatsSummary,
  getTopNaturalSearches,
  getRecentExceptionalAlerts,
  getExceptionalAlertsForCard,
  runUltimateWorker,
  getUltimateWorkerStatus,
  getScaleMeta,
  recordExceptionalAlerts
} from "../lib/ultimate/index.js";

const router = Router();
router.use(requireAdmin);

router.get("/dashboard", (req, res) => {
  res.json({
    ok: true,
    dashboard: getUltimateDashboard({ refresh: req.query.refresh === "1" }),
    summary: getUltimateStatsSummary(),
    worker: getUltimateWorkerStatus(),
    scale: getScaleMeta()
  });
});

router.get("/searches/top", (req, res) => {
  res.json({ ok: true, searches: getTopNaturalSearches(Number(req.query.limit) || 20) });
});

router.get("/exceptional", (req, res) => {
  const cardId = req.query.cardId;
  res.json({
    ok: true,
    alerts: cardId ? getExceptionalAlertsForCard(cardId) : getRecentExceptionalAlerts(Number(req.query.limit) || 50)
  });
});

router.post("/exceptional/scan", (req, res) => {
  const body = req.body || {};
  const result = recordExceptionalAlerts({
    cardId: body.cardId,
    analysisId: body.analysisId,
    detection: body.detection,
    cardNotes: body.notes
  });
  logAudit({ type: "ultimate", action: "exceptional_scan", user: "admin", detail: String(result.created) });
  res.json({ ok: true, ...result });
});

router.post("/worker/run", (req, res) => {
  runUltimateWorker("admin_manual").then((result) => {
    logAudit({ type: "ultimate", action: "worker_run", user: "admin" });
    res.json({ ok: true, result, worker: getUltimateWorkerStatus() });
  }).catch((e) => res.status(500).json({ ok: false, error: e.message }));
});

export default router;
