/**
 * Générateurs de sitemaps Cardoria.
 *
 * Le catalogue peut contenir plusieurs dizaines de milliers de cartes :
 * on sépare donc les pages éditoriales et les cartes en plusieurs sitemaps
 * afin de rester largement sous la limite de 50 000 URL par fichier.
 */
import { listBlogPosts } from "./blog.js";
import { listExtensions, listGeneratedPages, SITE } from "./generator.js";
import { listLicenses } from "../engine/licenses.js";
import { getSitemapCards, getCardCount } from "../engine/cards.js";

export const CARD_SITEMAP_PAGE_SIZE = 10000;

const STATIC_PAGES = [
  { loc: "/", priority: "1.0", changefreq: "weekly" },
  { loc: "/boutique.html", priority: "0.9", changefreq: "daily" },
  { loc: "/estimation.html", priority: "0.9", changefreq: "weekly" },
  { loc: "/marketplace.html", priority: "0.9", changefreq: "daily" },
  { loc: "/rachat-cartes.html", priority: "0.85", changefreq: "weekly" },
  { loc: "/tendances.html", priority: "0.8", changefreq: "daily" },
  { loc: "/comparateur.html", priority: "0.75", changefreq: "weekly" },
  { loc: "/licence.html", priority: "0.85", changefreq: "daily" },
  { loc: "/referencement.html", priority: "0.8", changefreq: "monthly" },
  { loc: "/accessoires.html", priority: "0.75", changefreq: "weekly" },
  { loc: "/contact.html", priority: "0.7", changefreq: "monthly" },
  { loc: "/pages/faq/", priority: "0.8", changefreq: "monthly" },
  { loc: "/pages/a-propos/", priority: "0.7", changefreq: "monthly" },
  { loc: "/pages/mentions-legales/", priority: "0.3", changefreq: "yearly" },
  { loc: "/pages/confidentialite/", priority: "0.3", changefreq: "yearly" },
  { loc: "/pages/cgv/", priority: "0.4", changefreq: "yearly" },
  { loc: "/pages/blog/", priority: "0.85", changefreq: "weekly" },
  { loc: "/pages/licences/", priority: "0.9", changefreq: "weekly" },
  { loc: "/vendre.html", priority: "0.75", changefreq: "weekly" }
];

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeBase(siteUrl) {
  return String(siteUrl || SITE).replace(/\/$/, "");
}

function urlEntry(base, path, opts = {}) {
  const loc = path.startsWith("http") ? path : base + path;
  let xml = "  <url>\n    <loc>" + xmlEscape(loc) + "</loc>\n";
  if (opts.lastmod) xml += "    <lastmod>" + xmlEscape(opts.lastmod) + "</lastmod>\n";
  if (opts.changefreq) xml += "    <changefreq>" + opts.changefreq + "</changefreq>\n";
  if (opts.priority) xml += "    <priority>" + opts.priority + "</priority>\n";
  xml += "  </url>\n";
  return xml;
}

function sitemapEntry(base, path, lastmod) {
  let xml = "  <sitemap>\n    <loc>" + xmlEscape(base + path) + "</loc>\n";
  if (lastmod) xml += "    <lastmod>" + xmlEscape(lastmod) + "</lastmod>\n";
  xml += "  </sitemap>\n";
  return xml;
}

export function getCardSitemapPageCount(pageSize = CARD_SITEMAP_PAGE_SIZE) {
  const size = Math.max(1, Number(pageSize) || CARD_SITEMAP_PAGE_SIZE);
  const count = getCardCount();
  return count > 0 ? Math.ceil(count / size) : 0;
}

export function generateSitemapIndexXml(siteUrl = SITE) {
  const base = normalizeBase(siteUrl);
  const today = new Date().toISOString().slice(0, 10);
  let maps = sitemapEntry(base, "/api/seo/core.xml", today);
  const cardPages = getCardSitemapPageCount();
  for (let page = 1; page <= cardPages; page += 1) {
    maps += sitemapEntry(base, `/api/seo/cards-${page}.xml`, today);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps}</sitemapindex>`;
}

export function generateCoreSitemapXml(siteUrl = SITE) {
  const base = normalizeBase(siteUrl);
  const today = new Date().toISOString().slice(0, 10);
  let urls = "";

  STATIC_PAGES.forEach((page) => {
    urls += urlEntry(base, page.loc, { lastmod: today, changefreq: page.changefreq, priority: page.priority });
  });

  // Une seule URL canonique par licence : pas de doublon /licence.html?slug=...
  listLicenses().forEach((license) => {
    urls += urlEntry(base, `/pages/licences/${license.slug}/`, {
      lastmod: today,
      changefreq: "weekly",
      priority: "0.88"
    });
  });

  listExtensions().forEach((extension) => {
    if (!extension?.url) return;
    urls += urlEntry(base, extension.url, { lastmod: today, changefreq: "weekly", priority: "0.72" });
  });

  listBlogPosts({ publishedOnly: true, limit: 5000 }).forEach((post) => {
    if (!post?.url) return;
    urls += urlEntry(base, post.url, {
      lastmod: String(post.updatedAt || post.createdAt || today).slice(0, 10),
      changefreq: "monthly",
      priority: "0.75"
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>`;
}

export function generateCardsSitemapXml(siteUrl = SITE, page = 1, pageSize = CARD_SITEMAP_PAGE_SIZE) {
  const base = normalizeBase(siteUrl);
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(45000, Math.max(1, Number(pageSize) || CARD_SITEMAP_PAGE_SIZE));
  const offset = (safePage - 1) * safePageSize;
  const today = new Date().toISOString().slice(0, 10);
  let urls = "";

  getSitemapCards(safePageSize, offset).forEach((card) => {
    // Tant que la route historique est la route publique de la fiche, elle reste
    // l'unique URL canonique afin d'éviter de créer des doublons indexables.
    const cardUrl = `/carte.html?license=${encodeURIComponent(card.license_slug)}&slug=${encodeURIComponent(card.slug)}`;
    urls += urlEntry(base, cardUrl, {
      lastmod: String(card.updated_at || today).slice(0, 10),
      changefreq: "weekly",
      priority: "0.68"
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>`;
}

// Compatibilité avec les anciens appels internes : le sitemap principal est
// désormais un index, ce qui permet de couvrir tout le catalogue.
export function generateSitemapXml(siteUrl = SITE) {
  return generateSitemapIndexXml(siteUrl);
}

export function generateRobotsTxt(siteUrl = SITE) {
  const base = normalizeBase(siteUrl);
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /admin-",
    "Disallow: /admin.html",
    "Disallow: /admin-login.html",
    "Disallow: /mes-commandes.html",
    "Disallow: /favoris.html",
    "Disallow: /souhaits.html",
    "Disallow: /document-commande.html",
    "",
    "Sitemap: " + base + "/api/seo/sitemap.xml"
  ].join("\n");
}

export function getSitemapStats() {
  const cards = getCardCount();
  return {
    staticPages: STATIC_PAGES.length,
    licenses: listLicenses().length,
    extensions: listExtensions().length,
    blogPosts: listBlogPosts({ publishedOnly: true, limit: 5000 }).length,
    cards,
    cardSitemaps: cards > 0 ? Math.ceil(cards / CARD_SITEMAP_PAGE_SIZE) : 0,
    urlsPerCardSitemap: CARD_SITEMAP_PAGE_SIZE,
    generatedPages: listGeneratedPages({ limit: 10000 }).length
  };
}
