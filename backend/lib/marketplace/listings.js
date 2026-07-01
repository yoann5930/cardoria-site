/**
 * Annonces marketplace — stock, photos, état, prix fixe/négociable.
 */
import { getDb } from "../engine/database.js";
import { normalizeText } from "../engine/database.js";
import { makeMarketId, syncListingFts } from "./migrate.js";
import { getSeller } from "./sellers.js";

function parsePhotos(raw) {
  try { return JSON.parse(raw || "[]"); } catch { return []; }
}

function rowToListing(row, extras = {}) {
  const seller = row.seller_id ? getSeller(row.seller_id) : null;
  return {
    id: row.id,
    sellerId: row.seller_id,
    seller: seller ? {
      id: seller.id,
      displayName: seller.displayName,
      verified: seller.verified,
      ratingAvg: seller.ratingAvg,
      salesCount: seller.salesCount
    } : null,
    cardId: row.card_id,
    title: row.title,
    license: row.license_slug,
    description: row.description,
    condition: row.card_condition,
    price: row.price,
    negotiable: !!row.negotiable,
    stock: row.stock,
    photos: parsePhotos(row.photos),
    status: row.status,
    views: row.views,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras
  };
}

export function createListing(data) {
  const db = getDb();
  if (!getSeller(data.sellerId)) throw new Error("Vendeur introuvable");
  const id = makeMarketId("LST");
  const now = new Date().toISOString();
  const photos = JSON.stringify((data.photos || []).slice(0, 8));
  db.prepare(`
    INSERT INTO mk_listings (
      id, seller_id, card_id, title, title_normalized, license_slug, description,
      card_condition, price, negotiable, stock, photos, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    id, data.sellerId, data.cardId || null, data.title, normalizeText(data.title),
    data.license || "", data.description || "", data.condition || "NM",
    Number(data.price), data.negotiable ? 1 : 0, Math.max(1, Number(data.stock) || 1),
    photos, now, now
  );
  const row = db.prepare("SELECT rowid, * FROM mk_listings WHERE id = ?").get(id);
  syncListingFts(row.rowid, row);
  return getListing(id);
}

export function getListing(id, { trackView = false } = {}) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM mk_listings WHERE id = ?").get(id);
  if (!row) return null;
  if (trackView) db.prepare("UPDATE mk_listings SET views = views + 1 WHERE id = ?").run(id);
  return rowToListing(row);
}

export function updateListing(id, sellerId, data) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM mk_listings WHERE id = ? AND seller_id = ?").get(id, sellerId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const title = data.title ?? existing.title;
  db.prepare(`
    UPDATE mk_listings SET
      title = ?, title_normalized = ?, description = ?, card_condition = ?,
      price = ?, negotiable = ?, stock = ?, photos = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    title, normalizeText(title), data.description ?? existing.description,
    data.condition ?? existing.card_condition, Number(data.price ?? existing.price),
    data.negotiable != null ? (data.negotiable ? 1 : 0) : existing.negotiable,
    Math.max(0, Number(data.stock ?? existing.stock)),
    data.photos ? JSON.stringify(data.photos.slice(0, 8)) : existing.photos,
    data.status ?? existing.status, now, id
  );
  const row = db.prepare("SELECT rowid, * FROM mk_listings WHERE id = ?").get(id);
  syncListingFts(row.rowid, row);
  return getListing(id);
}

export function deleteListing(id, sellerId) {
  const db = getDb();
  const row = db.prepare("SELECT rowid FROM mk_listings WHERE id = ? AND seller_id = ?").get(id, sellerId);
  if (!row) return false;
  try { db.prepare("DELETE FROM mk_listings_fts WHERE rowid = ?").run(row.rowid); } catch { /* */ }
  db.prepare("UPDATE mk_listings SET status = 'removed', stock = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return true;
}

export function searchListings({
  q = "", license = "", condition = "", minPrice, maxPrice, negotiable,
  sellerId = "", page = 1, limit = 24, sort = "recent"
} = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  if (q && q.length >= 2) {
    const fts = searchListingsFts(db, q, { license, condition, minPrice, maxPrice, negotiable, sellerId, safeLimit, offset, sort });
    if (fts) return fts;
  }

  const conds = ["l.status = 'active'", "l.stock > 0"];
  const params = [];
  if (license) { conds.push("l.license_slug = ?"); params.push(license); }
  if (condition) { conds.push("l.card_condition = ?"); params.push(condition); }
  if (sellerId) { conds.push("l.seller_id = ?"); params.push(sellerId); }
  if (negotiable === "1" || negotiable === true) { conds.push("l.negotiable = 1"); }
  if (minPrice != null) { conds.push("l.price >= ?"); params.push(Number(minPrice)); }
  if (maxPrice != null) { conds.push("l.price <= ?"); params.push(Number(maxPrice)); }
  if (q) {
    conds.push("(l.title_normalized LIKE ? OR l.description LIKE ?)");
    const like = `%${normalizeText(q)}%`;
    params.push(like, like);
  }

  const where = "WHERE " + conds.join(" AND ");
  const order = sortOrder(sort);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM mk_listings l ${where}`).get(...params)?.c ?? 0;
  const rows = db.prepare(`SELECT l.* FROM mk_listings l ${where} ${order} LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);

  return {
    listings: rows.map((r) => rowToListing(r)),
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) || 1 }
  };
}

function searchListingsFts(db, q, opts) {
  try {
    const ftsQ = normalizeText(q).split(/\s+/).filter(Boolean).map((t) => `"${t}"*`).join(" AND ");
    const conds = ["mk_listings_fts MATCH ?", "l.status = 'active'", "l.stock > 0"];
    const params = [ftsQ];
    if (opts.license) { conds.push("l.license_slug = ?"); params.push(opts.license); }
    if (opts.condition) { conds.push("l.card_condition = ?"); params.push(opts.condition); }
    if (opts.sellerId) { conds.push("l.seller_id = ?"); params.push(opts.sellerId); }
    const where = "WHERE " + conds.join(" AND ");
    const order = sortOrder(opts.sort);
    const total = db.prepare(`
      SELECT COUNT(*) AS c FROM mk_listings l
      INNER JOIN mk_listings_fts ON mk_listings_fts.rowid = l.rowid ${where}
    `).get(...params)?.c ?? 0;
    const rows = db.prepare(`
      SELECT l.* FROM mk_listings l
      INNER JOIN mk_listings_fts ON mk_listings_fts.rowid = l.rowid
      ${where} ${order} LIMIT ? OFFSET ?
    `).all(...params, opts.safeLimit, opts.offset);
    return {
      listings: rows.map((r) => rowToListing(r)),
      pagination: { page: Math.floor(opts.offset / opts.safeLimit) + 1, limit: opts.safeLimit, total, pages: Math.ceil(total / opts.safeLimit) || 1 },
      searchEngine: "fts5"
    };
  } catch { return null; }
}

function sortOrder(sort) {
  const m = {
    recent: "ORDER BY l.created_at DESC",
    price_asc: "ORDER BY l.price ASC",
    price: "ORDER BY l.price DESC",
    popular: "ORDER BY l.views DESC"
  };
  return m[sort] || m.recent;
}

export function decrementStock(listingId, qty = 1) {
  const db = getDb();
  const row = db.prepare("SELECT stock FROM mk_listings WHERE id = ?").get(listingId);
  if (!row) return;
  const newStock = Math.max(0, row.stock - qty);
  const now = new Date().toISOString();
  db.prepare("UPDATE mk_listings SET stock = ?, updated_at = ?, status = ? WHERE id = ?")
    .run(newStock, now, newStock === 0 ? "sold" : "active", listingId);
}

export function getListingsByCardId(cardId) {
  const rows = getDb().prepare("SELECT * FROM mk_listings WHERE card_id = ? AND status = 'active' AND stock > 0 ORDER BY price ASC").all(cardId);
  return rows.map((r) => rowToListing(r));
}
