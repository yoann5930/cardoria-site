/**
 * API système Cardoria — santé, sauvegardes durables, restauration et erreurs.
 */
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { createFullBackup, listBackups, restoreBackup } from "../lib/backup/full.js";
import {
  durableBackupConfigured,
  createDurableBackup,
  listDurableBackups,
  restoreDurableBackup,
  rotateDurableBackups
} from "../lib/backup/durable.js";
import { getRecentErrors, getErrorStats } from "../lib/monitoring/errors.js";
import {
  getSystemReport, getVersionInfo, runServerAudit,
  setMaintenanceMode, getMaintenanceInfo,
  rotateBackups, readJournal, getJournalStats, checkAndAlert
} from "../lib/launch/index.js";

const router = Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function restoreConfirmation(id) {
  return `RESTORE ${id}`;
}

function redactText(value, max = 600) {
  return String(value || "")
    .replace(/(authorization|password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[REDACTED]")
    .slice(0, max);
}

function safeError(entry) {
  return {
    id: String(entry?.id || ""),
    at: String(entry?.at || ""),
    severity: ["error", "critical", "warning"].includes(entry?.severity) ? entry.severity : "error",
    route: redactText(entry?.route, 240),
    message: redactText(entry?.message, 600),
    source: "application"
  };
}

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

router.get("/full", asyncRoute(async (req, res) => {
  const report = await getSystemReport();
  res.json({ ok: true, report });
}));

router.get("/version", (req, res) => {
  res.json({ ok: true, ...getVersionInfo() });
});

router.get("/audit", (req, res) => {
  res.json({ ok: true, audit: runServerAudit() });
});

router.get("/journals", (req, res) => {
  const type = req.query.type || "connections";
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  res.json({
    ok: true,
    stats: getJournalStats(),
    entries: readJournal(type, limit)
  });
});

router.get("/backups", asyncRoute(async (req, res) => {
  const durable = durableBackupConfigured();
  const backups = durable ? await listDurableBackups(50) : listBackups();
  res.json({
    ok: true,
    durable,
    storage: durable ? "postgresql" : "local-ephemeral",
    warning: durable ? "" : "Stockage local non durable: les sauvegardes peuvent disparaitre au redeploiement.",
    backups
  });
}));

router.post("/backups", requireAuth({ action: "backup" }), asyncRoute(async (req, res) => {
  const actor = req.authUser?.email || "admin";
  const label = String(req.body?.label || "admin-system").slice(0, 160);
  let backup;
  if (durableBackupConfigured()) {
    backup = await createDurableBackup({ label, actor });
    await rotateDurableBackups();
  } else {
    backup = createFullBackup({ label, createdBy: actor });
    rotateBackups();
  }
  logAudit({ type: "backup", action: "create", user: actor, detail: backup.id });
  res.json({ ok: true, durable: durableBackupConfigured(), backup });
}));

router.post("/backups/rotate", requireAuth({ action: "backup" }), asyncRoute(async (req, res) => {
  const maxKeep = Number(req.body?.maxKeep) || undefined;
  const result = durableBackupConfigured() ? await rotateDurableBackups(maxKeep) : rotateBackups(maxKeep);
  res.json({ ok: true, durable: durableBackupConfigured(), ...result });
}));

router.post("/backups/:id/validate", requireAuth({ roles: ["super_admin"], action: "restore" }), asyncRoute(async (req, res) => {
  const id = String(req.params.id || "");
  const actor = req.authUser?.email || "admin";
  const result = id.startsWith("bkp_") && durableBackupConfigured()
    ? await restoreDurableBackup(id, { actor, dryRun: true })
    : restoreBackup(id, { actor, dryRun: true });
  logAudit({ type: "backup", action: "restore_validate", user: actor, detail: id });
  res.json({ ok: true, confirmationRequired: restoreConfirmation(id), ...result });
}));

router.post("/backups/:id/restore", requireAuth({ roles: ["super_admin"], action: "restore" }), asyncRoute(async (req, res) => {
  const id = String(req.params.id || "");
  const actor = req.authUser?.email || "admin";
  const confirmation = String(req.body?.confirmation || "");
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  if (confirmation !== restoreConfirmation(id)) {
    return res.status(400).json({ ok: false, error: `Confirmation requise: ${restoreConfirmation(id)}` });
  }
  if (reason.length < 5) return res.status(400).json({ ok: false, error: "Un motif de restauration est obligatoire (5 caracteres minimum)." });

  logAudit({ type: "backup", action: "restore_requested", user: actor, detail: `${id};reason=${reason}` });
  const result = id.startsWith("bkp_") && durableBackupConfigured()
    ? await restoreDurableBackup(id, { actor, dryRun: false })
    : restoreBackup(id, { actor, dryRun: false });
  res.json({ ok: true, ...result, message: "Restauration terminee. Les anciennes sessions ont ete revoquees; reconnectez-vous." });
}));

router.put("/maintenance", requireAuth({ roles: ["super_admin"], action: "security" }), (req, res) => {
  const active = req.body?.active === true;
  const info = setMaintenanceMode(active, {
    message: req.body?.message || "Maintenance planifiee Cardoria",
    by: req.authUser?.email || "admin"
  });
  res.json({ ok: true, maintenance: info });
});

router.post("/alerts/check", requireAuth({ action: "health" }), asyncRoute(async (req, res) => {
  const result = await checkAndAlert();
  res.json({ ok: true, ...result });
}));

router.post("/restart", requireAuth({ roles: ["super_admin"], action: "security" }), (req, res) => {
  logAudit({ type: "system", action: "restart_requested", user: req.authUser?.email || "admin", detail: "Graceful restart" });
  res.json({ ok: true, message: "Redemarrage programme — Render relancera le service." });
  setTimeout(() => process.exit(0), 500);
});

router.get("/errors", (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const severity = String(req.query.severity || "").toLowerCase();
  const raw = getRecentErrors(500);
  const filtered = severity ? raw.filter((entry) => String(entry.severity || "").toLowerCase() === severity) : raw;
  const stats = getErrorStats();
  res.json({
    ok: true,
    stats: { total: stats.total, last24h: stats.last24h, critical: stats.critical },
    errors: filtered.slice(0, limit).map(safeError),
    sanitized: true
  });
});

export default router;
