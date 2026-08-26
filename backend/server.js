import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import estimationRoutes from "./routes/estimation.js";
import adminRoutes from "./routes/admin.js";
import developmentRoutes from "./routes/development.js";
import analyticsRoutes from "./routes/analytics.js";
import engineRoutes from "./routes/engine.js";
import engineAdminRoutes from "./routes/engine-admin.js";
import marketplaceV1Routes from "./routes/marketplace-v1.js";
import marketplaceAdminRoutes, { webhookRouter } from "./routes/marketplace-admin.js";
import paymentsRoutes from "./routes/payments.js";
import paymentsAdminRoutes from "./routes/payments-admin.js";
import { seedEngineIfEmpty } from "./lib/engine/seed.js";
import { initMarketplace } from "./lib/marketplace/index.js";
import { initMarketplacePersistence, marketplacePersistenceMiddleware, flushMarketplacePersistence, closeMarketplacePersistence } from "./lib/marketplace/persistence.js";
import { emptyPublicCatalogOnce } from "./lib/marketplace/empty-catalog.js";
import { initAi } from "./lib/ai/index.js";
import { initSeo } from "./lib/seo/index.js";
import { initMarketData } from "./lib/market/index.js";
import { initScanner } from "./lib/scanner/index.js";
import { initAiEnterprise } from "./lib/ai-enterprise/index.js";
import { initUltimate } from "./lib/ultimate/index.js";
import { initBigData } from "./lib/bigdata/index.js";
import aiRoutes from "./routes/ai.js";
import aiAdminRoutes from "./routes/ai-admin.js";
import seoRoutes from "./routes/seo.js";
import seoAdminRoutes from "./routes/seo-admin.js";
import authRoutes from "./routes/auth.js";
import gdprRoutes from "./routes/gdpr.js";
import healthRoutes from "./routes/health.js";
import marketAdminRoutes from "./routes/market-admin.js";
import scannerRoutes from "./routes/scanner.js";
import scannerAdminRoutes from "./routes/scanner-admin.js";
import aiEnterpriseRoutes from "./routes/ai-enterprise.js";
import aiEnterpriseAdminRoutes from "./routes/ai-enterprise-admin.js";
import ultimateRoutes from "./routes/ultimate.js";
import ultimateAdminRoutes from "./routes/ultimate-admin.js";
import bigdataAnalyticsRoutes from "./routes/bigdata-analytics.js";
import bigdataAdminRoutes from "./routes/bigdata-admin.js";
import { logAudit } from "./lib/audit.js";
import { applySecurityMiddleware, errorHandler } from "./lib/security/index.js";
import { apiRateLimit, aiRateLimit, authRateLimit } from "./lib/security/rateLimit.js";
import { migrateAuth } from "./lib/auth/migrate.js";
import { scheduleAutoBackup } from "./lib/backup/full.js";
import { validateBody, SCHEMAS } from "./lib/security/validate.js";
import { initLaunch, connectionJournalMiddleware, maintenanceMiddleware } from "./lib/launch/index.js";
import systemRoutes from "./routes/system.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_ROOT = path.resolve(__dirname, "..");
const BLOCKED_PUBLIC_ROOTS = new Set(["backend", ".git", ".github", "node_modules", "database", "scripts", "logs", "backups"]);
const PUBLIC_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".xml", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".map"]);
const app = express();
const startup = { ok: true, degraded: [], startedAt: new Date().toISOString() };

function safeInit(name, fn) {
  try { fn(); console.log(`[startup] ${name}: ok`); }
  catch (error) { startup.ok = false; startup.degraded.push({ name, error: error?.message || String(error) }); console.error(`[startup] ${name}: degraded`, error); }
}
process.on("unhandledRejection", (reason) => console.error("[process] unhandledRejection", reason));
process.on("uncaughtException", (error) => console.error("[process] uncaughtException", error));

applySecurityMiddleware(app);
app.use("/api/marketplace/webhooks", marketplacePersistenceMiddleware, webhookRouter);
app.use(express.json({ limit: process.env.BODY_LIMIT || "15mb" }));
app.get("/api", (req, res) => res.json({ ok: true, service: "Cardoria API", version: "6.0.0" }));
app.get("/api/health/startup", (req, res) => res.status(startup.ok ? 200 : 503).json({ ok: startup.ok, status: startup.ok ? "healthy" : "degraded", startedAt: startup.startedAt, degraded: startup.degraded.map((item) => item.name) }));
app.use(maintenanceMiddleware);
app.use(connectionJournalMiddleware());
app.use("/api/health", healthRoutes);
app.use("/api/system", systemRoutes);

safeInit("auth-migration", migrateAuth);
safeInit("ai", initAi);
safeInit("engine-seed", seedEngineIfEmpty);
safeInit("marketplace", initMarketplace);
const marketplacePersistence = await initMarketplacePersistence();
if (!marketplacePersistence.ok) {
  startup.ok = false;
  startup.degraded.push({ name: "marketplace-persistence", error: marketplacePersistence.error || "initialization_failed" });
} else if (marketplacePersistence.configured) {
  console.log(`[startup] marketplace-persistence: ok (${marketplacePersistence.restored ? "restored" : "initialized"})`);
  try {
    const catalogCleanup = await emptyPublicCatalogOnce();
    if (catalogCleanup.applied) console.log("[startup] catalog-cleanup: all existing marketplace articles removed");
    else console.log("[startup] catalog-cleanup: already applied");
  } catch (error) {
    startup.ok = false;
    startup.degraded.push({ name: "catalog-cleanup", error: error?.message || String(error) });
    console.error("[startup] catalog-cleanup: degraded", error);
  }
}
safeInit("market-data", initMarketData);
safeInit("scanner", initScanner);
safeInit("ai-enterprise", initAiEnterprise);
safeInit("ultimate", initUltimate);
safeInit("bigdata", initBigData);
safeInit("seo", initSeo);
safeInit("backup-scheduler", scheduleAutoBackup);
safeInit("launch", initLaunch);

// Toutes les mutations contenant des donnees critiques declenchent un snapshot PostgreSQL.
app.use("/api/auth", marketplacePersistenceMiddleware, authRoutes);
app.use("/api/gdpr", marketplacePersistenceMiddleware, gdprRoutes);
app.use("/api/analytics", apiRateLimit, analyticsRoutes);
app.use("/api/ai", aiRateLimit, aiRoutes);
app.use("/api/scanner", aiRateLimit, scannerRoutes);
app.use("/api/ai-enterprise", aiRateLimit, aiEnterpriseRoutes);
app.use("/api/ultimate", aiRateLimit, ultimateRoutes);
app.use("/api/bigdata", apiRateLimit, bigdataAnalyticsRoutes);
app.use("/api/engine", apiRateLimit, engineRoutes);
app.use("/api/marketplace", marketplacePersistenceMiddleware, apiRateLimit, marketplaceV1Routes);
app.use("/api/payments", marketplacePersistenceMiddleware, apiRateLimit, paymentsRoutes);
app.use("/api/seo", apiRateLimit, seoRoutes);

app.use("/api/estimation-carte", (req, res, next) => { if (req.method === "POST") return aiRateLimit(req, res, next); next(); }, estimationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/development", developmentRoutes);
app.use("/api/admin/engine", engineAdminRoutes);
app.use("/api/admin/marketplace", marketplacePersistenceMiddleware, marketplaceAdminRoutes);
app.use("/api/admin/payments", marketplacePersistenceMiddleware, paymentsAdminRoutes);
app.use("/api/admin/seo", seoAdminRoutes);
app.use("/api/admin/ai", aiAdminRoutes);
app.use("/api/admin/market", marketAdminRoutes);
app.use("/api/admin/scanner", scannerAdminRoutes);
app.use("/api/admin/ai-enterprise", aiEnterpriseAdminRoutes);
app.use("/api/admin/ultimate", ultimateAdminRoutes);
app.use("/api/admin/bigdata", bigdataAdminRoutes);

app.post("/api/admin/login", authRateLimit, (req, res) => {
  const v = validateBody(SCHEMAS.legacyAdminLogin, req.body || {});
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
  const expected = process.env.ADMIN_CODE;
  if (!expected || process.env.LEGACY_ADMIN_CODE === "false") return res.status(503).json({ ok: false, error: "Connexion legacy desactivee — utiliser /api/auth/login." });
  if (v.data.code !== expected) { logAudit({ type: "auth", action: "login_failed", user: "unknown", detail: "Code incorrect" }); return res.status(401).json({ ok: false, error: "Code incorrect" }); }
  logAudit({ type: "auth", action: "login_success", user: "admin", detail: "Legacy code" });
  res.json({ ok: true, token: expected, legacy: true });
});

app.get(["/boutique", "/boutique/", "/pages/boutique", "/pages/boutique/"], (req, res) => res.redirect(308, "/boutique.html"));
app.get("/script.js", (req, res, next) => {
  try {
    const scriptPath = path.join(PUBLIC_ROOT, "script.js");
    let source = fs.readFileSync(scriptPath, "utf8");
    source = source.replace('const BACKEND_URL="https://cardoria-site-2.onrender.com";', 'const BACKEND_URL=window.location.origin;').replace('const ADMIN_CODE_LOCAL="CARDORIA59330";', 'const ADMIN_CODE_LOCAL="";');
    res.type("application/javascript; charset=utf-8").send(source);
  } catch (error) { next(error); }
});

function sendPublicFile(req, res, next) {
  let requestPath;
  try { requestPath = decodeURIComponent(req.path || "/"); } catch { return res.status(400).send("Requete invalide."); }
  if (requestPath.startsWith("/api/")) return next();
  if (requestPath === "/") return res.sendFile(path.join(PUBLIC_ROOT, "index.html"));
  const relativePath = requestPath.replace(/^\/+/, "");
  if (!relativePath || relativePath.includes("..")) return next();
  const firstSegment = relativePath.split("/")[0];
  if (BLOCKED_PUBLIC_ROOTS.has(firstSegment)) return res.status(404).send("Not found");
  const extension = path.extname(relativePath).toLowerCase();
  if (!PUBLIC_EXTENSIONS.has(extension)) return next();
  const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);
  if (absolutePath !== PUBLIC_ROOT && !absolutePath.startsWith(PUBLIC_ROOT + path.sep)) return res.status(403).send("Forbidden");
  return res.sendFile(absolutePath, (error) => { if (!error) return; if (error.status === 404) return next(); return next(error); });
}
app.get("*", sendPublicFile);
app.use(errorHandler);

const port = process.env.PORT || 10000;
const server = app.listen(port, "0.0.0.0", () => { console.log(`Cardoria V6 single-host ready — port ${port} — ${startup.ok ? "healthy" : "degraded"}`); console.log(`[startup] public root: ${PUBLIC_ROOT}`); });
function shutdown(signal) {
  console.log(`[process] ${signal} received, closing HTTP server`);
  const forceExit = setTimeout(() => process.exit(1), 10000); forceExit.unref();
  server.close(async () => {
    const persisted = await flushMarketplacePersistence(`shutdown-${signal.toLowerCase()}`);
    if (!persisted.ok) console.error("[marketplace-persistence] shutdown flush failed");
    try { await closeMarketplacePersistence(); } catch {}
    clearTimeout(forceExit); process.exit(persisted.ok ? 0 : 1);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
