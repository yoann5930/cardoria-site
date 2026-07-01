/**
 * API système V1.0 — admin-system.html
 */
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { createFullBackup, listBackups } from "../lib/backup/full.js";
import { getRecentErrors } from "../lib/monitoring/errors.js";
import {
  getSystemReport, getVersionInfo, runServerAudit,
  setMaintenanceMode, getMaintenanceInfo,
  rotateBackups, readJournal, getJournalStats, checkAndAlert
} from "../lib/launch/index.js";

const router = Router();

router.get("/status", (req, res) => {
  const m = getMaintenanceInfo();
  res.json({
    ok: !m.active,
    maintenance: m.active,
    message: m.message || "",
    version: getVersionInfo().version
  });
});

router.use(requireAuth({ action: "health" }));

router.get("/full", async (req, res) => {
  const report = await getSystemReport();
  res.json({ ok: true, report });
});

router.get("/version", (req, res) => {
  res.json({ ok: true, ...getVersionInfo() });
});

router.get("/audit", (req, res) => {
  res.json({ ok: true, audit: runServerAudit() });
});

router.get("/journals", (req, res) => {
  const type = req.query.type || "connections";
  const limit = Number(req.query.limit) || 50;
  res.json({
    ok: true,
    stats: getJournalStats(),
    entries: readJournal(type, limit)
  });
});

router.get("/backups", (req, res) => {
  res.json({ ok: true, backups: listBackups() });
});

router.post("/backups", requireAuth({ action: "backup" }), (req, res) => {
  const backup = createFullBackup({ label: req.body?.label || "admin-system" });
  rotateBackups();
  logAudit({ type: "backup", action: "create", user: req.authUser?.email || "admin", detail: backup.id });
  res.json({ ok: true, backup });
});

router.post("/backups/rotate", requireAuth({ action: "backup" }), (req, res) => {
  const result = rotateBackups(Number(req.body?.maxKeep) || undefined);
  res.json({ ok: true, ...result });
});

router.put("/maintenance", requireAuth({ roles: ["super_admin"], action: "security" }), (req, res) => {
  const active = req.body?.active === true;
  const info = setMaintenanceMode(active, {
    message: req.body?.message || "Maintenance planifiée Cardoria",
    by: req.authUser?.email || "admin"
  });
  res.json({ ok: true, maintenance: info });
});

router.post("/alerts/check", requireAuth({ action: "health" }), async (req, res) => {
  const result = await checkAndAlert();
  res.json({ ok: true, ...result });
});

router.post("/restart", requireAuth({ roles: ["super_admin"], action: "security" }), (req, res) => {
  logAudit({ type: "system", action: "restart_requested", user: req.authUser?.email || "admin", detail: "Graceful restart" });
  res.json({ ok: true, message: "Redémarrage programmé — Render relancera le service." });
  setTimeout(() => process.exit(0), 500);
});

router.get("/errors", (req, res) => {
  res.json({ ok: true, errors: getRecentErrors(Number(req.query.limit) || 50) });
});

export default router;
