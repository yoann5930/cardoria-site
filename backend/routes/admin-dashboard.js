import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { getEstimations } from "./estimation.js";
import { listUsers } from "../lib/auth/users.js";
import { getWitnotStats } from "../lib/attribution/witnot.js";
import { getAuditLogs, logAudit } from "../lib/audit.js";
import { buildAdminDashboard, periodFilter } from "../lib/admin/dashboard.js";

const router = Router();
const EXPORT_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "export" });
router.use(requireAdmin);

function clean(value, max = 120) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function safePeriod(value) {
  const period = clean(value, 20);
  return ["day", "week", "month", "year"].includes(period) ? period : "month";
}

function auditMatchesPeriod(log, period) {
  return periodFilter(log?.at, period);
}

function auditSeverity(log) {
  const type = String(log?.type || "").toLowerCase();
  const action = String(log?.action || "").toLowerCase();
  if (type === "security" || action.includes("denied") || action.includes("failed")) return "danger";
  if (type === "auth" || type === "payment" || type === "backup") return "warn";
  return "info";
}

function buildAuditSummary(logs) {
  const byType = {};
  const byUser = {};
  const byAction = {};
  let danger = 0;
  let warn = 0;
  for (const log of logs) {
    const type = clean(log.type, 60) || "other";
    const user = clean(log.user, 160) || "system";
    const action = clean(log.action, 120) || "unknown";
    byType[type] = (byType[type] || 0) + 1;
    byUser[user] = (byUser[user] || 0) + 1;
    byAction[action] = (byAction[action] || 0) + 1;
    const severity = auditSeverity(log);
    if (severity === "danger") danger += 1;
    else if (severity === "warn") warn += 1;
  }
  return {
    total: logs.length,
    danger,
    warn,
    info: Math.max(0, logs.length - danger - warn),
    byType,
    topUsers: Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([user, count]) => ({ user, count })),
    topActions: Object.entries(byAction).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([action, count]) => ({ action, count }))
  };
}

function csvCell(value) {
  return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
}

router.get("/dashboard", (req, res) => {
  try {
    const period = safePeriod(req.query.period);
    const data = buildAdminDashboard({
      period,
      estimations: getEstimations(),
      users: listUsers(),
      witnot: getWitnotStats(period)
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, ...data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Tableau de bord indisponible." });
  }
});

router.get("/audit/summary", (req, res) => {
  const period = safePeriod(req.query.period);
  const type = clean(req.query.type, 60);
  const user = clean(req.query.user, 160);
  const q = clean(req.query.q, 240);
  let logs = getAuditLogs({ type, user, q, limit: 2000 });
  logs = logs.filter((log) => auditMatchesPeriod(log, period));
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, period, summary: buildAuditSummary(logs), logs: logs.slice(0, 500) });
});

router.get("/audit/export.csv", EXPORT_ADMIN, (req, res) => {
  const period = safePeriod(req.query.period);
  const type = clean(req.query.type, 60);
  const user = clean(req.query.user, 160);
  const q = clean(req.query.q, 240);
  let logs = getAuditLogs({ type, user, q, limit: 2000 });
  logs = logs.filter((log) => auditMatchesPeriod(log, period));
  const headers = ["date", "type", "action", "user", "detail"];
  const rows = [headers.join(";"), ...logs.map((log) => [log.at, log.type, log.action, log.user, log.detail].map(csvCell).join(";"))];
  logAudit({ type: "export", action: "audit_export_csv", user: req.authUser?.email || "admin", detail: `${period} — ${logs.length} lignes` });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cardoria-audit-${period}-${Date.now()}.csv"`);
  res.send("\uFEFF" + rows.join("\n"));
});

export default router;
