/**
 * Générateur sitemap.xml automatique Cardoria.
 */
import { listBlogPosts } from "./blog.js";
import { listExtensions, listGeneratedPages, SITE } from "./generator.js";
import { listLicenses } from "../engine/licenses.js";
import { getSitemapCards, getCardCount } from "../engine/cards.js";

const STATIC_PAGES = [
  { loc: "/", priority: "1.0", changefreq: "weekly" },
  { loc: "/index.html", priority: "1.0", changefreq: "weekly" },
  { loc: "/boutique.html", priority: "0.9", changefreq: "daily" },
  { loc: "/pages/boutique/", priority: "0.9", changefreq: "daily" },
  { loc: "/estimation.html", priority: "0.9", changefreq: "weekly" },
  { loc: "/pages/estimation/", priority: "0.9", changefreq: "weekly" },
  { loc: "/marketplace.html", priority: "0.9", changefreq: "daily" },
  { loc: "/rachat-cartes.html", priority: "0.85", changefreq: "weekly" },
  { loc: "/tendances.html", priority: "0.8", changefreq: "daily" },
  { loc: "/comparateur.html", priority: "0.75", changefreq: "weekly" },
  { loc: "/licence.html", priority: "0.85", changefreq: "daily" },
  { loc: "/referencement.html", priority: "0.8", changefreq: "monthly" },
  { loc: "/accessoires.html", priority: "0.75", changefreq: "weekly" },
  { loc: "/contact.html", priority: "0.7", changefreq: "monthly" },
  { loc: "/pages/contact/", priority: "0.7", changefreq: "monthly" },
  { loc: "/pages/faq/", priority: "0.8", changefreq: "monthly" },
  { loc: "/pages/a-propos/", priority: "0.7", changefreq: "monthly" },
  { loc: "/pages/mentions-legales/", priority: "0.3", changefreq: "yearly" },
  { loc: "/pages/confidentialite/", priority: "0.3", changefreq: "yearly" },
  { loc: "/pages/cgv/", priority: "0.4", changefreq: "yearly" },
  { loc: "/pages/blog/", priority: "0.85", changefreq: "weekly" },
  { loc: "/pages/licences/", priority: "0.9", changefreq: "weekly" },
  { loc: "/vendre.html", priority: "0.75", changefreq: "weekly" }
];

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function urlEntry(base, path, opts = {}) {
  const loc = path.startsWith("http") ? path : base + path;
  let xml = "  <url>\n    <loc>" + xmlEscape(loc) + "</loc>\n";
  if (opts.lastmod) xml += "    <lastmod>" + opts.lastmod + "</lastmod>\n";
  if (opts.changefreq) xml += "    <changefreq>" + opts.changefreq + "</changefreq>\n";
  if (opts.priority) xml += "    <priority>" + opts.priority + "</priority>\n";
  xml += "  </url>\n";
  return xml;
}

export function generateSitemapXml(siteUrl = SITE) {
  const base = siteUrl.replace(/\/$/, "");
  const today = new Date().toISOString().slice(0, 10);
  let urls = "";

  STATIC_PAGES.forEach((p) => {
    urls += urlEntry(base, p.loc, { lastmod: today, changefreq: p.changefreq, priority: p.priority });
  });

  listLicenses().forEach((lic) => {
    urls += urlEntry(base, `/pages/licences/${lic.slug}/`, { lastmod: today, changefreq: "weekly", priority: "0.88" });
    urls += urlEntry(base, `/licence.html?slug=${lic.slug}`, { lastmod: today, changefreq: "daily", priority: "0.82" });
  });

  listExtensions().slice(0, 500).forEach((ext) => {
    urls += urlEntry(base, ext.url, { lastmod: today, changefreq: "weekly", priority: "0.7" });
  });

  listBlogPosts({ publishedOnly: true, limit: 200 }).forEach((post) => {
    urls += urlEntry(base, post.url, {
      lastmod: (post.updatedAt || post.createdAt || today).slice(0, 10),
      changefreq: "monthly",
      priority: "0.75"
    });
  });

  const cardLimit = 2000;
  const cards = getSitemapCards(cardLimit, 0);
  cards.forEach((c) => {
    urls += urlEntry(base, `/carte.html?license=${c.license_slug}&slug=${c.slug}`, {
      lastmod: (c.updated_at || today).slice(0, 10),
      changefreq: "weekly",
      priority: "0.65"
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>`;
}

export function generateRobotsTxt(siteUrl = SITE) {
  const base = siteUrl.replace(/\/$/, "");
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
    "Sitemap: " + base + "/sitemap.xml",
    "Sitemap: " + base + "/api/seo/sitemap.xml"
  ].join("\n");
}

export function getSitemapStats() {
  return {
    staticPages: STATIC_PAGES.length,
    licenses: listLicenses().length,
    extensions: listExtensions().length,
    blogPosts: listBlogPosts({ publishedOnly: true, limit: 1000 }).length,
    cards: getCardCount(),
    generatedPages: listGeneratedPages({ limit: 10000 }).length
  };
}
