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
const DELETE_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "delete" });
const BACKUP_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "backup" });

const DEFAULT_PURCHASES = [];
const DEFAULT_SEALED_REFERENCES = [];
const BUYERS = ["yoann", "valentin"];
const PURCHASE_TYPES = ["pokemon_card", "consumable", "equipment"];
const PACKAGING_TYPES = [
  "carte_unite", "lot_cartes", "booster", "blister", "duopack", "tripack", "quadpack", "bundle", "mini_bundle",
  "demi_display", "display", "case_display", "etb", "etb_pokemon_center", "upc", "coffret", "collection_box", "tin", "pokebox",
  "mini_tin", "build_battle", "build_battle_stadium", "deck", "theme_deck", "battle_deck", "league_battle_deck", "starter_deck",
  "premium_collection", "poster_collection", "binder_collection", "calendar", "advent_calendar", "case_carton", "master_case",
  "sleeve_pack", "toploader_pack", "semi_rigid_pack", "team_bag_pack", "envelope_pack", "box_storage", "other"
];
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
function cleanText(value, max = 240) { return String(value || "").trim().slice(0, max); }

function normalizePurchase(body = {}, existing = {}) {
  const amountRaw = String(body.amount ?? existing.amount ?? "").replace(",", ".");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0) throw Object.assign(new Error("Montant d'achat invalide."), { status: 400 });

  const date = cleanText(body.date ?? existing.date, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error("Date d'achat invalide."), { status: 400 });

  const seller = cleanText(body.seller ?? existing.seller, 160);
  const description = cleanText(body.description ?? existing.description, 240);
  if (!seller) throw Object.assign(new Error("Le vendeur ou fournisseur est obligatoire."), { status: 400 });
  if (!description) throw Object.assign(new Error("La description de l'achat est obligatoire."), { status: 400 });

  const quantity = Math.max(1, Math.min(100000, Math.trunc(Number(body.quantity ?? existing.quantity ?? 1) || 1)));
  const allowedStatus = ["paid", "pending", "cancelled", "refunded"];
  const requestedStatus = String(body.status ?? existing.status ?? "paid");
  const status = allowedStatus.includes(requestedStatus) ? requestedStatus : "paid";
  const buyerRaw = cleanText(body.buyer ?? existing.buyer, 40).toLowerCase();
  const buyer = BUYERS.includes(buyerRaw) ? buyerRaw : "yoann";
  const purchaseTypeRaw = cleanText(body.purchaseType ?? existing.purchaseType, 40);
  const purchaseType = PURCHASE_TYPES.includes(purchaseTypeRaw) ? purchaseTypeRaw : "pokemon_card";
  const packagingRaw = cleanText(body.packaging ?? existing.packaging, 80);
  const packaging = PACKAGING_TYPES.includes(packagingRaw) ? packagingRaw : (purchaseType === "pokemon_card" ? "carte_unite" : "other");

  return {
    ...existing,
    date,
    seller,
    description,
    buyer,
    purchaseType,
    packaging,
    category: cleanText(body.category ?? existing.category, 80) || "autre",
    license: cleanText(body.license ?? existing.license, 80),
    quantity,
    amount: Math.round(amount * 100) / 100,
    paymentMethod: cleanText(body.paymentMethod ?? existing.paymentMethod, 80),
    reference: cleanText(body.reference ?? existing.reference, 120),
    status,
    notes: cleanText(body.notes ?? existing.notes, 1000)
  };
}

function normalizeSealedReference(body = {}, existing = {}) {
  const name = cleanText(body.name ?? existing.name, 180);
  if (!name) throw Object.assign(new Error("Le nom du produit est obligatoire."), { status: 400 });
  const packagingRaw = cleanText(body.packaging ?? existing.packaging, 80);
  const packaging = PACKAGING_TYPES.includes(packagingRaw) ? packagingRaw : "other";
  const units = Math.max(1, Math.min(10000, Math.trunc(Number(body.unitsPerPackage ?? existing.unitsPerPackage ?? 1) || 1)));
  return {
    ...existing,
    name,
    license: cleanText(body.license ?? existing.license, 80) || "pokemon",
    extension: cleanText(body.extension ?? existing.extension, 140),
    packaging,
    unitsPerPackage: units,
    ean: cleanText(body.ean ?? existing.ean, 40),
    notes: cleanText(body.notes ?? existing.notes, 1000)
  };
}

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
  const license = cleanText(req.query.license, 80);
  const category = cleanText(req.query.category, 80);
  const buyer = cleanText(req.query.buyer, 40).toLowerCase();
  const purchaseType = cleanText(req.query.purchaseType, 40);
  const packaging = cleanText(req.query.packaging, 80);
  let purchases = readJson("purchases", DEFAULT_PURCHASES);
  if (license) purchases = purchases.filter((p) => p.license === license);
  if (category) purchases = purchases.filter((p) => p.category === category);
  if (buyer) purchases = purchases.filter((p) => (p.buyer || "yoann") === buyer);
  if (purchaseType) purchases = purchases.filter((p) => (p.purchaseType || "pokemon_card") === purchaseType);
  if (packaging) purchases = purchases.filter((p) => (p.packaging || "carte_unite") === packaging);
  if (q) purchases = purchases.filter((p) => JSON.stringify(p).toLowerCase().includes(q));
  purchases = purchases.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  res.json({ ok: true, purchases });
});

router.post("/accounting/purchases", WRITE_ADMIN, (req, res) => {
  try {
    const purchases = readJson("purchases", DEFAULT_PURCHASES);
    const now = new Date().toISOString();
    const purchase = normalizePurchase(req.body || {}, {
      id: `ach_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      createdAt: now,
      updatedAt: now,
      createdBy: req.authUser?.email || "admin"
    });
    purchases.unshift(purchase);
    writeJson("purchases", purchases);
    logAudit({ type: "accounting", action: "purchase_create", user: req.authUser?.email || "admin", detail: `${purchase.id} — ${purchase.buyer} — ${purchase.seller} — ${purchase.amount} EUR` });
    res.status(201).json({ ok: true, purchase });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

router.put("/accounting/purchases/:id", WRITE_ADMIN, (req, res) => {
  try {
    const purchases = readJson("purchases", DEFAULT_PURCHASES);
    const index = purchases.findIndex((p) => p.id === req.params.id);
    if (index < 0) return res.status(404).json({ ok: false, error: "Achat introuvable." });
    const purchase = normalizePurchase(req.body || {}, { ...purchases[index], updatedAt: new Date().toISOString() });
    purchases[index] = purchase;
    writeJson("purchases", purchases);
    logAudit({ type: "accounting", action: "purchase_update", user: req.authUser?.email || "admin", detail: purchase.id });
    res.json({ ok: true, purchase });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

router.delete("/accounting/purchases/:id", DELETE_ADMIN, (req, res) => {
  const purchases = readJson("purchases", DEFAULT_PURCHASES);
  const index = purchases.findIndex((p) => p.id === req.params.id);
  if (index < 0) return res.status(404).json({ ok: false, error: "Achat introuvable." });
  const [removed] = purchases.splice(index, 1);
  writeJson("purchases", purchases);
  logAudit({ type: "accounting", action: "purchase_delete", user: req.authUser?.email || "admin", detail: removed.id });
  res.json({ ok: true, deletedId: removed.id });
});

router.get("/accounting/stats", (req, res) => {
  const sales = readJson("analytics", DEFAULT_ANALYTICS).sales || [];
  const purchases = readJson("purchases", DEFAULT_PURCHASES);
  const byLicense = {}, bySeller = {}, purchaseByLicense = {}, purchaseBySeller = {}, purchaseByCategory = {}, purchaseByBuyer = {}, purchaseByType = {};
  sales.forEach((s) => {
    byLicense[s.license] = (byLicense[s.license] || 0) + Number(s.amount || 0);
    bySeller[s.seller] = (bySeller[s.seller] || 0) + Number(s.amount || 0);
  });
  purchases.forEach((p) => {
    const license = p.license || "sans licence";
    const seller = p.seller || "inconnu";
    const category = p.category || "autre";
    const buyer = p.buyer || "yoann";
    const purchaseType = p.purchaseType || "pokemon_card";
    purchaseByLicense[license] = (purchaseByLicense[license] || 0) + Number(p.amount || 0);
    purchaseBySeller[seller] = (purchaseBySeller[seller] || 0) + Number(p.amount || 0);
    purchaseByCategory[category] = (purchaseByCategory[category] || 0) + Number(p.amount || 0);
    purchaseByBuyer[buyer] = (purchaseByBuyer[buyer] || 0) + Number(p.amount || 0);
    purchaseByType[purchaseType] = (purchaseByType[purchaseType] || 0) + Number(p.amount || 0);
  });
  BUYERS.forEach((buyer) => { if (purchaseByBuyer[buyer] == null) purchaseByBuyer[buyer] = 0; });
  const totalSales = sales.reduce((a, s) => a + Number(s.amount || 0), 0);
  const totalPurchases = purchases.reduce((a, p) => a + Number(p.amount || 0), 0);
  res.json({
    ok: true,
    byLicense,
    bySeller,
    purchaseByLicense,
    purchaseBySeller,
    purchaseByCategory,
    purchaseByBuyer,
    purchaseByType,
    buyers: BUYERS,
    packagingTypes: PACKAGING_TYPES,
    totalSales,
    totalPurchases,
    cardoriaPurchaseTotal: totalPurchases,
    netResult: totalSales - totalPurchases,
    purchaseCount: purchases.length
  });
});

router.get("/catalog/sealed-references", (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  const packaging = cleanText(req.query.packaging, 80);
  let references = readJson("sealed-references", DEFAULT_SEALED_REFERENCES);
  if (packaging) references = references.filter((r) => r.packaging === packaging);
  if (q) references = references.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  res.json({ ok: true, references, packagingTypes: PACKAGING_TYPES });
});
router.post("/catalog/sealed-references", WRITE_ADMIN, (req, res) => {
  try {
    const list = readJson("sealed-references", DEFAULT_SEALED_REFERENCES);
    const now = new Date().toISOString();
    const reference = normalizeSealedReference(req.body || {}, { id: `seal_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`, createdAt: now, updatedAt: now });
    list.unshift(reference); writeJson("sealed-references", list); res.status(201).json({ ok: true, reference });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});
router.put("/catalog/sealed-references/:id", WRITE_ADMIN, (req, res) => {
  try {
    const list = readJson("sealed-references", DEFAULT_SEALED_REFERENCES); const i = list.findIndex((r) => r.id === req.params.id);
    if (i < 0) return res.status(404).json({ ok: false, error: "Référence introuvable." });
    list[i] = normalizeSealedReference(req.body || {}, { ...list[i], updatedAt: new Date().toISOString() }); writeJson("sealed-references", list); res.json({ ok: true, reference: list[i] });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});
router.delete("/catalog/sealed-references/:id", DELETE_ADMIN, (req, res) => {
  const list = readJson("sealed-references", DEFAULT_SEALED_REFERENCES); const i = list.findIndex((r) => r.id === req.params.id);
  if (i < 0) return res.status(404).json({ ok: false, error: "Référence introuvable." });
  list.splice(i, 1); writeJson("sealed-references", list); res.json({ ok: true });
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