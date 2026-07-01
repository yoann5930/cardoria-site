import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { readJson, writeJson, backupAll } from "../lib/storage.js";
import { createFullBackup } from "../lib/backup/full.js";
import { logAudit, getAuditLogs } from "../lib/audit.js";
import { getEstimations } from "../routes/estimation.js";
import { listAnalyses } from "../lib/ai/training.js";
import { getWitnotStats } from "../lib/attribution/witnot.js";

const router = Router();

const DEFAULT_USERS = [
  { id: "USR-001", name: "Admin Cardoria", email: "Cardoria59330@gmail.com", role: "admin", status: "active", createdAt: "2026-01-01" },
  { id: "USR-002", name: "Employé Boutique", email: "employe@cardoria.fr", role: "employee", status: "active", createdAt: "2026-03-15" },
  { id: "USR-003", name: "Thomas M.", email: "client@test.fr", role: "client", status: "active", createdAt: "2026-06-20" }
];

const DEFAULT_PURCHASES = [
  { id: "ACH-20260628-001", date: "2026-06-28", seller: "Particulier Lille", license: "pokemon", amount: 450, status: "Validé", items: "Lot 120 cartes Pokémon" },
  { id: "ACH-20260625-002", date: "2026-06-25", seller: "Collectionneur Paris", license: "yugioh", amount: 280, status: "Validé", items: "Lot Yu-Gi-Oh! rares" }
];

const DEFAULT_ANALYTICS = {
  days: [],
  sources: { google: 42, facebook: 18, instagram: 12, direct: 28, witnot: 0 },
  devices: { mobile: 55, desktop: 38, tablet: 7 },
  avgSessionSeconds: 184,
  topPages: [{ path: "/", views: 420 }, { path: "/estimation.html", views: 210 }, { path: "/boutique.html", views: 180 }],
  topSearches: [{ q: "pikachu base set", count: 34 }, { q: "lorcana elsa", count: 22 }, { q: "one piece luffy", count: 19 }],
  topCards: [{ name: "Dracaufeu Holo", views: 89 }, { name: "Luffy Rare", views: 67 }]
};

function periodFilter(dateStr, period) {
  const d = new Date(dateStr);
  const now = new Date();
  if (period === "day") return d.toDateString() === now.toDateString();
  if (period === "week") return now - d <= 7 * 86400000;
  if (period === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === "year") return d.getFullYear() === now.getFullYear();
  return true;
}

function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

router.use(requireAdmin);

router.get("/dashboard", (req, res) => {
  const period = req.query.period || "month";
  const estimations = getEstimations().filter((e) => periodFilter(e.createdAt?.slice(0, 10) || "", period));
  const purchases = readJson("purchases", DEFAULT_PURCHASES).filter((p) => periodFilter(p.date, period));
  const analytics = readJson("analytics", DEFAULT_ANALYTICS);
  const dayData = (analytics.days || []).filter((d) => periodFilter(d.date, period));

  const salesCount = dayData.length ? Math.round(dayData.reduce((s, d) => s + (d.sales || 0), 0)) : 12;
  const revenue = dayData.length ? dayData.reduce((s, d) => s + (d.revenue || 0), 0) : 1240;
  const visitors = dayData.reduce((s, d) => s + (d.visitors || 0), 0) || 73;
  const newUsers = readJson("users", DEFAULT_USERS).filter((u) => u.role === "client" && periodFilter(u.createdAt || "2026-01-01", period)).length;

  res.json({
    ok: true,
    period,
    kpis: {
      revenue,
      sales: salesCount,
      purchases: purchases.length,
      estimations: estimations.length,
      visitors,
      newUsers
    },
    witnot: getWitnotStats(period),
    chart: dayData.length ? dayData : analytics.days || []
  });
});

router.get("/accounting/sales", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  const license = req.query.license || "";
  let sales = readJson("analytics", DEFAULT_ANALYTICS).sales || [
    { id: "VTE-001", date: "2026-06-30", client: "Client test", license: "accessoires", seller: "Cardoria", amount: 13.8, items: "Sleeves x2" },
    { id: "VTE-002", date: "2026-06-29", client: "Sophie R.", license: "pokemon", seller: "Cardoria", amount: 89.9, items: "Dracaufeu Holo" }
  ];
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
  const byLicense = {};
  const bySeller = {};
  sales.forEach((s) => {
    byLicense[s.license] = (byLicense[s.license] || 0) + s.amount;
    bySeller[s.seller] = (bySeller[s.seller] || 0) + s.amount;
  });
  res.json({ ok: true, byLicense, bySeller, totalSales: sales.reduce((a, s) => a + s.amount, 0), totalPurchases: purchases.reduce((a, p) => a + p.amount, 0) });
});

router.get("/accounting/export", (req, res) => {
  const format = req.query.format || "csv";
  const type = req.query.type || "sales";
  const data = type === "purchases" ? readJson("purchases", DEFAULT_PURCHASES) : (readJson("analytics", DEFAULT_ANALYTICS).sales || []);

  logAudit({ type: "export", action: `export_${format}`, user: "admin", detail: `${type} — ${data.length} lignes` });

  if (format === "csv" || format === "excel") {
    const headers = Object.keys(data[0] || { id: "", date: "", amount: "" });
    const rows = [headers.join(";"), ...data.map((row) => headers.map((h) => csvEscape(row[h])).join(";"))];
    const bom = "\uFEFF";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cardoria-${type}-${Date.now()}.csv"`);
    return res.send(bom + rows.join("\n"));
  }

  if (format === "pdf") {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Export Cardoria</title><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px}th{background:#111;color:#ffe18a}</style></head><body><h1>Cardoria — Export ${type}</h1><table><thead><tr>${Object.keys(data[0]||{}).map(k=>`<th>${k}</th>`).join("")}</tr></thead><tbody>${data.map(r=>`<tr>${Object.values(r).map(v=>`<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table><p>Généré le ${new Date().toLocaleString("fr-FR")}</p></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cardoria-${type}-${Date.now()}.html"`);
    return res.send(html);
  }

  res.status(400).json({ ok: false, error: "Format non supporté" });
});

router.get("/users", (req, res) => {
  res.json({ ok: true, users: readJson("users", DEFAULT_USERS) });
});

router.post("/users", (req, res) => {
  const users = readJson("users", DEFAULT_USERS);
  const user = { id: "USR-" + Date.now(), status: "active", createdAt: new Date().toISOString().slice(0, 10), ...req.body };
  users.unshift(user);
  writeJson("users", users);
  logAudit({ type: "users", action: "create", user: "admin", detail: user.email });
  res.json({ ok: true, user });
});

router.put("/users/:id", (req, res) => {
  const users = readJson("users", DEFAULT_USERS);
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: "Utilisateur introuvable" });
  users[idx] = { ...users[idx], ...req.body };
  writeJson("users", users);
  logAudit({ type: "users", action: "update", user: "admin", detail: users[idx].email });
  res.json({ ok: true, user: users[idx] });
});

router.get("/analytics/site", (req, res) => {
  res.json({ ok: true, analytics: readJson("analytics", DEFAULT_ANALYTICS) });
});

router.get("/estimations", (req, res) => {
  const ai = listAnalyses({ limit: 150 });
  if (ai.length) {
    return res.json({
      ok: true,
      requests: ai.map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        customerName: a.customerName,
        customerEmail: a.customerEmail,
        cardName: a.detection?.name || "",
        cardGame: a.detection?.license || "",
        confidenceScore: a.confidenceScore,
        suspicionAlert: a.suspicionAlert,
        suspicionReasons: a.suspicionReasons,
        detection: a.detection,
        condition: a.conditionGrade,
        prices: a.prices,
        adminStatus: a.adminStatus,
        result: a.clientMessage
      }))
    });
  }
  res.json({ ok: true, requests: getEstimations() });
});

router.get("/audit", (req, res) => {
  res.json({ ok: true, logs: getAuditLogs(req.query) });
});

router.post("/backup", (req, res) => {
  const backup = createFullBackup({ label: "admin-manual" });
  logAudit({ type: "backup", action: "create", user: req.authUser?.email || "admin", detail: backup.id });
  res.json({ ok: true, backup });
});

router.get("/integrations", (req, res) => {
  const settings = readJson("settings", {
    ga4Id: process.env.GA4_MEASUREMENT_ID || "",
    clarityId: process.env.CLARITY_PROJECT_ID || "",
    gscVerified: !!process.env.GSC_VERIFIED,
    sitemapUrl: "https://cardoria.vercel.app/sitemap.xml",
    robotsUrl: "https://cardoria.vercel.app/robots.txt",
    seoAuto: true
  });
  res.json({ ok: true, settings });
});

router.put("/integrations", (req, res) => {
  const settings = { ...readJson("settings", {}), ...req.body };
  writeJson("settings", settings);
  logAudit({ type: "integrations", action: "update", user: "admin", detail: "Paramètres Google/SEO" });
  res.json({ ok: true, settings });
});

export default router;
