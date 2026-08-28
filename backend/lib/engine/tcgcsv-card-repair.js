import { getDb, normalizeText } from "./database.js";

const BASE = "https://tcgcsv.com/tcgplayer";
const CATEGORY_ID = 3;
const FX_URL = "https://api.frankfurter.dev/v2/rate/USD/EUR";
const RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_DELAY_MS = 120;
let groupsCache = { at: 0, rows: [] };
let fxCache = { at: 0, rate: 0 };

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }
function positive(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0 card-catalog-fallback" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
function results(payload) { return Array.isArray(payload?.results) ? payload.results : []; }

function ensureSchema(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name));
  if (!cols.has("tcgcsv_checked_at")) db.exec("ALTER TABLE cards ADD COLUMN tcgcsv_checked_at TEXT DEFAULT ''");
  if (!cols.has("image_source")) db.exec("ALTER TABLE cards ADD COLUMN image_source TEXT DEFAULT ''");
  if (!cols.has("price_source_note")) db.exec("ALTER TABLE cards ADD COLUMN price_source_note TEXT DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS tcgcsv_card_group_audit (
    group_id INTEGER PRIMARY KEY,
    group_name TEXT NOT NULL DEFAULT '',
    matched INTEGER NOT NULL DEFAULT 0,
    priced INTEGER NOT NULL DEFAULT 0,
    images INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT NOT NULL DEFAULT ''
  )`);
  return db;
}

function extendedValue(product, names) {
  const wanted = new Set(names.map(normalizeText));
  for (const item of Array.isArray(product?.extendedData) ? product.extendedData : []) {
    const key = normalizeText(item?.name || item?.displayName || "");
    if (!wanted.has(key)) continue;
    const value = item?.value ?? item?.displayValue ?? item?.text ?? "";
    if (String(value || "").trim()) return String(value).trim();
  }
  return "";
}

function cardNumber(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  raw = raw.split("/")[0].trim();
  const numeric = raw.match(/^(\d+)/)?.[1];
  if (numeric) return String(Number(numeric));
  return normalizeText(raw).replace(/[^a-z0-9]/g, "");
}

function productPrice(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const preferred = list.find((row) => normalizeText(row?.subTypeName) === "normal")
    || list.find((row) => normalizeText(row?.subTypeName) === "holofoil")
    || list.find((row) => positive(row?.marketPrice, row?.midPrice, row?.lowPrice) > 0)
    || {};
  return {
    market: round2(positive(preferred.marketPrice, preferred.midPrice, preferred.lowPrice)),
    low: round2(positive(preferred.lowPrice, preferred.directLowPrice, preferred.marketPrice)),
    high: round2(positive(preferred.highPrice, preferred.midPrice, preferred.marketPrice))
  };
}

async function usdEur() {
  if (fxCache.rate > 0 && Date.now() - fxCache.at < 12 * 60 * 60 * 1000) return fxCache.rate;
  try {
    const payload = await fetchJson(FX_URL, 15000);
    const rate = Number(payload?.rate || 0);
    if (rate > 0) { fxCache = { at: Date.now(), rate }; return rate; }
  } catch {}
  return 0;
}

async function loadGroups() {
  if (groupsCache.rows.length && Date.now() - groupsCache.at < 6 * 60 * 60 * 1000) return groupsCache.rows;
  const payload = await fetchJson(`${BASE}/${CATEGORY_ID}/groups`);
  const rows = results(payload).filter((row) => Number(row?.groupId || 0) > 0);
  if (rows.length < 50) throw new Error(`TCGCSV Pokemon groups incomplete (${rows.length})`);
  groupsCache = { at: Date.now(), rows };
  return rows;
}

function groupKeys(group) {
  return [group?.name, group?.abbreviation, group?.publishedOn].map(normalizeText).filter(Boolean);
}

function cardExtensionKeys(card) {
  return [card.extension, card.source_extension, card.extension_code].map(normalizeText).filter(Boolean);
}

function sameGroup(card, group) {
  const g = groupKeys(group);
  const c = cardExtensionKeys(card);
  if (g.some((a) => c.includes(a))) return true;
  const groupName = normalizeText(group?.name || "");
  return c.some((key) => key.length >= 4 && (groupName.includes(key) || key.includes(groupName)));
}

function chooseCard(product, cardsByNumber) {
  const number = cardNumber(extendedValue(product, ["number", "card number"]));
  if (!number) return null;
  const candidates = cardsByNumber.get(number) || [];
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const pName = normalizeText(product?.cleanName || product?.name || "");
  if (pName) {
    const exact = candidates.filter((card) => {
      const names = [card.name, card.source_name].map(normalizeText).filter(Boolean);
      return names.some((name) => name === pName || pName.includes(name) || name.includes(pName));
    });
    if (exact.length === 1) return exact[0];
  }
  return null;
}

export function getTcgcsvCardRepairStatus() {
  const db = ensureSchema(getDb());
  const missing = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN recommended_price<=0 THEN 1 ELSE 0 END) AS prices,
    SUM(CASE WHEN COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='' THEN 1 ELSE 0 END) AS images,
    SUM(CASE WHEN (recommended_price<=0 OR COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
      AND (COALESCE(tcgcsv_checked_at,'')='' OR tcgcsv_checked_at<?) THEN 1 ELSE 0 END) AS pending
    FROM cards WHERE license_slug='pokemon' AND language='en' AND active=1`).get(new Date(Date.now() - RETRY_MS).toISOString()) || {};
  return { total: Number(missing.total || 0), missingPrices: Number(missing.prices || 0), missingImages: Number(missing.images || 0), pendingCards: Number(missing.pending || 0) };
}

export async function repairEnglishCardsWithTcgcsv({ groupLimit = 8 } = {}) {
  const db = ensureSchema(getDb());
  const groups = await loadGroups();
  const fx = await usdEur();
  if (!fx) throw new Error("TCGCSV card fallback: USD/EUR unavailable");
  const retryBefore = new Date(Date.now() - RETRY_MS).toISOString();
  const cards = db.prepare(`SELECT id,name,source_name,extension,source_extension,extension_code,number,image_hd,image_thumb,recommended_price
    FROM cards WHERE license_slug='pokemon' AND language='en' AND active=1
      AND (recommended_price<=0 OR COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
      AND (COALESCE(tcgcsv_checked_at,'')='' OR tcgcsv_checked_at<?)`).all(retryBefore);
  if (!cards.length) return { ok: true, groups: 0, matched: 0, priced: 0, images: 0, ...getTcgcsvCardRepairStatus() };

  const audit = new Map(db.prepare("SELECT group_id,checked_at FROM tcgcsv_card_group_audit").all().map((row) => [Number(row.group_id), row.checked_at || ""]));
  const candidateGroups = groups.filter((group) => {
    const checked = audit.get(Number(group.groupId));
    if (checked && checked >= retryBefore) return false;
    return cards.some((card) => sameGroup(card, group));
  }).slice(0, Math.min(Math.max(Number(groupLimit) || 8, 1), 20));
  if (!candidateGroups.length) return { ok: true, groups: 0, matched: 0, priced: 0, images: 0, ...getTcgcsvCardRepairStatus() };

  const now = new Date().toISOString();
  const updateImage = db.prepare(`UPDATE cards SET image_hd=CASE WHEN COALESCE(image_hd,'')='' THEN ? ELSE image_hd END,
    image_thumb=CASE WHEN COALESCE(image_thumb,'')='' THEN ? ELSE image_thumb END,
    image_language=CASE WHEN COALESCE(image_hd,'')='' THEN 'en' ELSE image_language END,
    image_source=CASE WHEN COALESCE(image_hd,'')='' THEN 'tcgcsv-tcgplayer' ELSE image_source END,
    tcgcsv_checked_at=?,updated_at=? WHERE id=?`);
  const updatePrice = db.prepare(`UPDATE cards SET avg_price=?,low_price=?,high_price=?,recommended_price=?,market_source='tcgplayer-tcgcsv',
    market_updated_at=?,market_checked_at=?,market_trend='stable',trend_percent=0,
    price_source_note='Prix TCGplayer US via TCGCSV converti en EUR; utilisé en fallback lorsque Cardmarket/TCGdex ne fournit pas de cote.',
    tcgcsv_checked_at=?,updated_at=? WHERE id=? AND recommended_price<=0`);
  const markChecked = db.prepare("UPDATE cards SET tcgcsv_checked_at=?,updated_at=? WHERE id=?");
  const deleteSource = db.prepare("DELETE FROM price_sources WHERE card_id=? AND source='tcgplayer'");
  const insertSource = db.prepare("INSERT INTO price_sources(card_id,source,price,currency,weight,fetched_at) VALUES (?,'tcgplayer',?,'EUR',0.45,?)");
  const insertHistory = db.prepare(`INSERT OR IGNORE INTO card_price_history(card_id,source,current_price,avg_price,low_price,high_price,avg1,avg7,avg30,captured_at)
    VALUES (?,'tcgplayer',?,?,?,?,0,0,0,?)`);
  const saveAudit = db.prepare(`INSERT INTO tcgcsv_card_group_audit(group_id,group_name,matched,priced,images,checked_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(group_id) DO UPDATE SET group_name=excluded.group_name,matched=excluded.matched,priced=excluded.priced,images=excluded.images,checked_at=excluded.checked_at`);

  let totalMatched = 0, totalPriced = 0, totalImages = 0, groupsRead = 0;
  for (const group of candidateGroups) {
    const groupId = Number(group.groupId || 0);
    const groupCards = cards.filter((card) => sameGroup(card, group));
    if (!groupCards.length) continue;
    const byNumber = new Map();
    for (const card of groupCards) {
      const key = cardNumber(card.number);
      if (!key) continue;
      const bucket = byNumber.get(key) || [];
      bucket.push(card); byNumber.set(key, bucket);
    }
    let matched = 0, priced = 0, images = 0;
    try {
      await sleep(REQUEST_DELAY_MS);
      const products = results(await fetchJson(`${BASE}/${CATEGORY_ID}/${groupId}/products`));
      await sleep(REQUEST_DELAY_MS);
      const priceRows = results(await fetchJson(`${BASE}/${CATEGORY_ID}/${groupId}/prices`));
      const pricesById = new Map();
      for (const row of priceRows) {
        const id = Number(row?.productId || 0); if (!id) continue;
        const bucket = pricesById.get(id) || []; bucket.push(row); pricesById.set(id, bucket);
      }
      db.transaction(() => {
        const seen = new Set();
        for (const product of products) {
          const card = chooseCard(product, byNumber);
          if (!card || seen.has(card.id)) continue;
          seen.add(card.id); matched += 1;
          const image = String(product?.imageUrl || "").trim();
          if (image && (!card.image_hd || !card.image_thumb)) {
            updateImage.run(image, image, now, now, card.id); images += 1;
          } else markChecked.run(now, now, card.id);
          const usd = productPrice(pricesById.get(Number(product?.productId || 0)) || []);
          if (Number(card.recommended_price || 0) <= 0 && usd.market > 0) {
            const market = round2(usd.market * fx), low = round2((usd.low || usd.market) * fx), high = round2((usd.high || usd.market) * fx);
            const changed = updatePrice.run(market, low, high, market, now, now, now, now, card.id).changes || 0;
            if (changed) {
              deleteSource.run(card.id); insertSource.run(card.id, market, now); insertHistory.run(card.id, market, market, low, high, now); priced += 1;
            }
          }
        }
        saveAudit.run(groupId, String(group?.name || ""), matched, priced, images, now);
      })();
      groupsRead += 1; totalMatched += matched; totalPriced += priced; totalImages += images;
      console.log(`[tcgcsv-card-repair] group=${groupId} ${String(group?.name || '')} matched=${matched} priced=${priced} images=${images}`);
    } catch (error) {
      console.warn(`[tcgcsv-card-repair] group=${groupId} failed`, error?.message || String(error));
    }
  }
  try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  const status = getTcgcsvCardRepairStatus();
  console.log(`[tcgcsv-card-repair] groups=${groupsRead} matched=${totalMatched} priced=${totalPriced} images=${totalImages} pending=${status.pendingCards}`);
  return { ok: true, groups: groupsRead, matched: totalMatched, priced: totalPriced, images: totalImages, ...status };
}
