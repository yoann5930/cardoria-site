/**
 * Slugs SEO annonces marketplace.
 */
import { getDb, slugify, normalizeText } from "../../engine/database.js";

export function makeListingSlug(title, listingId) {
  const base = slugify(title || listingId || "annonce").slice(0, 60) || "carte";
  const short = String(listingId || "").slice(-6).toLowerCase();
  return `${base}-${short}`.replace(/-+/g, "-");
}

export function ensureUniqueSlug(slug, listingId) {
  const db = getDb();
  let candidate = slug;
  let i = 0;
  while (true) {
    const row = db.prepare("SELECT id FROM mk_listings WHERE slug = ? AND id != ?").get(candidate, listingId || "");
    if (!row) return candidate;
    i++;
    candidate = `${slug}-${i}`;
  }
}

export function getListingBySlug(slug) {
  const row = getDb().prepare("SELECT * FROM mk_listings WHERE slug = ? AND status IN ('active','sold')").get(slug);
  if (!row) return null;
  return row;
}

export function buildListingSeoMeta(listing) {
  const title = listing.seo_title || `${listing.title} — Cardoria Marketplace`;
  const desc = listing.seo_description || (listing.description || "").slice(0, 155) ||
    `Achetez ${listing.title} (${listing.card_condition || "NM"}) sur Cardoria Marketplace.`;
  const image = (JSON.parse(listing.photos || "[]")[0]) || "";
  return { title, description: desc, image, slug: listing.slug };
}
