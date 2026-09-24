/**
 * Rules for URLs that may appear in public sitemaps.
 * Keep this module free of database I/O so tests can import it directly.
 */
export const SITE = "https://www.cardoriashop.fr";

// Must match a real public template under pages/licences/<slug>/index.html.
// Catalog-only licenses (for example starwars) stay out of the sitemap until a page exists.
export const PUBLIC_LICENSE_SITEMAP_SLUGS = new Set([
  "pokemon",
  "yugioh",
  "onepiece",
  "lorcana",
  "magic",
  "dragonball",
  "sports"
]);

export function slugifyExtensionName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const TECHNICAL_NOINDEX_PATHS = [
  "/live-vendeur.html",
  "/live-camera.html",
  "/marketplace-paiement-succes.html",
  "/marketplace-paiement-echec.html"
];

export function isTechnicalNoindexPath(pathname = "") {
  const path = String(pathname || "").split("?")[0].toLowerCase();
  return TECHNICAL_NOINDEX_PATHS.some((item) => path === item || path.endsWith(item));
}

export function isCrawlableSitemapPath(pathname = "") {
  const path = String(pathname || "").split("?")[0].toLowerCase();
  if (path === "/robots.txt" || path === "/sitemap.xml" || path === "/sitemap-index.xml") return true;
  if (/^\/api\/seo\/.+\.xml$/.test(path)) return true;
  return /\/sitemap\.xml$/.test(path) && !path.startsWith("/admin");
}

// A missing card count means "the public template exists".
// Sitemap generation always passes the live count so an empty licence drops out
// and returns automatically once real cards are linked.
export function isIndexableLicenseSitemapSlug(slug, cardCount) {
  if (!PUBLIC_LICENSE_SITEMAP_SLUGS.has(String(slug || ""))) return false;
  if (arguments.length < 2) return true;
  return Number(cardCount) > 0;
}

export function sitemapImageLoc(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function extensionSitemapEntry(row = {}) {
  const extension = row.extension;
  const slug = slugifyExtensionName(extension);
  const license = String(row.license || row.license_slug || "").trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || !/^[a-z0-9-]+$/.test(license)) return null;
  return {
    extension,
    license,
    cardCount: row.cardCount ?? row.card_count,
    slug,
    url: `/extensions/${encodeURIComponent(license)}/${encodeURIComponent(slug)}`
  };
}

export function isIndexableExtensionSitemapEntry(entry) {
  const url = String(entry?.url || "");
  if (!url.startsWith("/extensions/")) return false;
  const path = url.split("?")[0].replace(/\/$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts.length === 3
    && parts[0] === "extensions"
    && /^[a-z0-9-]+$/.test(parts[1] || "")
    && /^[a-z0-9-]+$/.test(parts[2] || "");
}
