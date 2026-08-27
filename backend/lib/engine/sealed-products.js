import crypto from "crypto";
import { getDb, normalizeText } from "./database.js";

const TCGCSV_BASE = "https://tcgcsv.com/tcgplayer";
const POKEMON_CATEGORY_ID = 3;
const FX_URL = "https://api.frankfurter.dev/v2/rate/USD/EUR";
const SOURCE = "tcgcsv-tcgplayer";
const FRESH_MS = 20 * 60 * 60 * 1000;
const REQUEST_DELAY_MS = 110;

export const SEALED_PACKAGING_TYPES = [
  "booster","blister","duopack","tripack","quadpack","bundle","mini_bundle","demi_display","display","case_display",
  "etb","etb_pokemon_center","upc","coffret","collection_box","tin","pokebox","mini_tin","build_battle","build_battle_stadium",
  "deck","theme_deck","battle_deck","league_battle_deck","starter_deck","premium_collection","poster_collection","binder_collection",
  "calendar","advent_calendar","case_carton","master_case","other"
];

function cleanText(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }
function positive(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function ensureColumn(db, name, definition) {
  const cols = db.prepare("PRAGMA table_info(sealed_products)").all().map((row) => row.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE sealed_products ADD COLUMN ${name} ${definition}`);
}

export function ensureSealedSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sealed_products (
      id TEXT PRIMARY KEY,
      cardmarket_id INTEGER UNIQUE,
      source TEXT NOT NULL DEFAULT 'manual',
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      category_name TEXT DEFAULT '',
      packaging TEXT NOT NULL DEFAULT 'other',
      extension TEXT DEFAULT '',
      id_expansion INTEGER,
      units_per_package INTEGER NOT NULL DEFAULT 1,
      ean TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      cardmarket_url TEXT DEFAULT '',
      sale_price REAL NOT NULL DEFAULT 0,
      sale_price_manual INTEGER NOT NULL DEFAULT 0,
      market_price REAL NOT NULL DEFAULT 0,
      market_low REAL NOT NULL DEFAULT 0,
      market_avg REAL NOT NULL DEFAULT 0,
      market_avg1 REAL NOT NULL DEFAULT 0,
      market_avg7 REAL NOT NULL DEFAULT 0,
      market_avg30 REAL NOT NULL DEFAULT 0,
      price_source TEXT DEFAULT '',
      market_updated_at TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "tcgplayer_id", "INTEGER");
  ensureColumn(db, "tcgplayer_group_id", "INTEGER");
  ensureColumn(db, "product_url", "TEXT DEFAULT ''");
  ensureColumn(db, "market_price_usd", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "fx_usd_eur", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "market_currency", "TEXT DEFAULT 'EUR'");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sealed_tcgplayer ON sealed_products(tcgplayer_id) WHERE tcgplayer_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sealed_active_packaging ON sealed_products(active, packaging);
    CREATE INDEX IF NOT EXISTS idx_sealed_name ON sealed_products(name_normalized);
  `);
  return db;
}

export function classifySealedPackaging(name = "", categoryName = "") {
  const n = normalizeText(name);
  const c = normalizeText(categoryName);
  if (/master\s*case/.test(n)) return "master_case";
  if (/(case|carton).*(booster box|display)|(booster box|display).*(case|carton)/.test(n)) return "case_display";
  if (/half\s*(booster\s*)?box|half\s*display|demi[- ]?display|18\s*boosters?/.test(n)) return "demi_display";
  if (/pokemon\s*center.*elite\s*trainer|elite\s*trainer.*pokemon\s*center/.test(n)) return "etb_pokemon_center";
  if (/elite\s*trainer\s*box|\betb\b/.test(n)) return "etb";
  if (/ultra\s*premium|super\s*premium|\bupc\b/.test(n)) return "upc";
  if (/booster\s*bundle/.test(n)) return "bundle";
  if (/mini\s*bundle/.test(n)) return "mini_bundle";
  if (/4[- ]?pack.*blister|quad.*pack/.test(n)) return "quadpack";
  if (/3[- ]?pack.*blister|tri[- ]?pack|tripack/.test(n)) return "tripack";
  if (/2[- ]?pack.*blister|duo[- ]?pack|duopack/.test(n)) return "duopack";
  if (/blister/.test(n) || /blister/.test(c)) return "blister";
  if (/booster\s*(box|display)|display/.test(n)) return "display";
  if (/mini\s*tin/.test(n)) return "mini_tin";
  if (/\btin\b|pokebox/.test(n)) return /pokebox/.test(n) ? "pokebox" : "tin";
  if (/build\s*&?\s*battle\s*stadium/.test(n)) return "build_battle_stadium";
  if (/build\s*&?\s*battle/.test(n)) return "build_battle";
  if (/league\s*battle\s*deck/.test(n)) return "league_battle_deck";
  if (/battle\s*deck/.test(n)) return "battle_deck";
  if (/theme\s*deck/.test(n)) return "theme_deck";
  if (/starter\s*deck/.test(n)) return "starter_deck";
  if (/\bdeck\b/.test(n) && !/deck\s*(box|protector|sleeve)/.test(n)) return "deck";
  if (/premium\s*collection/.test(n)) return "premium_collection";
  if (/poster\s*collection/.test(n)) return "poster_collection";
  if (/binder\s*collection/.test(n)) return "binder_collection";
  if (/advent|calendrier\s*de\s*l.?avent/.test(n)) return "advent_calendar";
  if (/calendar|calendrier/.test(n)) return "calendar";
  if (/collection\s*box|boxed\s*collection/.test(n)) return "collection_box";
  if (/collection|coffret|box\s*set/.test(n)) return "coffret";
  if (/case|carton/.test(n)) return "case_carton";
  if (/booster/.test(n) || /booster/.test(c)) return "booster";
  return "other";
}

function extendedNames(product = {}) {
  return new Set((Array.isArray(product.extendedData) ? product.extendedData : []).map((item) => normalizeText(item?.name || item?.displayName || "")));
}
export function isSealedTcgProduct(product = {}) {
  const n = normalizeText(product.name || product.cleanName || "");
  const extended = extendedNames(product);
  if (extended.has("number") || extended.has("card number") || extended.has("rarity")) return false;
  if (/(sleeve|deck box|playmat|toploader|binder page|portfolio|divider|dice|coin|marker|accessor)/.test(n)) return false;
  return /(booster|display|elite trainer|\betb\b|bundle|blister|\btin\b|pokebox|build\s*&?\s*battle|\bdeck\b|premium collection|poster collection|binder collection|calendar|advent|ultra premium|\bupc\b|collection box|boxed collection|collector chest|trainer toolkit|battle academy)/.test(n);
}

export function inferSealedUnits(name = "", packaging = "other") {
  const n = normalizeText(name);
  const explicit = n.match(/\b(2|3|4|5|6|8|9|10|12|18|24|30|36)\s*(?:x\s*)?(?:boosters?|packs?)\b/);
  if (explicit) return Number(explicit[1]);
  const defaults = { booster: 1, duopack: 2, tripack: 3, quadpack: 4, demi_display: 18, display: 36 };
  return defaults[packaging] || 1;
}

function pickTcgPrice(rows = []) {
  const candidates = Array.isArray(rows) ? rows : [];
  const preferred = candidates.find((row) => normalizeText(row?.subTypeName) === "normal") || candidates.find((row) => positive(row?.marketPrice, row?.midPrice, row?.lowPrice) > 0) || {};
  return {
    market: round2(positive(preferred.marketPrice, preferred.midPrice, preferred.lowPrice)),
    low: round2(positive(preferred.lowPrice, preferred.directLowPrice)),
    mid: round2(positive(preferred.midPrice, preferred.marketPrice)),
    high: round2(positive(preferred.highPrice, preferred.midPrice))
  };
}

async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0 sealed-catalog" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function usdEurRate() {
  try {
    const payload = await fetchJson(FX_URL, 15000);
    const rate = Number(payload?.rate || 0);
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch {}
  return 0;
}
function extractResults(payload) { return Array.isArray(payload?.results) ? payload.results : []; }

function rowToReference(row) {
  return {
    id: row.id,
    tcgplayerId: row.tcgplayer_id == null ? null : Number(row.tcgplayer_id),
    source: row.source,
    name: row.name,
    license: "pokemon",
    extension: row.extension || "",
    categoryName: row.category_name || "",
    packaging: row.packaging || "other",
    unitsPerPackage: Number(row.units_per_package || 1),
    ean: row.ean || "",
    imageUrl: row.image_url || "",
    productUrl: row.product_url || "",
    salePrice: Number(row.sale_price || 0),
    salePriceManual: Boolean(row.sale_price_manual),
    marketPrice: Number(row.market_price || 0),
    marketPriceUsd: Number(row.market_price_usd || 0),
    marketLow: Number(row.market_low || 0),
    marketAvg: Number(row.market_avg || 0),
    marketAvg1: Number(row.market_avg1 || 0),
    marketAvg7: Number(row.market_avg7 || 0),
    marketAvg30: Number(row.market_avg30 || 0),
    fxUsdEur: Number(row.fx_usd_eur || 0),
    marketCurrency: row.market_currency || "EUR",
    priceSource: row.price_source || "",
    marketUpdatedAt: row.market_updated_at || "",
    notes: row.notes || "",
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getSealedCatalogStatus() {
  const db = ensureSealedSchema();
  const row = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN active=1 AND market_price>0 THEN 1 ELSE 0 END) AS priced,
    SUM(CASE WHEN active=1 AND source='tcgcsv' THEN 1 ELSE 0 END) AS provider,
    SUM(CASE WHEN active=1 AND source='manual' THEN 1 ELSE 0 END) AS manual,
    MAX(CASE WHEN source='tcgcsv' THEN market_updated_at ELSE '' END) AS last_sync
    FROM sealed_products`).get() || {};
  return {
    total: Number(row.total || 0), active: Number(row.active || 0), priced: Number(row.priced || 0),
    provider: Number(row.provider || 0), manual: Number(row.manual || 0), lastSyncAt: row.last_sync || "", source: SOURCE
  };
}

export function listSealedProducts({ q = "", packaging = "", limit = 10000, activeOnly = true } = {}) {
  const db = ensureSealedSchema();
  const clauses = [], params = [];
  if (activeOnly) clauses.push("active=1");
  if (packaging && SEALED_PACKAGING_TYPES.includes(packaging)) { clauses.push("packaging=?"); params.push(packaging); }
  if (q) { clauses.push("(name_normalized LIKE ? OR extension LIKE ? OR ean LIKE ? OR category_name LIKE ?)"); const like = `%${normalizeText(q)}%`; params.push(like, `%${q}%`, `%${q}%`, `%${q}%`); }
  const safeLimit = Math.min(Math.max(Number(limit) || 10000, 1), 20000);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM sealed_products ${where} ORDER BY CASE WHEN sale_price>0 THEN 0 ELSE 1 END, extension DESC, name ASC LIMIT ?`).all(...params, safeLimit);
  return rows.map(rowToReference);
}

function normalizedManual(data = {}, existing = null) {
  const name = cleanText(data.name ?? existing?.name, 180);
  if (!name) throw Object.assign(new Error("Le nom du produit est obligatoire."), { status: 400 });
  const packagingRaw = cleanText(data.packaging ?? existing?.packaging, 80);
  const packaging = SEALED_PACKAGING_TYPES.includes(packagingRaw) ? packagingRaw : "other";
  const units = Math.max(1, Math.min(10000, Math.trunc(Number(data.unitsPerPackage ?? existing?.units_per_package ?? 1) || 1)));
  const hasSalePrice = Object.prototype.hasOwnProperty.call(data, "salePrice");
  const manualPrice = hasSalePrice && data.salePrice !== null && data.salePrice !== "";
  const salePrice = manualPrice ? Math.max(0, round2(Number(data.salePrice) || 0)) : Number(existing?.market_price || existing?.sale_price || 0);
  return {
    name, nameNormalized: normalizeText(name), packaging, extension: cleanText(data.extension ?? existing?.extension, 160), units,
    ean: cleanText(data.ean ?? existing?.ean, 80), notes: cleanText(data.notes ?? existing?.notes, 2000), salePrice, manualPrice
  };
}

export function createSealedProduct(data = {}) {
  const db = ensureSealedSchema();
  const item = normalizedManual(data);
  const now = new Date().toISOString();
  const id = `sealed-manual-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  db.prepare(`INSERT INTO sealed_products (id,source,name,name_normalized,category_name,packaging,extension,units_per_package,ean,sale_price,sale_price_manual,active,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,"manual",item.name,item.nameNormalized,"",item.packaging,item.extension,item.units,item.ean,item.salePrice,item.manualPrice?1:0,1,item.notes,now,now);
  return rowToReference(db.prepare("SELECT * FROM sealed_products WHERE id=?").get(id));
}

export function updateSealedProduct(id, data = {}) {
  const db = ensureSealedSchema();
  const existing = db.prepare("SELECT * FROM sealed_products WHERE id=?").get(id);
  if (!existing) return null;
  const item = normalizedManual(data, existing);
  const now = new Date().toISOString();
  db.prepare(`UPDATE sealed_products SET name=?,name_normalized=?,packaging=?,extension=?,units_per_package=?,ean=?,sale_price=?,sale_price_manual=?,notes=?,active=1,updated_at=? WHERE id=?`)
    .run(item.name,item.nameNormalized,item.packaging,item.extension,item.units,item.ean,item.salePrice,item.manualPrice?1:0,item.notes,now,id);
  return rowToReference(db.prepare("SELECT * FROM sealed_products WHERE id=?").get(id));
}

export function deleteSealedProduct(id) {
  const db = ensureSealedSchema();
  return db.prepare("DELETE FROM sealed_products WHERE id=?").run(id).changes > 0;
}

export async function syncCardmarketSealedCatalog({ force = false } = {}) {
  const db = ensureSealedSchema();
  const status = getSealedCatalogStatus();
  const last = Date.parse(status.lastSyncAt || "");
  if (!force && status.provider >= 20 && Number.isFinite(last) && Date.now() - last < FRESH_MS) return { ok: true, skipped: true, reason: "fresh", ...status };

  const fx = await usdEurRate();
  if (!fx) throw new Error("Conversion USD/EUR indisponible : prix scelles non modifies.");
  const groupsPayload = await fetchJson(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/groups`);
  const groups = extractResults(groupsPayload);
  if (groups.length < 50) throw new Error("Catalogue groupes Pokemon TCGCSV incomplet.");

  const collected = [];
  let groupsRead = 0, groupsFailed = 0;
  for (const group of groups) {
    const groupId = Number(group?.groupId || 0);
    if (!groupId) continue;
    try {
      await sleep(REQUEST_DELAY_MS);
      const productsPayload = await fetchJson(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/${groupId}/products`);
      const sealedProducts = extractResults(productsPayload).filter(isSealedTcgProduct);
      groupsRead += 1;
      if (!sealedProducts.length) continue;
      await sleep(REQUEST_DELAY_MS);
      const pricesPayload = await fetchJson(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/${groupId}/prices`);
      const pricesById = new Map();
      for (const price of extractResults(pricesPayload)) {
        const key = Number(price?.productId || 0);
        if (!key) continue;
        const bucket = pricesById.get(key) || [];
        bucket.push(price); pricesById.set(key, bucket);
      }
      for (const product of sealedProducts) {
        const tcgplayerId = Number(product?.productId || 0);
        if (!tcgplayerId) continue;
        const priceUsd = pickTcgPrice(pricesById.get(tcgplayerId) || []);
        const packaging = classifySealedPackaging(product.name, "sealed products");
        collected.push({
          tcgplayerId, groupId, name: cleanText(product.name || product.cleanName, 240), extension: cleanText(group?.name || "", 180), packaging,
          units: inferSealedUnits(product.name, packaging), imageUrl: cleanText(product.imageUrl || "", 800), productUrl: cleanText(product.url || "", 800),
          marketUsd: priceUsd.market, marketEur: round2(priceUsd.market * fx), lowEur: round2(priceUsd.low * fx), midEur: round2(priceUsd.mid * fx), highEur: round2(priceUsd.high * fx)
        });
      }
    } catch (error) {
      groupsFailed += 1;
      console.warn(`[sealed-catalog] group ${groupId} skipped:`, error?.message || String(error));
    }
  }
  if (collected.length < 20) throw new Error("Catalogue Pokemon scelle TCGCSV insuffisant : aucune modification appliquee.");

  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO sealed_products (
    id,tcgplayer_id,tcgplayer_group_id,source,name,name_normalized,category_name,packaging,extension,units_per_package,image_url,product_url,
    sale_price,sale_price_manual,market_price,market_price_usd,market_low,market_avg,market_avg1,market_avg7,market_avg30,fx_usd_eur,market_currency,
    price_source,market_updated_at,active,notes,created_at,updated_at
  ) VALUES (@id,@tcgplayer_id,@tcgplayer_group_id,'tcgcsv',@name,@name_normalized,'Sealed Products',@packaging,@extension,@units_per_package,@image_url,@product_url,
    @sale_price,0,@market_price,@market_price_usd,@market_low,@market_avg,0,0,0,@fx_usd_eur,'EUR',@price_source,@market_updated_at,1,'',@created_at,@updated_at)
  ON CONFLICT(tcgplayer_id) DO UPDATE SET
    source='tcgcsv',tcgplayer_group_id=excluded.tcgplayer_group_id,name=excluded.name,name_normalized=excluded.name_normalized,category_name='Sealed Products',
    packaging=excluded.packaging,extension=excluded.extension,units_per_package=excluded.units_per_package,
    image_url=CASE WHEN excluded.image_url<>'' THEN excluded.image_url ELSE sealed_products.image_url END,
    product_url=CASE WHEN excluded.product_url<>'' THEN excluded.product_url ELSE sealed_products.product_url END,
    sale_price=CASE WHEN sealed_products.sale_price_manual=1 THEN sealed_products.sale_price ELSE excluded.sale_price END,
    market_price=excluded.market_price,market_price_usd=excluded.market_price_usd,market_low=excluded.market_low,market_avg=excluded.market_avg,
    fx_usd_eur=excluded.fx_usd_eur,market_currency='EUR',price_source=excluded.price_source,market_updated_at=excluded.market_updated_at,active=1,updated_at=excluded.updated_at`);

  let priced = 0;
  const transaction = db.transaction(() => {
    db.prepare("UPDATE sealed_products SET active=0,updated_at=? WHERE source='tcgcsv'").run(now);
    for (const product of collected) {
      if (product.marketEur > 0) priced += 1;
      upsert.run({
        id: `sealed-tcgplayer-${product.tcgplayerId}`, tcgplayer_id: product.tcgplayerId, tcgplayer_group_id: product.groupId,
        name: product.name, name_normalized: normalizeText(product.name), packaging: product.packaging, extension: product.extension,
        units_per_package: product.units, image_url: product.imageUrl, product_url: product.productUrl,
        sale_price: product.marketEur, market_price: product.marketEur, market_price_usd: product.marketUsd,
        market_low: product.lowEur, market_avg: product.midEur || product.marketEur, fx_usd_eur: fx,
        price_source: SOURCE, market_updated_at: now, created_at: now, updated_at: now
      });
    }
  });
  transaction();
  const next = getSealedCatalogStatus();
  return { ok: true, skipped: false, source: SOURCE, groups: groups.length, groupsRead, groupsFailed, products: collected.length, priced, fxUsdEur: fx, ...next };
}

ensureSealedSchema();
