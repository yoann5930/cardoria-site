/**
 * Santé application — public + admin détaillé.
 */
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { getPublicHealth, getHealthReport } from "../lib/monitoring/health.js";
import { getRecentErrors } from "../lib/monitoring/errors.js";
import { listBackups, createFullBackup, restoreBackup } from "../lib/backup/full.js";
import { cleanExpiredSessions } from "../lib/auth/session.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(getPublicHealth());
});

router.get("/full", requireAuth({ action: "health" }), (req, res) => {
  cleanExpiredSessions();
  res.json({ ok: true, health: getHealthReport(), errors: getRecentErrors(30) });
});

router.get("/backups", requireAuth({ action: "backup" }), (req, res) => {
  res.json({ ok: true, backups: listBackups() });
});

router.post("/backups", requireAuth({ action: "backup" }), (req, res) => {
  const backup = createFullBackup({ label: req.body?.label || "manual" });
  logAudit({ type: "backup", action: "create_full", user: req.authUser?.email || "admin", detail: backup.id });
  res.json({ ok: true, backup });
});

router.post("/backups/:id/restore", requireAuth({ roles: ["super_admin"], action: "restore" }), (req, res) => {
  try {
    const result = restoreBackup(req.params.id, { dryRun: req.body?.dryRun === true });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;
