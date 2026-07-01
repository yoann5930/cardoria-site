/**
 * Administration Big Data Cardoria.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  buildAdminDashboardPayload,
  getBigDataRecordCount,
  runBigDataWorker,
  getBigDataWorkerStatus,
  runFullIngestSync,
  computePriceEvolution,
  computeBigDataTrends,
  computeHeatmap,
  computeAiStats,
  refreshAllCardMetrics,
  invalidateCache,
  getHeatmap,
  getBigDataTrends,
  getAiStats,
  getGlobalIndicesSummary
} from "../lib/bigdata/index.js";

const router = Router();
router.use(requireAdmin);

router.get("/dashboard", (req, res) => {
  res.json({
    ok: true,
    dashboard: buildAdminDashboardPayload({ refresh: req.query.refresh === "1" }),
    records: getBigDataRecordCount(),
    worker: getBigDataWorkerStatus()
  });
});

router.get("/heatmap", (req, res) => {
  res.json({ ok: true, heatmap: getHeatmap() });
});

router.get("/trends", (req, res) => {
  res.json({ ok: true, trends: getBigDataTrends({ limit: Number(req.query.limit) || 50 }) });
});

router.get("/ai-stats", (req, res) => {
  res.json({ ok: true, stats: getAiStats(true), indices: getGlobalIndicesSummary() });
});

router.post("/sync", (req, res) => {
  const result = runFullIngestSync();
  logAudit({ type: "bigdata", action: "sync", user: "admin", detail: JSON.stringify(result) });
  res.json({ ok: true, ...result });
});

router.post("/worker/run", (req, res) => {
  runBigDataWorker("admin_manual").then((result) => {
    logAudit({ type: "bigdata", action: "worker_run", user: "admin" });
    res.json({ ok: true, result, worker: getBigDataWorkerStatus() });
  }).catch((e) => res.status(500).json({ ok: false, error: e.message }));
});

router.post("/recompute/all", (req, res) => {
  invalidateCache("");
  runFullIngestSync();
  refreshAllCardMetrics(500);
  computePriceEvolution({ days: 730 });
  computeBigDataTrends();
  computeHeatmap();
  const stats = computeAiStats();
  logAudit({ type: "bigdata", action: "recompute_all", user: "admin" });
  res.json({ ok: true, stats });
});

export default router;
