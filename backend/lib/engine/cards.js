/**
 * CRUD cartes + recherche paginée (FTS5 / fallback LIKE).
 */
import { getDb, normalizeText, slugify, makeCardId, rowToCard, syncFts } from "./database.js";
import { getLicense } from "./licenses.js";
import { setPriceSources, recalculateCardPrices, getSalesHistory } from "./pricing.js";

const CARD_LANGUAGES = new Set(["fr", "en", "ja", "ko"]);
function normalizeLanguage(value, fallback = "fr") {
  const language = String(value || fallback).trim().toLowerCase();
  return CARD_LANGUAGES.has(language) ? language : fallback;
}

const SEARCH_LANGUAGE_HINTS = new Map([
  ["ko", "ko"], ["kr", "ko"], ["coreen", "ko"], ["coreenne", "ko"], ["korean", "ko"],
  ["ja", "ja"], ["jp", "ja"], ["japonais", "ja"], ["japonaise", "ja"], ["japanese", "ja"],
  ["anglais", "en"], ["anglaise", "en"], ["english", "en"],
  ["francais", "fr"], ["francaise", "fr"], ["french", "fr"]
]);

function parseSearchQuery(q = "", explicitLanguage = "") {
  const normalized = normalizeText(String(q || "").trim());
  const tokens = normalized.split(/\s+/).map((token) => token.replace(/^#+/, "")).filter(Boolean);
  const terms = [];
  let hintedLanguage = "";
  for (const token of tokens) {
    const hint = SEARCH_LANGUAGE_HINTS.get(token);
    if (hint) {
      if (!hintedLanguage) hintedLanguage = hint;
      continue;
    }
    terms.push(token);
  }
  return {
    language: explicitLanguage ? normalizeLanguage(explicitLanguage) : hintedLanguage,
    terms
  };
}

export function searchCards({ q = "", license = "", language = "", extension = "", rarity = "", hitFamily = "", variant = "", page = 1, limit = 24, sort = "name", activeOnly = true, maxLimit = 100 } = {}) {
  const db = getDb();
  const cap = Math.min(Math.max(Number(maxLimit) || 100, 1), 500);
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), cap);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const conditions = [];
  const params = [];
  const parsedQuery = parseSearchQuery(q, language);
  if (activeOnly) conditions.push("c.active = 1");
  if (license) { conditions.push("c.license_slug = ?"); params.push(license); }
  if (parsedQuery.language) { conditions.push("c.language = ?"); params.push(parsedQuery.language); }
  if (extension) { conditions.push("c.extension LIKE ?"); params.push(`%${extension}%`); }
  if (rarity) { conditions.push("c.rarity = ?"); params.push(rarity); }
  if (hitFamily) { conditions.push("c.hit_family = ?"); params.push(hitFamily); }
  if (variant === "holo") conditions.push("c.variants_json LIKE '%\"holo\":true%'");
  if (variant === "reverse") conditions.push("c.variants_json LIKE '%\"reverse\":true%'");
  for (const term of parsedQuery.terms) {
    const like = `%${term}%`;
    conditions.push("(c.name_normalized LIKE ? OR LOWER(c.number) LIKE ? OR LOWER(c.extension) LIKE ? OR LOWER(c.extension_code) LIKE ? OR LOWER(c.rarity) LIKE ? OR LOWER(c.hit_family) LIKE ?)");
    params.push(like, like, like, like, like, like);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const order = sortOrder(sort);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM cards c ${where}`).get(...params)?.c ?? 0;
  const rows = db.prepare(`SELECT c.* FROM cards c ${where} ${order} LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);
  return { cards: rows.map((r) => rowToCard(r)), pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) || 1 } };
}

function sortOrder(sort) {
  const rarityRank = `CASE c.hit_family
    WHEN 'Gold' THEN 100 WHEN 'SAR / Special Illustration Rare' THEN 95 WHEN 'Secret / Hyper Rare' THEN 90
    WHEN 'AR / Illustration Rare' THEN 85 WHEN 'Full Art / Ultra Rare' THEN 80 WHEN 'Full Art' THEN 80 WHEN 'Ultra Rare' THEN 75
    WHEN 'Double Rare' THEN 70 WHEN 'VMAX / VSTAR' THEN 65 WHEN 'V / ex' THEN 60
    WHEN 'Holo' THEN 50 WHEN 'Reverse Holo' THEN 45 WHEN 'Rare' THEN 40
    WHEN 'Peu Commune' THEN 20 WHEN 'Commune' THEN 10 ELSE 0 END`;
  const map = {
    price: "ORDER BY c.recommended_price DESC, c.name ASC",
    price_asc: "ORDER BY c.recommended_price ASC, c.name ASC",
    rarity: `ORDER BY ${rarityRank} DESC, c.rarity ASC, c.name ASC`,
    rarity_asc: `ORDER BY ${rarityRank} ASC, c.rarity ASC, c.name ASC`,
    extension: "ORDER BY c.extension ASC, CAST(c.number AS INTEGER) ASC, c.number ASC",
    trend: "ORDER BY ABS(c.trend_percent) DESC",
    sales: "ORDER BY c.sales_count DESC",
    views: "ORDER BY c.views DESC",
    name: "ORDER BY c.name ASC"
  };
  return map[sort] || map.name;
}

export function getCatalogFacets({ license = "pokemon", language = "" } = {}) {
  const db = getDb();
  const selectedLanguage = language ? normalizeLanguage(language) : "";
  const langClause = selectedLanguage ? " AND language = ?" : "";
  const args = selectedLanguage ? [license, selectedLanguage] : [license];
  const rarityRows = db.prepare(`SELECT rarity, COUNT(*) AS count FROM cards WHERE license_slug = ? AND active = 1${langClause} AND rarity <> '' GROUP BY rarity ORDER BY count DESC, rarity ASC`).all(...args);
  const hitRows = db.prepare(`SELECT hit_family AS value, COUNT(*) AS count FROM cards WHERE license_slug = ? AND active = 1${langClause} AND hit_family <> '' GROUP BY hit_family ORDER BY count DESC, hit_family ASC`).all(...args);
  const extensionRows = db.prepare(`SELECT extension AS value, COUNT(*) AS count FROM cards WHERE license_slug = ? AND active = 1${langClause} AND extension <> '' GROUP BY extension ORDER BY extension DESC LIMIT 300`).all(...args);
  const languageRows = db.prepare("SELECT language AS value, COUNT(*) AS count FROM cards WHERE license_slug = ? AND active = 1 GROUP BY language ORDER BY language ASC").all(license);
  return { rarities: rarityRows.map((r) => ({ value: r.rarity, count: r.count })), hitFamilies: hitRows, extensions: extensionRows, languages: languageRows };
}

export function autocomplete(q, limit = 10) {
  if (!q || q.length < 2) return [];
  return searchCards({ q, limit: Math.min(limit, 20), page: 1 }).cards.map((c) => ({ id: c.id, name: c.name, license: c.license, language: c.language, slug: c.slug, extension: c.extension, number: c.number, imageThumb: c.imageThumb, price: c.prices.recommended }));
}

export function getCardById(id, { trackView = false } = {}) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
  if (!row) return null;
  if (trackView) { db.prepare("UPDATE cards SET views = views + 1 WHERE id = ?").run(id); row.views += 1; }
  const license = getLicense(row.license_slug);
  return rowToCard(row, { licenseName: license?.name, salesHistory: getSalesHistory(id, 30), priceSources: db.prepare("SELECT source, price, fetched_at AS fetchedAt FROM price_sources WHERE card_id = ?").all(id) });
}

export function getCardBySlug(licenseSlug, slug, opts) {
  const row = getDb().prepare("SELECT id FROM cards WHERE license_slug = ? AND slug = ?").get(licenseSlug, slug);
  return row ? getCardById(row.id, opts) : null;
}

export function createCard(data) {
  const db = getDb();
  if (!getLicense(data.license || data.licenseSlug)) throw new Error("Licence inconnue : " + (data.license || data.licenseSlug));
  const licenseSlug = data.license || data.licenseSlug;
  const language = normalizeLanguage(data.language);
  const slug = data.slug || slugify(`${language === "fr" ? "" : language + "-"}${data.name}-${data.extension}-${data.number}`);
  const id = data.id || makeCardId(licenseSlug, slug);
  const now = new Date().toISOString();
  const card = { id, license_slug: licenseSlug, language, slug, name: data.name, name_normalized: normalizeText(data.name), extension: data.extension || "", extension_code: data.extensionCode || "", number: data.number || "", rarity: data.rarity || "", hit_family: data.hitFamily || "", variants_json: JSON.stringify(data.variants || {}), illustration: data.illustration || "", image_hd: data.imageHd || data.image_hd || "", image_thumb: data.imageThumb || data.image_thumb || data.imageHd || "", condition_note: data.condition || "NM", meta_title: data.metaTitle || `${data.name} — ${data.extension} | Cardoria`, meta_description: data.metaDescription || `Prix et fiche ${data.name} (${data.extension}). Estimation et achat Cardoria.`, created_at: now, updated_at: now };
  db.prepare(`INSERT INTO cards (id,license_slug,language,slug,name,name_normalized,extension,extension_code,number,rarity,hit_family,variants_json,illustration,image_hd,image_thumb,condition_note,meta_title,meta_description,active,created_at,updated_at) VALUES (@id,@license_slug,@language,@slug,@name,@name_normalized,@extension,@extension_code,@number,@rarity,@hit_family,@variants_json,@illustration,@image_hd,@image_thumb,@condition_note,@meta_title,@meta_description,1,@created_at,@updated_at)`).run(card);
  const rowid = db.prepare("SELECT rowid FROM cards WHERE id = ?").get(id)?.rowid; syncFts(rowid, card);
  if (data.priceSources?.length) setPriceSources(id, data.priceSources); else if (data.avgPrice != null) setPriceSources(id, [{ source: "cardoria", price: data.avgPrice }]); else recalculateCardPrices(id);
  return getCardById(id);
}

export function updateCard(id, data) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM cards WHERE id = ?").get(id); if (!existing) return null;
  const now = new Date().toISOString(); const name = data.name ?? existing.name;
  const language = data.language !== undefined ? normalizeLanguage(data.language, existing.language || "fr") : (existing.language || "fr");
  db.prepare(`UPDATE cards SET language=?,name=?,name_normalized=?,extension=?,extension_code=?,number=?,rarity=?,hit_family=?,variants_json=?,illustration=?,image_hd=?,image_thumb=?,condition_note=?,meta_title=?,meta_description=?,active=?,updated_at=? WHERE id=?`).run(language, name, normalizeText(name), data.extension ?? existing.extension, data.extensionCode ?? existing.extension_code, data.number ?? existing.number, data.rarity ?? existing.rarity, data.hitFamily ?? existing.hit_family, data.variants ? JSON.stringify(data.variants) : existing.variants_json, data.illustration ?? existing.illustration, data.imageHd ?? data.image_hd ?? existing.image_hd, data.imageThumb ?? data.image_thumb ?? existing.image_thumb, data.condition ?? existing.condition_note, data.metaTitle ?? existing.meta_title, data.metaDescription ?? existing.meta_description, data.active != null ? (data.active ? 1 : 0) : existing.active, now, id);
  const row = db.prepare("SELECT rowid, * FROM cards WHERE id = ?").get(id); if (row) syncFts(row.rowid, row);
  if (data.priceSources) setPriceSources(id, data.priceSources);
  if (data.prices) setPriceSources(id, [{ source: "cardoria", price: data.prices.recommended || data.prices.avg || 0 }]);
  return getCardById(id);
}

export function deleteCard(id) {
  const db = getDb(); const row = db.prepare("SELECT rowid FROM cards WHERE id = ?").get(id); if (!row) return false;
  try { db.prepare("DELETE FROM cards_fts WHERE rowid = ?").run(row.rowid); } catch {}
  db.prepare("DELETE FROM cards WHERE id = ?").run(id); return true;
}

export function getSitemapCards(limit = 5000, offset = 0) { return getDb().prepare("SELECT id,license_slug,language,slug,updated_at FROM cards WHERE active=1 ORDER BY views DESC,sales_count DESC LIMIT ? OFFSET ?").all(limit, offset); }
export function getCardCount() { return getDb().prepare("SELECT COUNT(*) AS c FROM cards WHERE active=1").get()?.c ?? 0; }
