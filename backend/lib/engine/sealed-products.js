import crypto from "crypto";
import { getDb, normalizeText } from "./database.js";

const PRODUCT_URL = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const PRICE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const SOURCE = "cardmarket-public";
const FRESH_MS = 6 * 60 * 60 * 1000;

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
    CREATE INDEX IF NOT EXISTS idx_sealed_active_packaging ON sealed_products(active, packaging);
    CREATE INDEX IF NOT EXISTS idx_sealed_name ON sealed_products(name_normalized);
    CREATE INDEX IF NOT EXISTS idx_sealed_cardmarket ON sealed_products(cardmarket_id);
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
  if (/booster\s*(box|display)|display/.test(n) || /booster\s*box/.test(c)) return "display";
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

export function isSealedCardmarketProduct(record = {}) {
  const category = normalizeText(record.categoryName || record.category || "");
  const name = normalizeText(record.name || "");
  if (category.includes("accessor")) return false;
  if (category.includes("booster") || category.includes("sealed")) return true;
  return /(booster|display|elite trainer|etb|bundle|blister|tin\b|pokebox|build\s*&?\s*battle|deck\b|premium collection|poster collection|binder collection|calendar|advent|ultra premium|upc\b|collection box|boxed collection)/.test(name) && !/(sleeve|binder page|deck box|playmat|toploader|accessor)/.test(name);
}

export function inferSealedUnits(name = "", packaging = "other") {
  const n = normalizeText(name);
  const explicit = n.match(/\b(2|3|4|5|6|8|9|10|12|18|24|30|36)\s*(?:x\s*)?(?:boosters?|packs?)\b/);
  if (explicit) return Number(explicit[1]);
  const defaults = { booster: 1, duopack: 2, tripack: 3, quadpack: 4, demi_display: 18, display: 36 };
  return defaults[packaging] || 1;
}

export function pickSealedMarketPrice(price = {}) {
  return round2(positive(price.trend, price.avg7, price.avg30, price.avg, price.avg1, price.low));
}

function extractProducts(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["products", "data", "items"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}
function extractPrices(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["priceGuides", "prices", "data", "items"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Cardmarket ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function rowToReference(row) {
  return {
    id: row.id,
    cardmarketId: row.cardmarket_id == null ? null : Number(row.cardmarket_id),
    source: row.source,
    name: row.name,
    license: "pokemon",
    extension: row.extension || "",
    categoryName: row.category_name || "",
    packaging: row.packaging || "other",
    unitsPerPackage: Number(row.units_per_package || 1),
    ean: row.ean || "",
    imageUrl: row.image_url || "",
    cardmarketUrl: row.cardmarket_url || "",
    salePrice: Number(row.sale_price || 0),
    salePriceManual: Boolean(row.sale_price_manual),
    marketPrice: Number(row.market_price || 0),
    marketLow: Number(row.market_low || 0),
    marketAvg: Number(row.market_avg || 0),
    marketAvg1: Number(row.market_avg1 || 0),
    marketAvg7: Number(row.market_avg7 || 0),
    marketAvg30: Number(row.market_avg30 || 0),
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
    SUM(CASE WHEN active=1 AND source='cardmarket' THEN 1 ELSE 0 END) AS cardmarket,
    SUM(CASE WHEN active=1 AND source='manual' THEN 1 ELSE 0 END) AS manual,
    MAX(CASE WHEN source='cardmarket' THEN market_updated_at ELSE '' END) AS last_sync
    FROM sealed_products`).get() || {};
  return {
    total: Number(row.total || 0), active: Number(row.active || 0), priced: Number(row.priced || 0),
    cardmarket: Number(row.cardmarket || 0), manual: Number(row.manual || 0), lastSyncAt: row.last_sync || "", source: SOURCE
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
  const rows = db.prepare(`SELECT * FROM sealed_products ${where} ORDER BY CASE WHEN sale_price>0 THEN 0 ELSE 1 END, name ASC LIMIT ?`).all(...params, safeLimit);
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
  if (!force && status.cardmarket >= 50 && Number.isFinite(last) && Date.now() - last < FRESH_MS) return { ok: true, skipped: true, reason: "fresh", ...status };

  const [productPayload, pricePayload] = await Promise.all([fetchJson(PRODUCT_URL), fetchJson(PRICE_URL)]);
  const products = extractProducts(productPayload);
  const prices = extractPrices(pricePayload);
  if (products.length < 100 || prices.length < 100) throw new Error("Catalogue public Cardmarket incomplet.");
  const priceById = new Map(prices.map((price) => [String(price?.idProduct ?? ""), price]));
  const sealed = products.filter((product) => product?.idProduct != null && product?.name && isSealedCardmarketProduct(product));
  if (sealed.length < 20) throw new Error("Aucun catalogue Pokémon scellé fiable reçu de Cardmarket.");

  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO sealed_products (
    id,cardmarket_id,source,name,name_normalized,category_name,packaging,extension,id_expansion,units_per_package,ean,image_url,cardmarket_url,
    sale_price,sale_price_manual,market_price,market_low,market_avg,market_avg1,market_avg7,market_avg30,price_source,market_updated_at,active,notes,created_at,updated_at
  ) VALUES (@id,@cardmarket_id,'cardmarket',@name,@name_normalized,@category_name,@packaging,@extension,@id_expansion,@units_per_package,@ean,'',@cardmarket_url,
    @sale_price,0,@market_price,@market_low,@market_avg,@market_avg1,@market_avg7,@market_avg30,@price_source,@market_updated_at,1,'',@created_at,@updated_at)
  ON CONFLICT(cardmarket_id) DO UPDATE SET
    source='cardmarket',name=excluded.name,name_normalized=excluded.name_normalized,category_name=excluded.category_name,packaging=excluded.packaging,
    extension=CASE WHEN sealed_products.extension<>'' THEN sealed_products.extension ELSE excluded.extension END,id_expansion=excluded.id_expansion,
    units_per_package=CASE WHEN sealed_products.units_per_package>1 THEN sealed_products.units_per_package ELSE excluded.units_per_package END,
    ean=CASE WHEN sealed_products.ean<>'' THEN sealed_products.ean ELSE excluded.ean END,cardmarket_url=excluded.cardmarket_url,
    sale_price=CASE WHEN sealed_products.sale_price_manual=1 THEN sealed_products.sale_price ELSE excluded.sale_price END,
    market_price=excluded.market_price,market_low=excluded.market_low,market_avg=excluded.market_avg,market_avg1=excluded.market_avg1,
    market_avg7=excluded.market_avg7,market_avg30=excluded.market_avg30,price_source=excluded.price_source,market_updated_at=excluded.market_updated_at,
    active=1,updated_at=excluded.updated_at`);

  let priced = 0;
  const transaction = db.transaction(() => {
    db.prepare("UPDATE sealed_products SET active=0,updated_at=? WHERE source='cardmarket'").run(now);
    for (const product of sealed) {
      const cmId = Number(product.idProduct);
      const price = priceById.get(String(product.idProduct)) || {};
      const packaging = classifySealedPackaging(product.name, product.categoryName);
      const marketPrice = pickSealedMarketPrice(price);
      if (marketPrice > 0) priced += 1;
      upsert.run({
        id: `sealed-cardmarket-${cmId}`, cardmarket_id: cmId, name: cleanText(product.name, 240), name_normalized: normalizeText(product.name),
        category_name: cleanText(product.categoryName, 160), packaging, extension: cleanText(product.expansionName || product.nameExpansion || "", 160),
        id_expansion: product.idExpansion == null || product.idExpansion === "" ? null : Number(product.idExpansion), units_per_package: inferSealedUnits(product.name, packaging),
        ean: cleanText(product.ean || product.EAN || product.barcode || "", 80), cardmarket_url: `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${cmId}`,
        sale_price: marketPrice, market_price: marketPrice, market_low: round2(positive(price.low, price["low-holo"])), market_avg: round2(positive(price.avg, price["avg-holo"])),
        market_avg1: round2(positive(price.avg1, price["avg1-holo"])), market_avg7: round2(positive(price.avg7, price["avg7-holo"])),
        market_avg30: round2(positive(price.avg30, price["avg30-holo"])), price_source: SOURCE, market_updated_at: now, created_at: now, updated_at: now
      });
    }
  });
  transaction();
  const next = getSealedCatalogStatus();
  return { ok: true, skipped: false, source: SOURCE, downloadedProducts: products.length, downloadedPrices: prices.length, products: sealed.length, priced, ...next };
}
