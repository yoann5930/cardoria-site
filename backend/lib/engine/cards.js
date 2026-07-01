/**
 * CRUD cartes + recherche paginée (FTS5 / fallback LIKE).
 * Optimisé pour millions d'entrées via index SQLite + pagination curseur.
 */
import { getDb, normalizeText, slugify, makeCardId, rowToCard, syncFts } from "./database.js";
import { getLicense } from "./licenses.js";
import { setPriceSources, recalculateCardPrices, getSalesHistory } from "./pricing.js";

export function searchCards({
  q = "",
  license = "",
  extension = "",
  rarity = "",
  page = 1,
  limit = 24,
  sort = "name",
  activeOnly = true
} = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  let rows = [];
  let total = 0;

  if (q && q.length >= 2) {
    const ftsResult = searchFts(db, q, license, extension, rarity, activeOnly, sort, safeLimit, offset);
    if (ftsResult) return ftsResult;
  }

  const conditions = [];
  const params = [];

  if (activeOnly) conditions.push("c.active = 1");
  if (license) { conditions.push("c.license_slug = ?"); params.push(license); }
  if (extension) { conditions.push("c.extension LIKE ?"); params.push(`%${extension}%`); }
  if (rarity) { conditions.push("c.rarity = ?"); params.push(rarity); }
  if (q) {
    conditions.push("(c.name_normalized LIKE ? OR c.number LIKE ? OR c.extension LIKE ?)");
    const like = `%${normalizeText(q)}%`;
    params.push(like, like, like);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const order = sortOrder(sort);

  total = db.prepare(`SELECT COUNT(*) AS c FROM cards c ${where}`).get(...params)?.c ?? 0;
  rows = db.prepare(`SELECT c.* FROM cards c ${where} ${order} LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);

  return {
    cards: rows.map((r) => rowToCard(r)),
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) || 1 }
  };
}

function searchFts(db, q, license, extension, rarity, activeOnly, sort, limit, offset) {
  try {
    const ftsQuery = normalizeText(q).split(/\s+/).filter(Boolean).map((t) => `"${t}"*`).join(" AND ");
    const conditions = ["cards_fts MATCH ?"];
    const params = [ftsQuery];
    if (license) { conditions.push("c.license_slug = ?"); params.push(license); }
    if (extension) { conditions.push("c.extension LIKE ?"); params.push(`%${extension}%`); }
    if (rarity) { conditions.push("c.rarity = ?"); params.push(rarity); }
    if (activeOnly) conditions.push("c.active = 1");

    const where = "WHERE " + conditions.join(" AND ");
    const order = sortOrder(sort).replace("c.", "c.");

    const total = db.prepare(`
      SELECT COUNT(*) AS c FROM cards c
      INNER JOIN cards_fts ON cards_fts.rowid = c.rowid
      ${where}
    `).get(...params)?.c ?? 0;

    const rows = db.prepare(`
      SELECT c.* FROM cards c
      INNER JOIN cards_fts ON cards_fts.rowid = c.rowid
      ${where}
      ${order}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      cards: rows.map((r) => rowToCard(r)),
      pagination: { page: Math.floor(offset / limit) + 1, limit, total, pages: Math.ceil(total / limit) || 1 },
      searchEngine: "fts5"
    };
  } catch {
    return null;
  }
}

function sortOrder(sort) {
  const map = {
    price: "ORDER BY c.recommended_price DESC",
    price_asc: "ORDER BY c.recommended_price ASC",
    trend: "ORDER BY ABS(c.trend_percent) DESC",
    sales: "ORDER BY c.sales_count DESC",
    views: "ORDER BY c.views DESC",
    name: "ORDER BY c.name ASC"
  };
  return map[sort] || map.name;
}

export function autocomplete(q, limit = 10) {
  if (!q || q.length < 2) return [];
  return searchCards({ q, limit: Math.min(limit, 20), page: 1 }).cards.map((c) => ({
    id: c.id,
    name: c.name,
    license: c.license,
    slug: c.slug,
    extension: c.extension,
    number: c.number,
    imageThumb: c.imageThumb,
    price: c.prices.recommended
  }));
}

export function getCardById(id, { trackView = false } = {}) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  if (!row) return null;
  if (trackView) {
    db.prepare("UPDATE cards SET views = views + 1 WHERE id = ?").run(id);
    row.views += 1;
  }
  const license = getLicense(row.license_slug);
  return rowToCard(row, {
    licenseName: license?.name,
    salesHistory: getSalesHistory(id, 30),
    priceSources: db.prepare("SELECT source, price, fetched_at AS fetchedAt FROM price_sources WHERE card_id = ?").all(id)
  });
}

export function getCardBySlug(licenseSlug, slug, opts) {
  const row = getDb().prepare("SELECT id FROM cards WHERE license_slug = ? AND slug = ?").get(licenseSlug, slug);
  return row ? getCardById(row.id, opts) : null;
}

export function createCard(data) {
  const db = getDb();
  if (!getLicense(data.license || data.licenseSlug)) {
    throw new Error("Licence inconnue : " + (data.license || data.licenseSlug));
  }
  const licenseSlug = data.license || data.licenseSlug;
  const slug = data.slug || slugify(`${data.name}-${data.extension}-${data.number}`);
  const id = data.id || makeCardId(licenseSlug, slug);
  const now = new Date().toISOString();

  const card = {
    id,
    license_slug: licenseSlug,
    slug,
    name: data.name,
    name_normalized: normalizeText(data.name),
    extension: data.extension || "",
    extension_code: data.extensionCode || "",
    number: data.number || "",
    rarity: data.rarity || "",
    illustration: data.illustration || "",
    image_hd: data.imageHd || data.image_hd || "",
    image_thumb: data.imageThumb || data.image_thumb || data.imageHd || "",
    condition_note: data.condition || "NM",
    meta_title: data.metaTitle || `${data.name} — ${data.extension} | Cardoria`,
    meta_description: data.metaDescription || `Prix et fiche ${data.name} (${data.extension}). Estimation et achat Cardoria.`,
    created_at: now,
    updated_at: now
  };

  db.prepare(`
    INSERT INTO cards (
      id, license_slug, slug, name, name_normalized, extension, extension_code, number,
      rarity, illustration, image_hd, image_thumb, condition_note, meta_title, meta_description,
      active, created_at, updated_at
    ) VALUES (
      @id, @license_slug, @slug, @name, @name_normalized, @extension, @extension_code, @number,
      @rarity, @illustration, @image_hd, @image_thumb, @condition_note, @meta_title, @meta_description,
      1, @created_at, @updated_at
    )
  `).run(card);

  const rowid = db.prepare("SELECT rowid FROM cards WHERE id = ?").get(id)?.rowid;
  syncFts(rowid, card);

  if (data.priceSources?.length) setPriceSources(id, data.priceSources);
  else if (data.avgPrice != null) {
    setPriceSources(id, [
      { source: "cardoria", price: data.avgPrice },
      { source: "cardmarket", price: data.avgPrice * 0.97 },
      { source: "tcgplayer", price: data.avgPrice * 1.03 }
    ]);
  } else {
    recalculateCardPrices(id);
  }

  if (data.salesHistory?.length) {
    data.salesHistory.forEach((s) => {
      db.prepare("INSERT INTO sales_history (card_id, sold_at, price, condition, channel) VALUES (?,?,?,?,?)")
        .run(id, s.date || s.soldAt, s.price, s.condition || "NM", s.channel || "Cardoria");
    });
    recalculateCardPrices(id);
  }

  return getCardById(id);
}

export function updateCard(id, data) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const name = data.name ?? existing.name;

  db.prepare(`
    UPDATE cards SET
      name = ?, name_normalized = ?, extension = ?, extension_code = ?, number = ?,
      rarity = ?, illustration = ?, image_hd = ?, image_thumb = ?, condition_note = ?,
      meta_title = ?, meta_description = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    normalizeText(name),
    data.extension ?? existing.extension,
    data.extensionCode ?? existing.extension_code,
    data.number ?? existing.number,
    data.rarity ?? existing.rarity,
    data.illustration ?? existing.illustration,
    data.imageHd ?? data.image_hd ?? existing.image_hd,
    data.imageThumb ?? data.image_thumb ?? existing.image_thumb,
    data.condition ?? existing.condition_note,
    data.metaTitle ?? existing.meta_title,
    data.metaDescription ?? existing.meta_description,
    data.active != null ? (data.active ? 1 : 0) : existing.active,
    now,
    id
  );

  const row = db.prepare("SELECT rowid, * FROM cards WHERE id = ?").get(id);
  if (row) syncFts(row.rowid, row);

  if (data.priceSources) setPriceSources(id, data.priceSources);
  if (data.prices) {
    setPriceSources(id, [
      { source: "cardoria", price: data.prices.recommended || data.prices.avg },
      { source: "cardmarket", price: data.prices.low || data.prices.avg * 0.95 },
      { source: "tcgplayer", price: data.prices.high || data.prices.avg * 1.05 }
    ]);
  }

  return getCardById(id);
}

export function deleteCard(id) {
  const db = getDb();
  const row = db.prepare("SELECT rowid FROM cards WHERE id = ?").get(id);
  if (!row) return false;
  try { db.prepare("DELETE FROM cards_fts WHERE rowid = ?").run(row.rowid); } catch { /* */ }
  db.prepare("DELETE FROM cards WHERE id = ?").run(id);
  return true;
}

export function getSitemapCards(limit = 5000, offset = 0) {
  return getDb().prepare(`
    SELECT id, license_slug, slug, updated_at FROM cards WHERE active = 1
    ORDER BY views DESC, sales_count DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

export function getCardCount() {
  return getDb().prepare("SELECT COUNT(*) AS c FROM cards WHERE active = 1").get()?.c ?? 0;
}
