import { Router } from "express";
import crypto from "crypto";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { readJson, writeJson } from "../lib/storage.js";
import { createFullBackup } from "../lib/backup/full.js";
import { logAudit, getAuditLogs } from "../lib/audit.js";
import { getEstimations } from "../routes/estimation.js";
import { listAnalyses } from "../lib/ai/training.js";
import { getWitnotStats } from "../lib/attribution/witnot.js";
import { listUsers, createUser, getUserByEmail, updateUserAdmin } from "../lib/auth/users.js";

const router = Router();
const USER_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "users" });
const EXPORT_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "export" });
const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });
const BACKUP_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "backup" });

const DEFAULT_PURCHASES = [];
const DEFAULT_ANALYTICS = {
  days: [],
  sources: { google: 0, facebook: 0, instagram: 0, direct: 0, witnot: 0 },
  devices: { mobile: 0, desktop: 0, tablet: 0 },
  avgSessionSeconds: 0,
  topPages: [],
  topSearches: [],
  topCards: [],
  sales: []
};

function periodFilter(dateStr, period) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  if (period === "day") return d.toDateString() === now.toDateString();
  if (period === "week") return now - d <= 7 * 86400000;
  if (period === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === "year") return d.getFullYear() === now.getFullYear();
  return true;
}

function csvEscape(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function validEmail(value) { return /^\S+@\S+\.\S+$/.test(String(value || "").trim().toLowerCase()); }

router.use(requireAdmin);

router.get("/dashboard", (req, res) => {
  const period = req.query.period || "month";
  const estimations = getEstimations().filter((e) => periodFilter(e.createdAt?.slice(0, 10) || "", period));
  const purchases = readJson("purchases", DEFAULT_PURCHASES).filter((p) => periodFilter(p.date, period));
  const analytics = readJson("analytics", DEFAULT_ANALYTICS);
  const dayData = (analytics.days || []).filter((d) => periodFilter(d.date, period));
  const salesCount = Math.round(dayData.reduce((s, d) => s + Number(d.sales || 0), 0));
  const revenue = dayData.reduce((s, d) => s + Number(d.revenue || 0), 0);
  const visitors = dayData.reduce((s, d) => s + Number(d.visitors || 0), 0);
  const newUsers = listUsers().filter((u) => u.role === "client" && periodFilter(u.createdAt || "", period)).length;
  res.json({ ok: true, period, kpis: { revenue, sales: salesCount, purchases: purchases.length, estimations: estimations.length, visitors, newUsers }, witnot: getWitnotStats(period), chart: dayData });
});

router.get("/accounting/sales", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  const license = req.query.license || "";
  let sales = readJson("analytics", DEFAULT_ANALYTICS).sales || [];
  if (license) sales = sales.filter((s) => s.license === license);
  if (q) sales = sales.filter((s) => JSON.stringify(s).toLowerCase().includes(q));
  res.json({ ok: true, sales });
});
router.get("/accounting/purchases", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  let purchases = readJson("purchases", DEFAULT_PURCHASES);
  if (q) purchases = purchases.filter((p) => JSON.stringify(p).toLowerCase().includes(q));
  res.json({ ok: true, purchases });
});
router.get("/accounting/stats", (req, res) => {
  const sales = readJson("analytics", DEFAULT_ANALYTICS).sales || [];
  const purchases = readJson("purchases", DEFAULT_PURCHASES);
  const byLicense = {}, bySeller = {};
  sales.forEach((s) => { byLicense[s.license] = (byLicense[s.license] || 0) + Number(s.amount || 0); bySeller[s.seller] = (bySeller[s.seller] || 0) + Number(s.amount || 0); });
  res.json({ ok: true, byLicense, bySeller, totalSales: sales.reduce((a, s) => a + Number(s.amount || 0), 0), totalPurchases: purchases.reduce((a, p) => a + Number(p.amount || 0), 0) });
});
router.get("/accounting/export", EXPORT_ADMIN, (req, res) => {
  const format = req.query.format || "csv";
  const type = req.query.type || "sales";
  const data = type === "purchases" ? readJson("purchases", DEFAULT_PURCHASES) : (readJson("analytics", DEFAULT_ANALYTICS).sales || []);
  logAudit({ type: "export", action: `export_${format}`, user: req.authUser?.email || "admin", detail: `${type} — ${data.length} lignes` });
  if (format === "csv" || format === "excel") {
    const headers = Object.keys(data[0] || { id: "", date: "", amount: "" });
    const rows = [headers.join(";"), ...data.map((row) => headers.map((h) => csvEscape(row[h])).join(";"))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cardoria-${type}-${Date.now()}.csv"`);
    return res.send("\uFEFF" + rows.join("\n"));
  }
  if (format === "pdf") {
    const headers = Object.keys(data[0] || {});
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Export Cardoria</title></head><body><h1>Cardoria — Export ${type}</h1><table><thead><tr>${headers.map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>${data.map((r) => `<tr>${headers.map((k) => `<td>${String(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table><p>Généré le ${new Date().toLocaleString("fr-FR")}</p></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cardoria-${type}-${Date.now()}.html"`);
    return res.send(html);
  }
  res.status(400).json({ ok: false, error: "Format non supporté" });
});

router.get("/users", USER_ADMIN, (req, res) => res.json({ ok: true, users: listUsers() }));
router.post("/users", USER_ADMIN, (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "employee");
    const name = String(req.body?.name || "").trim().slice(0, 120);
    if (!validEmail(email)) return res.status(400).json({ ok: false, error: "Email invalide" });
    if (!["employee", "admin"].includes(role)) return res.status(400).json({ ok: false, error: "Créer ici uniquement un employé ou administrateur. Les clients s'inscrivent sur le site." });
    if (role === "admin" && req.authUser?.role !== "super_admin") return res.status(403).json({ ok: false, error: "Seul un super administrateur peut créer un administrateur." });
    if (getUserByEmail(email)) return res.status(409).json({ ok: false, error: "Un compte existe déjà pour cet email." });
    const password = crypto.randomBytes(48).toString("base64url") + "1A";
    const user = createUser({ email, password, role, name });
    logAudit({ type: "users", action: "create", user: req.authUser?.email || "admin", detail: email });
    res.status(201).json({ ok: true, user, loginMethod: "magic_link" });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});
router.put("/users/:id", USER_ADMIN, (req, res) => {
  try {
    const user = updateUserAdmin(req.params.id, req.body || {}, req.authUser?.role || "admin");
    logAudit({ type: "users", action: "update", user: req.authUser?.email || "admin", detail: user.email });
    res.json({ ok: true, user });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});

router.get("/analytics/site", (req, res) => res.json({ ok: true, analytics: readJson("analytics", DEFAULT_ANALYTICS) }));
router.get("/estimations", (req, res) => {
  const ai = listAnalyses({ limit: 150 });
  if (ai.length) return res.json({ ok: true, requests: ai.map((a) => ({ id: a.id, createdAt: a.createdAt, customerName: a.customerName, customerEmail: a.customerEmail, cardName: a.detection?.name || "", cardGame: a.detection?.license || "", confidenceScore: a.confidenceScore, suspicionAlert: a.suspicionAlert, suspicionReasons: a.suspicionReasons, detection: a.detection, condition: a.conditionGrade, prices: a.prices, adminStatus: a.adminStatus, result: a.clientMessage })) });
  res.json({ ok: true, requests: getEstimations() });
});
router.get("/audit", (req, res) => res.json({ ok: true, logs: getAuditLogs(req.query) }));
router.post("/backup", BACKUP_ADMIN, (req, res) => {
  const backup = createFullBackup({ label: "admin-manual" });
  logAudit({ type: "backup", action: "create", user: req.authUser?.email || "admin", detail: backup.id });
  res.json({ ok: true, backup });
});
router.get("/integrations", (req, res) => {
  const settings = readJson("settings", { ga4Id: process.env.GA4_MEASUREMENT_ID || "", clarityId: process.env.CLARITY_PROJECT_ID || "", gscVerified: !!process.env.GSC_VERIFIED, sitemapUrl: `${process.env.SITE_URL || "https://cardoria-site-2.onrender.com"}/sitemap.xml`, robotsUrl: `${process.env.SITE_URL || "https://cardoria-site-2.onrender.com"}/robots.txt`, seoAuto: true });
  res.json({ ok: true, settings });
});
router.put("/integrations", WRITE_ADMIN, (req, res) => {
  const settings = { ...readJson("settings", {}), ...req.body };
  writeJson("settings", settings);
  logAudit({ type: "integrations", action: "update", user: req.authUser?.email || "admin", detail: "Paramètres Google/SEO" });
  res.json({ ok: true, settings });
});

export default router;