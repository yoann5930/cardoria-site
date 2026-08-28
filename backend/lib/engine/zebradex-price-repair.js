import { getDb, normalizeText } from "./database.js";

const BASE = "https://zebradex.fr";
const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const SERIES_CACHE_MS = 6 * 60 * 60 * 1000;
const PAGE_CACHE_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT = 15000;
const CONCURRENCY = 6;
const DEFAULT_BATCH = 240;
let seriesCache = { at: 0, rows: [] };
const pageCache = new Map();

function ensureColumns(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name));
  if (!cols.has("zebradex_price_checked_at")) db.exec("ALTER TABLE cards ADD COLUMN zebradex_price_checked_at TEXT DEFAULT ''");
  if (!cols.has("price_source_note")) db.exec("ALTER TABLE cards ADD COLUMN price_source_note TEXT DEFAULT ''");
  return db;
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&ecirc;/g, "ê")
    .replace(/&agrave;/g, "à").replace(/&ccedil;/g, "ç").replace(/&ocirc;/g, "ô")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Cardoria/6.0 ZebraDex verified-price-fallback" },
      signal: controller.signal
    });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function parseSeriesLinks(html) {
  const found = new Map();
  const anchor = /<a\b[^>]*href=["']([^"']*\/ja\/tcg\/pokemon\/[^"']+\/(\d+))["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchor.exec(html))) {
    const href = match[1].startsWith("http") ? match[1] : BASE + (match[1].startsWith("/") ? match[1] : `/${match[1]}`);
    let url;
    try { url = new URL(href); } catch { continue; }
    const parts = url.pathname.split("/").filter(Boolean);
    const tcgIndex = parts.indexOf("tcg");
    if (tcgIndex < 0 || parts[tcgIndex + 1] !== "pokemon") continue;
    const seriesId = match[2];
    const seriesSlug = parts[parts.length - 2] || "";
    const setCode = parts[parts.length - 3] || "";
    found.set(seriesId, { language: "ja", url: href, seriesId, seriesSlug, setCode, title: stripTags(match[3]) });
  }
  return [...found.values()];
}

async function loadSeriesIndex() {
  if (seriesCache.rows.length && Date.now() - seriesCache.at < SERIES_CACHE_MS) return seriesCache.rows;
  const pages = await Promise.all([`${BASE}/series`, `${BASE}/series?lang=ja`].map(fetchText));
  const map = new Map();
  for (const html of pages) for (const row of parseSeriesLinks(html)) map.set(row.seriesId, row);
  seriesCache = { at: Date.now(), rows: [...map.values()] };
  console.log(`[zebradex-price-repair] indexed ${seriesCache.rows.length} Japanese public series`);
  return seriesCache.rows;
}

function chooseSeries(card, rows) {
  const extensionCode = String(card.extension_code || "").toLowerCase();
  if (extensionCode) {
    const exactCode = rows.filter((row) => String(row.setCode || "").toLowerCase() === extensionCode);
    if (exactCode.length === 1) return exactCode[0];
    if (exactCode.length > 1) {
      const extensionSlug = slug(card.source_extension || card.extension);
      const exactName = exactCode.find((row) => row.seriesSlug === extensionSlug || slug(row.title) === extensionSlug);
      if (exactName) return exactName;
    }
  }
  const names = [card.extension, card.source_extension].map(slug).filter(Boolean).filter((value) => !value.startsWith("extension-japonaise-"));
  for (const name of names) {
    const matched = rows.filter((row) => row.seriesSlug === name || slug(row.title) === name);
    if (matched.length === 1) return matched[0];
  }
  return null;
}

function parseCardLinks(html, series) {
  const key = series.seriesId;
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return cached.cards;
  const cards = [];
  const hrefRegex = /href=["']([^"']+\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/(\d+))(?:[?#][^"']*)?["']/gi;
  let match;
  while ((match = hrefRegex.exec(html))) {
    const rawHref = match[1];
    if (!rawHref.includes("/ja/tcg/pokemon/")) continue;
    const href = rawHref.startsWith("http") ? rawHref : BASE + (rawHref.startsWith("/") ? rawHref : `/${rawHref}`);
    cards.push({ href, codeSlug: String(match[2] || "").toLowerCase(), nameSlug: String(match[3] || "").toLowerCase(), itemId: String(match[4] || "") });
  }
  const unique = [...new Map(cards.map((row) => [`${row.codeSlug}:${row.itemId}`, row])).values()];
  pageCache.set(key, { at: Date.now(), cards: unique });
  return unique;
}

async function loadSeriesCards(series) {
  const cached = pageCache.get(series.seriesId);
  if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return cached.cards;
  const html = await fetchText(series.url);
  if (!html) return [];
  return parseCardLinks(html, series);
}

function chooseCard(card, zebraCards) {
  const numberSlug = slug(card.number);
  if (!numberSlug) return null;
  const suffix = `-${numberSlug}`;
  let candidates = zebraCards.filter((row) => row.codeSlug === numberSlug || row.codeSlug.endsWith(suffix));
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const names = [card.name, card.source_name].map(slug).filter(Boolean);
  for (const name of names) {
    const exact = candidates.filter((row) => row.nameSlug === name || row.nameSlug.includes(name) || name.includes(row.nameSlug));
    if (exact.length === 1) return exact[0];
  }
  return null;
}

function euro(value) {
  const normalized = String(value || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

function parsePrice(html) {
  const text = stripTags(html);
  const currentMatch = text.match(/Prix estim[eé](?:\s+i)?\s+([0-9][0-9\s.,]*)\s*€/i)
    || text.match(/prix estim[eé]\s+[àa]\s+([0-9][0-9\s.,]*)\s*€/i)
    || text.match(/prix moyen observ[eé][^0-9]{0,80}([0-9][0-9\s.,]*)\s*€/i);
  const current = euro(currentMatch?.[1]);
  if (!current) return null;
  const low = euro(text.match(/Bas\s+([0-9][0-9\s.,]*)\s*€/i)?.[1]) || current;
  const high = euro(text.match(/Haut\s+([0-9][0-9\s.,]*)\s*€/i)?.[1]) || current;
  const change7 = Number(String(text.match(/7j\s*:\s*([+-]?[0-9]+(?:[.,][0-9]+)?)\s*%/i)?.[1] || "0").replace(",", ".")) || 0;
  return { current, low, high, change7 };
}

async function resolvePrice(card, seriesIndex) {
  const series = chooseSeries(card, seriesIndex);
  if (!series) return null;
  const cards = await loadSeriesCards(series);
  const matched = chooseCard(card, cards);
  if (!matched?.href) return null;
  const html = await fetchText(matched.href);
  const price = parsePrice(html);
  return price ? { ...price, url: matched.href, seriesId: series.seriesId, itemId: matched.itemId } : null;
}

export function getZebraDexPriceRepairStatus() {
  const db = ensureColumns(getDb());
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const row = db.prepare(`SELECT COUNT(*) AS missing,
    SUM(CASE WHEN recommended_price<=0 AND COALESCE(market_checked_at,'')<>'' AND (COALESCE(zebradex_price_checked_at,'')='' OR zebradex_price_checked_at<?) THEN 1 ELSE 0 END) AS pending
    FROM cards WHERE license_slug='pokemon' AND language='ja' AND active=1 AND recommended_price<=0`).get(retryBefore);
  return { missing: Number(row?.missing || 0), pending: Number(row?.pending || 0) };
}

export async function repairJapanesePricesWithZebraDex({ limit = DEFAULT_BATCH } = {}) {
  const db = ensureColumns(getDb());
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_BATCH, 1), 500);
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const targets = db.prepare(`SELECT id,name,source_name,extension,source_extension,extension_code,number
    FROM cards WHERE license_slug='pokemon' AND language='ja' AND active=1 AND recommended_price<=0
      AND COALESCE(market_checked_at,'')<>''
      AND (COALESCE(zebradex_price_checked_at,'')='' OR zebradex_price_checked_at<?)
    ORDER BY CASE WHEN COALESCE(zebradex_price_checked_at,'')='' THEN 0 ELSE 1 END,zebradex_price_checked_at,id LIMIT ?`).all(retryBefore, safeLimit);
  if (!targets.length) return { ok: true, requested: 0, priced: 0, unavailable: 0, ...getZebraDexPriceRepairStatus() };

  const seriesIndex = await loadSeriesIndex();
  if (!seriesIndex.length) return { ok: false, requested: targets.length, priced: 0, unavailable: targets.length, error: "zebradex_series_unavailable", ...getZebraDexPriceRepairStatus() };

  const results = [];
  for (let offset = 0; offset < targets.length; offset += CONCURRENCY) {
    const batch = targets.slice(offset, offset + CONCURRENCY);
    results.push(...await Promise.all(batch.map(async (card) => ({ card, price: await resolvePrice(card, seriesIndex) }))));
  }

  const now = new Date().toISOString();
  const update = db.prepare(`UPDATE cards SET avg_price=?,low_price=?,high_price=?,recommended_price=?,market_source='zebradex',
    market_updated_at=?,market_checked_at=?,market_trend=?,trend_percent=?,zebradex_price_checked_at=?,
    price_source_note='Cote japonaise ZebraDex utilisée en fallback après absence de prix Cardmarket/TCGdex.',updated_at=? WHERE id=? AND recommended_price<=0`);
  const mark = db.prepare("UPDATE cards SET zebradex_price_checked_at=?,updated_at=? WHERE id=?");
  const deleteSource = db.prepare("DELETE FROM price_sources WHERE card_id=? AND source='zebradex'");
  const insertSource = db.prepare("INSERT INTO price_sources(card_id,source,price,currency,weight,fetched_at) VALUES (?,'zebradex',?,'EUR',0.45,?)");
  const insertHistory = db.prepare(`INSERT OR IGNORE INTO card_price_history(card_id,source,current_price,avg_price,low_price,high_price,avg1,avg7,avg30,captured_at)
    VALUES (?,'zebradex',?,?,?,?,0,0,0,?)`);
  let priced = 0, unavailable = 0;
  db.transaction(() => {
    for (const { card, price } of results) {
      if (!price) { mark.run(now, now, card.id); unavailable += 1; continue; }
      const trend = price.change7 > 2 ? "up" : price.change7 < -2 ? "down" : "stable";
      const changed = update.run(price.current, price.low, price.high, price.current, now, now, trend, price.change7, now, now, card.id).changes || 0;
      if (!changed) continue;
      deleteSource.run(card.id);
      insertSource.run(card.id, price.current, now);
      insertHistory.run(card.id, price.current, price.current, price.low, price.high, now);
      priced += 1;
    }
  })();
  const status = getZebraDexPriceRepairStatus();
  console.log(`[zebradex-price-repair] requested=${targets.length} priced=${priced} unavailable=${unavailable} missing=${status.missing} pending=${status.pending}`);
  return { ok: true, requested: targets.length, priced, unavailable, ...status };
}
