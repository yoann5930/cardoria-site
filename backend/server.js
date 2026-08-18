import express from "express";
import dotenv from "dotenv";
import estimationRoutes from "./routes/estimation.js";
import adminRoutes from "./routes/admin.js";
import analyticsRoutes from "./routes/analytics.js";
import engineRoutes from "./routes/engine.js";
import engineAdminRoutes from "./routes/engine-admin.js";
import marketplaceRoutes from "./routes/marketplace.js";
import marketplaceV1Routes from "./routes/marketplace-v1.js";
import marketplaceAdminRoutes, { webhookRouter } from "./routes/marketplace-admin.js";
import paymentsRoutes from "./routes/payments.js";
import paymentsAdminRoutes from "./routes/payments-admin.js";
import { seedEngineIfEmpty } from "./lib/engine/seed.js";
import { initMarketplace } from "./lib/marketplace/index.js";
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

const app = express();
const startup = { ok: true, degraded: [], startedAt: new Date().toISOString() };

function safeInit(name, fn) {
  try {
    fn();
    console.log(`[startup] ${name}: ok`);
  } catch (error) {
    startup.ok = false;
    startup.degraded.push({ name, error: error?.message || String(error) });
    console.error(`[startup] ${name}: degraded`, error);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[process] uncaughtException", error);
});

applySecurityMiddleware(app);
app.use("/api/marketplace/webhooks", webhookRouter);
app.use(express.json({ limit: process.env.BODY_LIMIT || "15mb" }));

app.get("/", (req, res) => res.send("Backend Cardoria V5 Enterprise opérationnel."));
app.get("/api/health/startup", (req, res) => {
  res.status(startup.ok ? 200 : 503).json({
    ok: startup.ok,
    status: startup.ok ? "healthy" : "degraded",
    startedAt: startup.startedAt,
    degraded: startup.degraded.map((item) => item.name)
  });
});

app.use(maintenanceMiddleware);
app.use(connectionJournalMiddleware());
app.use("/api/health", healthRoutes);
app.use("/api/system", systemRoutes);

safeInit("auth-migration", migrateAuth);
safeInit("ai", initAi);
safeInit("engine-seed", seedEngineIfEmpty);
safeInit("marketplace", initMarketplace);
safeInit("market-data", initMarketData);
safeInit("scanner", initScanner);
safeInit("ai-enterprise", initAiEnterprise);
safeInit("ultimate", initUltimate);
safeInit("bigdata", initBigData);
safeInit("seo", initSeo);
safeInit("backup-scheduler", scheduleAutoBackup);
safeInit("launch", initLaunch);

app.use("/api/auth", authRoutes);
app.use("/api/gdpr", gdprRoutes);
app.use("/api/analytics", apiRateLimit, analyticsRoutes);
app.use("/api/ai", aiRateLimit, aiRoutes);
app.use("/api/scanner", aiRateLimit, scannerRoutes);
app.use("/api/ai-enterprise", aiRateLimit, aiEnterpriseRoutes);
app.use("/api/ultimate", aiRateLimit, ultimateRoutes);
app.use("/api/bigdata", apiRateLimit, bigdataAnalyticsRoutes);
app.use("/api/engine", apiRateLimit, engineRoutes);
app.use("/api/marketplace", apiRateLimit, marketplaceRoutes);
app.use("/api/marketplace", apiRateLimit, marketplaceV1Routes);
app.use("/api/payments", apiRateLimit, paymentsRoutes);
app.use("/api/seo", apiRateLimit, seoRoutes);

app.use("/api/estimation-carte", (req, res, next) => {
  if (req.method === "POST") return aiRateLimit(req, res, next);
  next();
}, estimationRoutes);

app.use("/api/admin", adminRoutes);
app.use("/api/admin/engine", engineAdminRoutes);
app.use("/api/admin/marketplace", marketplaceAdminRoutes);
app.use("/api/admin/payments", paymentsAdminRoutes);
app.use("/api/admin/seo", seoAdminRoutes);
app.use("/api/admin/ai", aiAdminRoutes);
app.use("/api/admin/market", marketAdminRoutes);
app.use("/api/admin/scanner", scannerAdminRoutes);
app.use("/api/admin/ai-enterprise", aiEnterpriseAdminRoutes);
app.use("/api/admin/ultimate", ultimateAdminRoutes);
app.use("/api/admin/bigdata", bigdataAdminRoutes);

/** Legacy login conservé uniquement côté serveur pour transition. */
app.post("/api/admin/login", authRateLimit, (req, res) => {
  const v = validateBody(SCHEMAS.legacyAdminLogin, req.body || {});
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });

  const expected = process.env.ADMIN_CODE;
  if (!expected) {
    return res.status(503).json({ ok: false, error: "ADMIN_CODE non configuré — utiliser /api/auth/login." });
  }
  if (v.data.code !== expected) {
    logAudit({ type: "auth", action: "login_failed", user: "unknown", detail: "Code incorrect" });
    return res.status(401).json({ ok: false, error: "Code incorrect" });
  }
  logAudit({ type: "auth", action: "login_success", user: "admin", detail: "Legacy code" });
  res.json({ ok: true, token: expected, legacy: true });
});

app.use(errorHandler);

const port = process.env.PORT || 10000;
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Cardoria backend V5.0.1 ready — port ${port} — ${startup.ok ? "healthy" : "degraded"}`);
});

function shutdown(signal) {
  console.log(`[process] ${signal} received, closing HTTP server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
