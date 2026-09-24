import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cleanSeoTemplate, renderCardMain, positivePrice, safeImage } from "./lib/seo/card-render.js";
import { buildCardSeoMeta } from "./lib/seo/card-meta.js";
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
import liveRoutes from "./routes/live.js";
import liveAdminRoutes from "./routes/live-admin.js";
import { seedEngineIfEmpty } from "./lib/engine/seed.js";
import { getCardBySlug, searchCards } from "./lib/engine/cards.js";
import { getLicense } from "./lib/engine/licenses.js";
import { syncPokemonCatalog, syncPokemonReferenceCatalog } from "./lib/engine/tcgdex-sync.js";
import { initMarketplace } from "./lib/marketplace/index.js";
import { getListingV1, getListingV1BySlug } from "./lib/marketplace/v1/listings.js";
import { initMarketplacePersistence, marketplacePersistenceMiddleware, enginePersistenceMiddleware, flushMarketplacePersistence, flushEnginePersistence, closeMarketplacePersistence } from "./lib/marketplace/persistence.js";
import { emptyPublicCatalogOnce } from "./lib/marketplace/empty-catalog.js";
import { getSeller } from "./lib/marketplace/sellers.js";
import { initAi } from "./lib/ai/index.js";
import { initSeo } from "./lib/seo/index.js";
import { getLicenseSeoContent, listExtensions } from "./lib/seo/generator.js";
import { generateSitemapXml, generateRobotsTxt } from "./lib/seo/sitemap.js";
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
import { cleanupLegacyLiveTestsOnce } from "./lib/live/cleanup-tests.js";
import { promoteDueScheduledLiveSessions } from "./lib/live/sessions.js";
import { reconcileStaleLiveCheckouts } from "./lib/live/payment-reconciliation.js";
import { initLaunch, connectionJournalMiddleware, maintenanceMiddleware } from "./lib/launch/index.js";
import systemRoutes from "./routes/system.js";
import sendcloudRoutes from "./routes/sendcloud.js";
import mondialRelayRoutes from "./routes/mondial-relay.js";
import colissimoRoutes from "./routes/colissimo.js";
import "./lib/engine/pokemon-multisource-schedule.js";
import locationRoutes from "./routes/location.js";

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
  "https://cardoria.vercel.app",
  "https://www.cardoriashop.fr",
  "https://cardoriashop.fr"
];
const liveTestCleanup = cleanupLegacyLiveTestsOnce();
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
app.use("/api/sendcloud", sendcloudRoutes);
app.use("/api/mondial-relay", mondialRelayRoutes);
app.use("/api/colissimo", colissimoRoutes);
app.use("/api/location", locationRoutes);

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

function absoluteSiteUrl() {
  return "https://www.cardoriashop.fr";
}

function seoHead({ title, description, canonical, image, type = "website", jsonLd = [], bootstrap = "" }) {
  const parts = [
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">`,
    `<meta property="og:type" content="${escapeHtml(type)}">`,
    `<meta property="og:site_name" content="Cardoria">`,
    `<meta property="og:locale" content="fr_FR">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`
  ];
  if (bootstrap) parts.push(`<script>${bootstrap}</script>`);
  for (const item of jsonLd) parts.push(`<script type="application/ld+json">${safeJson(item)}</script>`);
  return parts.join("\n");
}

function injectSeoIntoTemplate(template, { title, description, head, mainHtml, mainPattern }) {
  const metaDescription = `<meta name="description" content="${escapeHtml(description)}">`;
  let html = cleanSeoTemplate(template)
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`);

  if (/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i, () => metaDescription);
  } else {
    html = html.replace("</head>", () => `${metaDescription}\n</head>`);
  }

  html = html.replace("</head>", () => `${head}\n</head>`);
  if (mainPattern && mainHtml) html = html.replace(mainPattern, () => mainHtml);
  return html;
}

function buildCardSeoHtml(req, card) {
  const template = fs.readFileSync(path.join(PUBLIC_ROOT, "carte.html"), "utf8");
  const siteUrl = absoluteSiteUrl(req);
  const licenseSlug = card.license || card.licenseSlug || "pokemon";
  const canonical = `${siteUrl}/cartes/${encodeURIComponent(licenseSlug)}/${encodeURIComponent(card.slug)}`;
  const extension = card.extension || "Pokémon";
  const seoMeta = buildCardSeoMeta(card);
  const title = String(card.meta?.title || seoMeta.title);
  const description = String(card.meta?.description || seoMeta.description);
  const image = safeImage(card.imageHd) || safeImage(card.imageThumb) || `${siteUrl}/assets/logo/cardoria-premium.png`;
  const prices = card.prices || {};
  const recommended = positivePrice(prices.recommended);
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
    additionalProperty: [
      { "@type": "PropertyValue", name: "Extension", value: extension },
      { "@type": "PropertyValue", name: "Rareté", value: card.rarity || "Non renseignée" },
      ...(recommended === null ? [] : [{ "@type": "PropertyValue", name: "Prix conseillé", value: recommended, unitText: "EUR" }])
    ]
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
  const head = seoHead({
    title,
    description,
    canonical,
    image,
    type: "product",
    bootstrap: `window.CARDORIA_CARD_ROUTE=${safeJson({ license: licenseSlug, slug: card.slug })};`,
    jsonLd: [product, breadcrumbs]
  });
  return injectSeoIntoTemplate(template, {
    title, description, head,
    mainHtml: renderCardMain(card),
    mainPattern: /<main\b[^>]*\bid="cardPage"[^>]*>[\s\S]*?<\/main>/i
  });
}

function sendCardSeoPage(req, res, next) {
  try {
    const card = getCardBySlug(req.params.license, req.params.slug);
    if (!card) return res.status(404).type("text/html; charset=utf-8").send("<!doctype html><html lang=\"fr\"><head><meta name=\"robots\" content=\"noindex\"><title>Carte introuvable | Cardoria</title></head><body><h1>Carte introuvable</h1><p><a href=\"/pages/licences/\">Retour au catalogue</a></p></body></html>");
    return res
      .status(200)
      .set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
      .type("text/html; charset=utf-8")
      .send(buildCardSeoHtml(req, card));
  } catch (error) {
    return next(error);
  }
}

function buildLicenseSeoHtml(req, licenseSlug) {
  if (!/^[a-z0-9-]+$/.test(licenseSlug)) return null;
  const templatePath = path.join(PUBLIC_ROOT, "pages", "licences", licenseSlug, "index.html");
  if (!fs.existsSync(templatePath)) return null;
  const license = getLicense(licenseSlug);
  if (!license) return null;
  const template = fs.readFileSync(templatePath, "utf8");
  const siteUrl = absoluteSiteUrl(req);
  const canonical = `${siteUrl}/pages/licences/${encodeURIComponent(licenseSlug)}/`;
  const page = getLicenseSeoContent(licenseSlug);
  const title = page.title || `${license.name} TCG — Prix, cote & catalogue | Cardoria`;
  const description = page.metaDescription || `Catalogue ${license.name} : cartes, extensions, prix, cote et estimation sur Cardoria.`;
  const image = `${siteUrl}/assets/logo/cardoria-premium.png`;
  const cards = searchCards({ license: licenseSlug, page: 1, limit: 12, sort: "views", maxLimit: 50 }).cards;
  const extensions = listExtensions(licenseSlug).slice(0, 40);
  const extensionLinks = extensions.map((ext) => `<a href="/extensions/${encodeURIComponent(licenseSlug)}/${encodeURIComponent(ext.slug)}">${escapeHtml(ext.extension)} (${Number(ext.cardCount || 0)})</a>`).join("");
  const cardLinks = cards.map((card) => {
    const alt = `${card.name} — ${card.extension} ${card.number || ""}`.trim();
    const visual = card.imageThumb ? `<img src="${escapeHtml(card.imageThumb)}" alt="${escapeHtml(alt)}" loading="lazy" width="200" height="280">` : "<span aria-hidden=\"true\">🃏</span>";
    return `<a class="seo-card" href="/cartes/${encodeURIComponent(card.license || licenseSlug)}/${encodeURIComponent(card.slug)}">${visual}<h3>${escapeHtml(card.name)}</h3><p>${escapeHtml(card.extension)}</p></a>`;
  }).join("");
  const mainHtml = `<main class="container seo-page" id="licenceSeoRoot" data-slug="${escapeHtml(licenseSlug)}">
    <nav class="engine-breadcrumb" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › <a href="/pages/licences/">Licences</a> › ${escapeHtml(license.name)}</nav>
    <h1>${escapeHtml(page.h1 || `Cartes ${license.name}`)}</h1>
    <p class="seo-lead">${escapeHtml(page.content?.intro || description)}</p>
    <div class="seo-links"><a href="/estimation.html">Estimer une carte ${escapeHtml(license.name)}</a><a href="/rachat-cartes.html">Vendre à Cardoria</a><a href="/marketplace.html">Marketplace</a></div>
    <section class="seo-section"><h2>Extensions ${escapeHtml(license.name)}</h2><p>Parcourez les extensions pour accéder aux listes de cartes, numéros, raretés et fiches détaillées.</p><div class="seo-links">${extensionLinks || "<span>Catalogue en cours de référencement.</span>"}</div></section>
    <section class="seo-section"><h2>Cartes ${escapeHtml(license.name)} référencées</h2><div class="seo-grid">${cardLinks || "<p>Catalogue en cours de synchronisation.</p>"}</div></section>
    <section class="seo-section"><h2>Prix, cote et estimation</h2><p>Les fiches Cardoria regroupent les informations disponibles pour identifier une carte, son extension, son numéro, sa rareté et ses données de prix. Utilisez ensuite l'espace estimation pour analyser une carte que vous possédez.</p></section>
  </main>`;
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Licences", item: `${siteUrl}/pages/licences/` },
      { "@type": "ListItem", position: 3, name: license.name, item: canonical }
    ]
  };
  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: page.h1 || title,
    description,
    url: canonical,
    inLanguage: "fr-FR",
    isPartOf: { "@type": "WebSite", name: "Cardoria", url: siteUrl }
  };
  const head = seoHead({ title, description, canonical, image, jsonLd: [collection, breadcrumbs] });
  return injectSeoIntoTemplate(template, {
    title,
    description,
    head,
    mainHtml,
    mainPattern: /<main class="container seo-page" id="licenceSeoRoot"[^>]*>[\s\S]*?<\/main>/i
  });
}

function sendLicenseSeoPage(req, res, next) {
  try {
    const html = buildLicenseSeoHtml(req, req.params.license);
    if (!html) return res.status(404).type("text/html; charset=utf-8").send("<!doctype html><html lang=\"fr\"><head><meta name=\"robots\" content=\"noindex\"><title>Licence introuvable | Cardoria</title></head><body><h1>Licence introuvable</h1></body></html>");
    return res.status(200).set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600").type("text/html; charset=utf-8").send(html);
  } catch (error) {
    return next(error);
  }
}

function buildExtensionSeoHtml(req, licenseSlug, extensionSlug) {
  if (!/^[a-z0-9-]+$/.test(licenseSlug) || !/^[a-z0-9-]+$/.test(extensionSlug)) return null;
  const license = getLicense(licenseSlug);
  if (!license) return null;
  const extension = listExtensions(licenseSlug).find((item) => item.slug === extensionSlug);
  if (!extension) return null;
  const templatePath = path.join(PUBLIC_ROOT, "pages", "extension", "index.html");
  if (!fs.existsSync(templatePath)) return null;
  const template = fs.readFileSync(templatePath, "utf8");
  const siteUrl = absoluteSiteUrl(req);
  const canonical = `${siteUrl}/extensions/${encodeURIComponent(licenseSlug)}/${encodeURIComponent(extensionSlug)}`;
  const title = `${extension.extension} — cartes, prix & liste ${license.name} | Cardoria`;
  const description = `Découvrez les cartes ${extension.extension} (${license.name}) : liste, numéros, raretés et données de prix. ${extension.cardCount} cartes référencées sur Cardoria.`;
  const image = `${siteUrl}/assets/logo/cardoria-premium.png`;
  const cards = searchCards({ license: licenseSlug, extension: extension.extension, page: 1, limit: 36, sort: "extension", maxLimit: 50 }).cards;
  const cardLinks = cards.map((card) => {
    const alt = `${card.name} — ${card.extension} ${card.number || ""}`.trim();
    const visual = card.imageThumb ? `<img src="${escapeHtml(card.imageThumb)}" alt="${escapeHtml(alt)}" loading="lazy" width="200" height="280">` : "<span aria-hidden=\"true\">🃏</span>";
    return `<a class="seo-card" href="/cartes/${encodeURIComponent(card.license || licenseSlug)}/${encodeURIComponent(card.slug)}">${visual}<h3>${escapeHtml(card.name)}</h3><p>${escapeHtml(card.number || "")}</p></a>`;
  }).join("");
  const mainHtml = `<main class="container seo-page" id="extensionRoot">
    <nav class="engine-breadcrumb" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › <a href="/pages/licences/${encodeURIComponent(licenseSlug)}/">${escapeHtml(license.name)}</a> › ${escapeHtml(extension.extension)}</nav>
    <h1>Cartes ${escapeHtml(extension.extension)} — ${escapeHtml(license.name)}</h1>
    <p class="seo-lead">Liste des cartes de l'extension ${escapeHtml(extension.extension)} : numéros, raretés, visuels et données de prix disponibles sur Cardoria. ${Number(extension.cardCount || 0)} cartes sont actuellement référencées.</p>
    <div class="seo-links"><a href="/pages/licences/${encodeURIComponent(licenseSlug)}/">Toutes les extensions ${escapeHtml(license.name)}</a><a href="/estimation.html">Estimer une carte</a><a href="/marketplace.html">Marketplace</a></div>
    <section class="seo-section"><h2>Liste des cartes ${escapeHtml(extension.extension)}</h2><div class="seo-grid">${cardLinks || "<p>Catalogue en cours de synchronisation.</p>"}</div></section>
    <section class="seo-section"><h2>Prix et cote de l'extension ${escapeHtml(extension.extension)}</h2><p>Ouvrez une fiche carte pour consulter les informations disponibles sur son numéro, sa rareté, son image et ses données de prix. Les valeurs peuvent évoluer avec le marché et l'état réel de la carte.</p></section>
  </main>`;
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: license.name, item: `${siteUrl}/pages/licences/${encodeURIComponent(licenseSlug)}/` },
      { "@type": "ListItem", position: 3, name: extension.extension, item: canonical }
    ]
  };
  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Cartes ${extension.extension} — ${license.name}`,
    description,
    url: canonical,
    inLanguage: "fr-FR",
    numberOfItems: Number(extension.cardCount || cards.length),
    isPartOf: { "@type": "WebSite", name: "Cardoria", url: siteUrl }
  };
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Cartes ${extension.extension}`,
    numberOfItems: Number(extension.cardCount || cards.length),
    itemListElement: cards.slice(0, 36).map((card, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: card.name,
      url: `${siteUrl}/cartes/${encodeURIComponent(card.license || licenseSlug)}/${encodeURIComponent(card.slug)}`
    }))
  };
  const head = seoHead({
    title,
    description,
    canonical,
    image,
    bootstrap: `window.CARDORIA_EXTENSION_ROUTE=${safeJson({ license: licenseSlug, ext: extensionSlug })};`,
    jsonLd: [collection, breadcrumbs, itemList]
  });
  return injectSeoIntoTemplate(template, {
    title,
    description,
    head,
    mainHtml,
    mainPattern: /<main class="container seo-page" id="extensionRoot">[\s\S]*?<\/main>/i
  });
}

function sendExtensionSeoPage(req, res, next) {
  try {
    const html = buildExtensionSeoHtml(req, req.params.license, req.params.slug);
    if (!html) return res.status(404).type("text/html; charset=utf-8").send("<!doctype html><html lang=\"fr\"><head><meta name=\"robots\" content=\"noindex\"><title>Extension introuvable | Cardoria</title></head><body><h1>Extension introuvable</h1></body></html>");
    return res.status(200).set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600").type("text/html; charset=utf-8").send(html);
  } catch (error) {
    return next(error);
  }
}

function buildMarketplaceListingSeoHtml(req, slug) {
  if (!/^[a-z0-9-]+$/.test(String(slug || ""))) return null;
  const listing = getListingV1BySlug(slug);
  if (!listing || listing.status !== "active" || listing.moderationLocked || Number(listing.stock || 0) <= 0) return null;

  const templatePath = path.join(PUBLIC_ROOT, "annonce.html");
  if (!fs.existsSync(templatePath)) return null;
  const template = fs.readFileSync(templatePath, "utf8");
  const siteUrl = absoluteSiteUrl(req);
  const canonical = `${siteUrl}/annonces/${encodeURIComponent(slug)}`;
  const price = positivePrice(listing.price);
  const priceLabel = price == null ? "" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(price);
  const title = listing.seo?.title || `${listing.title}${priceLabel ? " — " + priceLabel : ""} | Cardoria Marketplace`;
  const description = listing.seo?.description || `${listing.title} en état ${listing.condition || "non précisé"} sur Cardoria Marketplace.`;
  const image = safeImage(listing.photos?.[0]) || `${siteUrl}/assets/logo/cardoria-premium.png`;
  const sellerName = listing.seller?.displayName || "Vendeur Cardoria";
  const availability = Number(listing.stock || 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description,
    image: [image],
    sku: listing.id,
    category: listing.license || "Trading Card",
    offers: price == null ? undefined : {
      "@type": "Offer",
      url: canonical,
      priceCurrency: "EUR",
      price,
      availability,
    }
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Marketplace", item: `${siteUrl}/marketplace.html` },
      { "@type": "ListItem", position: 3, name: listing.title, item: canonical }
    ]
  };
  const visual = image ? `<img id="mainPhoto" src="${escapeHtml(image)}" alt="${escapeHtml(listing.title)}" width="560" height="560">` : "";
  const mainHtml = `<main class="container mk-page" id="listingPage">
    <nav class="engine-breadcrumb" aria-label="Fil d'Ariane"><a href="/">Accueil</a> › <a href="/marketplace.html">Marketplace</a> › ${escapeHtml(listing.title)}</nav>
    <div class="mk-detail">
      <div><div class="mk-gallery"><div class="mk-gallery-main">${visual}</div></div></div>
      <div>
        <h1>${escapeHtml(listing.title)}</h1>
        <p style="color:#baaf97">${escapeHtml(listing.description || description)}</p>
        <p><strong>État :</strong> ${escapeHtml(listing.condition || "—")} · <strong>Licence :</strong> ${escapeHtml(listing.license || "—")} · <strong>Stock :</strong> ${Number(listing.stock || 0)}</p>
        ${priceLabel ? `<div class="mk-buy-box"><div class="mk-price-big">${escapeHtml(priceLabel)}</div></div>` : ""}
        <p><strong>Vendeur :</strong> ${escapeHtml(sellerName)}</p>
        <p><a href="/marketplace.html">Voir les autres annonces Cardoria Marketplace</a></p>
      </div>
    </div>
  </main>`;
  const head = seoHead({ title, description, canonical, image, type: "product", jsonLd: [product, breadcrumbs] });
  return injectSeoIntoTemplate(template, {
    title,
    description,
    head,
    mainHtml,
    mainPattern: /<main class="container mk-page" id="listingPage">[\s\S]*?<\/main>/i
  });
}

function sendMarketplaceListingSeoPage(req, res, next) {
  try {
    const html = buildMarketplaceListingSeoHtml(req, req.params.slug);
    if (!html) return res.status(404).type("text/html; charset=utf-8").send("<!doctype html><html lang=\"fr\"><head><meta name=\"robots\" content=\"noindex\"><title>Annonce introuvable | Cardoria</title></head><body><h1>Annonce introuvable</h1><p><a href=\"/marketplace.html\">Retour à la Marketplace</a></p></body></html>");
    return res.status(200).set("Cache-Control", "public, max-age=180, stale-while-revalidate=900").type("text/html; charset=utf-8").send(html);
  } catch (error) {
    return next(error);
  }
}

const ALWAYS_REVALIDATE_PUBLIC_PATHS = new Set([
  "/live.html",
  "/client-login.html",
  "/admin-live.html",
  "/js/cardoria-live-actions.js",
  "/js/cardoria-live-viewer.js",
  "/js/cardoria-live-publisher.js",
  "/js/client-auth.js",
  "/js/admin/admin-live.js",
  "/css/client-auth.css"
]);

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
  if (ALWAYS_REVALIDATE_PUBLIC_PATHS.has(requestPath)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  return res.sendFile(absolutePath, (error) => { if (!error) return; if (error.status === 404) return next(); return next(error); });
}

app.get(["/boutique", "/boutique/", "/pages/boutique", "/pages/boutique/"], (req, res) => res.redirect(308, "/boutique.html"));
app.get(["/estimation", "/estimation/", "/pages/estimation", "/pages/estimation/"], (req, res) => res.redirect(308, "/estimation.html"));
app.get("/index.html", (req, res) => res.redirect(301, "/"));
app.get("/cartes/:license/:slug", sendCardSeoPage);
app.get("/annonces/:slug", sendMarketplaceListingSeoPage);
app.get("/annonce.html", (req, res, next) => {
  if (req.query.slug) return res.redirect(301, `/annonces/${encodeURIComponent(req.query.slug)}`);
  if (req.query.id) {
    const listing = getListingV1(String(req.query.id));
    if (listing?.slug) return res.redirect(301, `/annonces/${encodeURIComponent(listing.slug)}`);
  }
  return next();
});
app.get("/carte.html", (req, res, next) => {
  if (!req.query.license || !req.query.slug) return next();
  return res.redirect(301, `/cartes/${encodeURIComponent(req.query.license)}/${encodeURIComponent(req.query.slug)}`);
});
app.get("/pages/licences/:license", (req, res, next) => {
  // Express matches an optional trailing slash: do not redirect the canonical URL to itself.
  if (req.path.endsWith("/")) return next();
  return res.redirect(308, `/pages/licences/${encodeURIComponent(req.params.license)}/`);
});
app.get("/pages/licences/:license/", sendLicenseSeoPage);
app.get("/extensions/:license/:slug", sendExtensionSeoPage);
app.get(["/pages/extension", "/pages/extension/"], (req, res, next) => {
  if (!req.query.license || !req.query.ext) return next();
  return res.redirect(301, `/extensions/${encodeURIComponent(req.query.license)}/${encodeURIComponent(req.query.ext)}`);
});
app.get("/robots.txt", (req, res) => {
  res.type("text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(generateRobotsTxt(absoluteSiteUrl(req)));
});
app.get(["/sitemap.xml", "/sitemap-index.xml"], (req, res) => {
  res.type("application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(generateSitemapXml(absoluteSiteUrl(req)));
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

function promoteScheduledLives() {
  try {
    const result = promoteDueScheduledLiveSessions({
      canStart: (session) => session.ownerRole !== "seller" || Boolean(getSeller(session.ownerId)?.senderReady)
    });
    if (result.promoted.length) console.log(`[live-schedule] started: ${result.promoted.join(", ")}`);
    if (result.blocked.length) console.warn(`[live-schedule] blocked seller profile: ${result.blocked.join(", ")}`);
    if (result.invalid.length) console.error(`[live-schedule] invalid schedule: ${result.invalid.join(", ")}`);
  } catch (error) {
    console.error("[live-schedule] scheduler error", error?.message || String(error));
  }
}
const liveScheduleIntervalMs = Math.max(1000, Number(process.env.LIVE_SCHEDULE_INTERVAL_MS) || 5000);
promoteScheduledLives();
const liveScheduleTimer = setInterval(promoteScheduledLives, liveScheduleIntervalMs);
liveScheduleTimer.unref?.();

async function reconcileStaleLivePayments() {
  try {
    const result = await reconcileStaleLiveCheckouts();
    if (result.checked) console.log(`[live-payment] stale checkouts=${result.checked} released=${result.released} settled=${result.settled} deferred=${result.deferred}`);
  } catch (error) {
    console.error("[live-payment] stale reconciliation error", error?.message || String(error));
  }
}
const livePaymentReconcileIntervalMs = Math.max(30000, Number(process.env.LIVE_PAYMENT_RECONCILE_INTERVAL_MS) || 60000);
const livePaymentReconcileTimer = setInterval(() => { void reconcileStaleLivePayments(); }, livePaymentReconcileIntervalMs);
livePaymentReconcileTimer.unref?.();

const skipCatalogPreload = process.env.NODE_ENV === "test";
if (skipCatalogPreload) {
  console.log("[startup] catalog-preload: skipped in test");
} else {
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
app.use("/api/live", marketplacePersistenceMiddleware, apiRateLimit, liveRoutes);
app.use("/api/seo", apiRateLimit, seoRoutes);

app.use("/api/estimation-carte", (req, res, next) => {
  if (req.method !== "POST") return next();
  if (req.path.startsWith("/capture/")) return apiRateLimit(req, res, next);
  return aiRateLimit(req, res, next);
}, estimationRoutes);
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
app.use("/api/admin/live", liveAdminRoutes);
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
  clearInterval(liveScheduleTimer);
  clearInterval(livePaymentReconcileTimer);
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