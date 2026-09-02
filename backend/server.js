import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import estimationRoutes from "./routes/estimation.js";
import rachatRoutes from "./routes/rachat.js";
import rachatAdminRoutes from "./routes/rachat-admin.js";
import adminRoutes from "./routes/admin.js";
import adminUsersRoutes from "./routes/admin-users.js";
import adminDashboardRoutes from "./routes/admin-dashboard.js";
import adminFinanceRoutes from "./routes/admin-finance.js";
import emailAdminRoutes from "./routes/email-admin.js";
import developmentRoutes from "./routes/development.js";
import analyticsRoutes from "./routes/analytics.js";
import engineRoutes from "./routes/engine.js";
import engineAdminRoutes from "./routes/engine-admin.js";
import marketplaceV1Routes from "./routes/marketplace-v1.js";
import marketplaceAdminRoutes, { webhookRouter } from "./routes/marketplace-admin.js";
import marketplaceModerationAdminRoutes from "./routes/marketplace-moderation-admin.js";
import paymentsRoutes from "./routes/payments.js";
import paymentsAdminRoutes from "./routes/payments-admin.js";
import { seedEngineIfEmpty } from "./lib/engine/seed.js";
import { getCardBySlug } from "./lib/engine/cards.js";
import { syncPokemonCatalog, syncPokemonReferenceCatalog } from "./lib/engine/tcgdex-sync.js";
import { initMarketplace } from "./lib/marketplace/index.js";
import { initMarketplacePersistence, marketplacePersistenceMiddleware, enginePersistenceMiddleware, flushMarketplacePersistence, flushEnginePersistence, closeMarketplacePersistence } from "./lib/marketplace/persistence.js";
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
import { applySecurityMiddleware, errorHandler } from "./lib/security/index.js";
import { apiRateLimit, aiRateLimit } from "./lib/security/rateLimit.js";
import { migrateAuth } from "./lib/auth/migrate.js";
import { scheduleAutoBackup } from "./lib/backup/full.js";
import { initLaunch, connectionJournalMiddleware, maintenanceMiddleware } from "./lib/launch/index.js";
import systemRoutes from "./routes/system.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIRRORED_PUBLIC_ROOT = path.resolve(__dirname, "public");
const LEGACY_PUBLIC_ROOT = path.resolve(__dirname, "..");
const PUBLIC_ROOT = fs.existsSync(path.join(MIRRORED_PUBLIC_ROOT, "index.html")) ? MIRRORED_PUBLIC_ROOT : LEGACY_PUBLIC_ROOT;
const BLOCKED_PUBLIC_ROOTS = new Set(["backend", ".git", ".github", "node_modules", "database", "scripts", "logs", "backups"]);
const PUBLIC_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".xml", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".map"]);
const SERVED_SITE_HOSTS = [
  "https://cardoria-site-2.onrender.com",
  "https://cardoria-site-f2cy.onrender.com",
  "https://cardoria.vercel.app"
];
const app = express();
const startup = { ok: true, ready: false, degraded: [], startedAt: new Date().toISOString() };
let authReady = false;

function safeInit(name, fn) {
  try { fn(); console.log(`[startup] ${name}: ok`); }
  catch (error) { startup.ok = false; startup.degraded.push({ name, error: error?.message || String(error) }); console.error(`[startup] ${name}: degraded`, error); }
}
process.on("unhandledRejection", (reason) => console.error("[process] unhandledRejection", reason));
process.on("uncaughtException", (error) => console.error("[process] uncaughtException", error));

applySecurityMiddleware(app);
app.use("/api/marketplace/webhooks", marketplacePersistenceMiddleware, webhookRouter);
app.use(express.json({ limit: process.env.BODY_LIMIT || "15mb" }));
app.get("/api", (req, res) => res.json({ ok: true, service: "Cardoria API", version: "6.0.0", ready: startup.ready }));
app.get("/api/health/startup", (req, res) => res.status(200).json({ ok: startup.ok, ready: startup.ready, status: startup.ready ? (startup.ok ? "healthy" : "degraded") : "starting", startedAt: startup.startedAt, degraded: startup.degraded.map((item) => item.name) }));
app.use(maintenanceMiddleware);
app.use(connectionJournalMiddleware());
app.use("/api/health", healthRoutes);
app.use("/api/system", systemRoutes);

safeInit("auth-migration", migrateAuth);
app.use("/api/auth", marketplacePersistenceMiddleware, (req, res, next) => {
  if (!authReady) return res.status(503).json({ ok: false, error: "Authentification en cours d'initialisation. Réessayez dans quelques secondes." });
  return authRoutes(req, res, next);
});

function rewriteSiteUrlsToOrigin(source) {
  let out = String(source || "");
  for (const host of SERVED_SITE_HOSTS) out = out.split(`"${host}`).join("window.location.origin + \"");
  return out;
}

function sendRewrittenJs(fileName, res, next) {
  try {
    const scriptPath = path.join(PUBLIC_ROOT, fileName);
    res.type("application/javascript; charset=utf-8").send(rewriteSiteUrlsToOrigin(fs.readFileSync(scriptPath, "utf8")));
  } catch (error) {
    next(error);
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function absoluteSiteUrl(req) {
  const configured = String(process.env.SITE_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function buildCardSeoHtml(req, card) {
  const template = fs.readFileSync(path.join(PUBLIC_ROOT, "carte.html"), "utf8");
  const siteUrl = absoluteSiteUrl(req);
  const licenseSlug = card.license || card.licenseSlug || "pokemon";
  const canonical = `${siteUrl}/cartes/${encodeURIComponent(licenseSlug)}/${encodeURIComponent(card.slug)}`;
  const cardNumber = card.number ? ` ${card.number}` : "";
  const extension = card.extension || "Pokémon";
  const title = card.meta?.title || `${card.name}${cardNumber} — Prix, cote et rareté ${extension} | Cardoria`;
  const description = card.meta?.description || `Prix, cote, rareté et historique de ${card.name}${cardNumber}, carte de l'extension ${extension}. Consultez sa fiche complète sur Cardoria.`;
  const image = card.imageHd || card.imageThumb || `${siteUrl}/assets/logo/cardoria-premium.png`;
  const prices = card.prices || {};
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: card.name,
    description,
    image,
    url: canonical,
    sku: card.number || card.id,
    brand: { "@type": "Brand", name: card.licenseName || licenseSlug },
    category: "Carte à collectionner",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "EUR",
      lowPrice: Number(prices.low || prices.recommended || 0),
      highPrice: Number(prices.high || prices.recommended || 0),
      offerCount: Math.max(1, Number(card.salesCount || 1))
    }
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: card.licenseName || licenseSlug, item: `${siteUrl}/pages/licences/${encodeURIComponent(licenseSlug)}/` },
      { "@type": "ListItem", position: 3, name: card.name, item: canonical }
    ]
  };
  const seoHead = [
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<script>window.CARDORIA_CARD_ROUTE=${safeJson({ license: licenseSlug, slug: card.slug })};</script>`,
    `<script type="application/ld+json">${safeJson(product)}</script>`,
    `<script type="application/ld+json">${safeJson(breadcrumbs)}</script>`
  ].join("\n");

  return template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/i, `<meta name="description" content="${escapeHtml(description)}">`)
    .replace("</head>", `${seoHead}\n</head>`);
}

function sendCardSeoPage(req, res, next) {
  try {
    const card = getCardBySlug(req.params.license, req.params.slug);
    if (!card) return res.status(404).type("text/html; charset=utf-8").send("<!doctype html><html lang=\"fr\"><head><meta name=\"robots\" content=\"noindex\"><title>Carte introuvable | Cardoria</title></head><body><h1>Carte introuvable</h1><p><a href=\"/licence.html\">Retour au catalogue</a></p></body></html>");
    return res
      .status(200)
      .set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
      .type("text/html; charset=utf-8")
      .send(buildCardSeoHtml(req, card));
  } catch (error) {
    return next(error);
  }
}

function sendPublicFile(req, res, next) {
  let requestPath;
  try { requestPath = decodeURIComponent(req.path || "/"); } catch { return res.status(400).send("Requete invalide."); }
  if (requestPath.startsWith("/api/")) return next();
  if (requestPath === "/") return res.sendFile(path.join(PUBLIC_ROOT, "index.html"));

  let relativePath = requestPath.replace(/^\/+/, "");
  if (!relativePath || relativePath.includes("..")) return next();
  const firstSegment = relativePath.split("/")[0];
  if (BLOCKED_PUBLIC_ROOTS.has(firstSegment)) return res.status(404).send("Not found");
  if (requestPath.endsWith("/")) relativePath = path.posix.join(relativePath, "index.html");

  const extension = path.extname(relativePath).toLowerCase();
  if (!PUBLIC_EXTENSIONS.has(extension)) return next();
  const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);
  if (absolutePath !== PUBLIC_ROOT && !absolutePath.startsWith(PUBLIC_ROOT + path.sep)) return res.status(403).send("Forbidden");
  return res.sendFile(absolutePath, (error) => { if (!error) return; if (error.status === 404) return next(); return next(error); });
}

app.get(["/boutique", "/boutique/", "/pages/boutique", "/pages/boutique/"], (req, res) => res.redirect(308, "/boutique.html"));
app.get("/cartes/:license/:slug", sendCardSeoPage);
app.get("/carte.html", (req, res, next) => {
  if (!req.query.license || !req.query.slug) return next();
  return res.redirect(301, `/cartes/${encodeURIComponent(req.query.license)}/${encodeURIComponent(req.query.slug)}`);
});
app.get("/script.js", (req, res, next) => sendRewrittenJs("script.js", res, next));
app.get("/js/seo-config.js", (req, res, next) => sendRewrittenJs("js/seo-config.js", res, next));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  return sendPublicFile(req, res, next);
});

const port = process.env.PORT || 10000;
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Cardoria V6 port ${port} bound — initialization in progress`);
  console.log(`[startup] public root: ${PUBLIC_ROOT}`);
});

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

safeInit("auth-post-restore", migrateAuth);
authReady = true;
console.log("[startup] auth-routes: ready after persistence restore");

try {
  await import("./lib/engine/multilingual-bootstrap.js");
  console.log("[startup] multilingual-catalog: preload completed before provider sync");
} catch (error) {
  console.error("[startup] multilingual-catalog: preload failed", error?.message || String(error));
}

try {
  const pokemonSync = await syncPokemonCatalog();
  if (pokemonSync.skipped) console.log(`[startup] pokemon-catalog: already populated (${pokemonSync.count} cards)`);
  else {
    console.log(`[startup] pokemon-catalog: imported ${pokemonSync.imported} real cards from ${pokemonSync.source} (${pokemonSync.sets} sets)`);
    const saved = await flushEnginePersistence("tcgdex-pokemon-sync");
    if (!saved.ok) console.error("[startup] pokemon-catalog: persistence failed", saved.error || "unknown");
  }
} catch (error) {
  startup.ok = false;
  startup.degraded.push({ name: "pokemon-catalog", error: error?.message || String(error) });
  console.error("[startup] pokemon-catalog: degraded", error);
}

try {
  const referenceSync = await syncPokemonReferenceCatalog({ priceLimit: 0 });
  console.log(`[startup] pokemon-reference: ${referenceSync.rarityUpdated || 0} rarity mappings updated (${referenceSync.rarities || 0} rarities)`);
  const saved = await flushEnginePersistence("tcgdex-reference-rarities");
  if (!saved.ok) console.error("[startup] pokemon-reference: persistence failed", saved.error || "unknown");
} catch (error) {
  console.error("[startup] pokemon-reference: optional sync skipped", error?.message || String(error));
}

async function refreshMarketPrices(reason = "scheduled-market-refresh") {
  try {
    const result = await syncPokemonReferenceCatalog({ priceLimit: 120, skipRarities: true });
    console.log(`[market-prices] ${result.priced || 0} prices refreshed · ${result.rising || 0} up · ${result.falling || 0} down · ${result.stable || 0} stable`);
    const saved = await flushEnginePersistence(reason);
    if (!saved.ok) console.error("[market-prices] persistence failed", saved.error || "unknown");
  } catch (error) {
    console.error("[market-prices] refresh skipped", error?.message || String(error));
  }
}
const marketRefreshDelay = Math.max(60000, Number(process.env.MARKET_PRICE_REFRESH_DELAY_MS) || 120000);
const marketRefreshInterval = Math.max(3600000, Number(process.env.MARKET_PRICE_REFRESH_INTERVAL_MS) || 21600000);
const firstMarketRefresh = setTimeout(() => refreshMarketPrices("startup-market-refresh"), marketRefreshDelay);
firstMarketRefresh.unref?.();
const marketRefreshTimer = setInterval(() => refreshMarketPrices("scheduled-market-refresh"), marketRefreshInterval);
marketRefreshTimer.unref?.();

safeInit("market-data", initMarketData);
safeInit("scanner", initScanner);
safeInit("ai-enterprise", initAiEnterprise);
safeInit("ultimate", initUltimate);
safeInit("bigdata", initBigData);
safeInit("seo", initSeo);
safeInit("backup-scheduler", scheduleAutoBackup);
safeInit("launch", initLaunch);

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
app.use("/api/rachat", marketplacePersistenceMiddleware, apiRateLimit, rachatRoutes);
app.use("/api/admin", adminDashboardRoutes);
app.use("/api/admin/accounting", adminFinanceRoutes);
app.use("/api/admin/rachat", marketplacePersistenceMiddleware, rachatAdminRoutes);
app.use("/api/admin", adminUsersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/email", emailAdminRoutes);
app.use("/api/admin/development", developmentRoutes);
app.use("/api/admin/engine", enginePersistenceMiddleware, engineAdminRoutes);
app.use("/api/admin/marketplace", marketplacePersistenceMiddleware, marketplaceModerationAdminRoutes);
app.use("/api/admin/marketplace", marketplacePersistenceMiddleware, marketplaceAdminRoutes);
app.use("/api/admin/payments", marketplacePersistenceMiddleware, paymentsAdminRoutes);
app.use("/api/admin/seo", seoAdminRoutes);
app.use("/api/admin/ai", aiAdminRoutes);
app.use("/api/admin/market", marketAdminRoutes);
app.use("/api/admin/scanner", scannerAdminRoutes);
app.use("/api/admin/ai-enterprise", aiEnterpriseAdminRoutes);
app.use("/api/admin/ultimate", ultimateAdminRoutes);
app.use("/api/admin/bigdata", bigdataAdminRoutes);

app.use(errorHandler);

startup.ready = true;
console.log(`Cardoria V6 single-host ready — port ${port} — ${startup.ok ? "healthy" : "degraded"}`);

function shutdown(signal) {
  console.log(`[process] ${signal} received, closing HTTP server`);
  clearTimeout(firstMarketRefresh);
  clearInterval(marketRefreshTimer);
  const forceExit = setTimeout(() => process.exit(1), 10000); forceExit.unref();
  server.close(async () => {
    const enginePersisted = await flushEnginePersistence(`shutdown-${signal.toLowerCase()}`);
    const persisted = await flushMarketplacePersistence(`shutdown-${signal.toLowerCase()}`);
    if (!enginePersisted.ok) console.error("[cardoria-engine-persistence] shutdown flush failed");
    if (!persisted.ok) console.error("[cardoria-persistence] shutdown flush failed");
    try { await closeMarketplacePersistence(); } catch {}
    clearTimeout(forceExit); process.exit(persisted.ok && enginePersisted.ok ? 0 : 1);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));