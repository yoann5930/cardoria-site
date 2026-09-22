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

export function isIndexableLicenseSitemapSlug(slug) {
  return PUBLIC_LICENSE_SITEMAP_SLUGS.has(String(slug || ""));
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
