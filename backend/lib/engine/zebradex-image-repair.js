import { getDb, normalizeText } from "./database.js";
import { scheduleEngineSnapshot } from "../marketplace/persistence.js";

const BASE = "https://zebradex.fr";
const MEDIA = "https://media-service.zebradex.fr";
const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SERIES_CACHE_MS = 6 * 60 * 60 * 1000;
const PAGE_CACHE_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT = 15000;
let seriesCache = { at: 0, rows: [] };
const pageCache = new Map();

function ensureColumn(db) {
  const cols = db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name);
  if (!cols.includes("zebradex_checked_at")) db.exec("ALTER TABLE cards ADD COLUMN zebradex_checked_at TEXT DEFAULT ''");
  if (!cols.includes("image_source")) db.exec("ALTER TABLE cards ADD COLUMN image_source TEXT DEFAULT ''");
  return db;
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function numberKey(value) {
  const raw = String(value || "").trim().split("/")[0].trim();
  const match = raw.match(/(\d+)$/);
  if (match) return String(Number(match[1]));
  return slug(raw);
}

function codeNumberKey(codeSlug) {
  const raw = String(codeSlug || "").toLowerCase();
  const match = raw.match(/(?:^|-)(\d+)$/);
  return match ? String(Number(match[1])) : numberKey(raw);
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
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Cardoria/6.0 ZebraDex exact-image-fallback" },
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

async function imageExists(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    let response = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Cardoria/6.0" }, signal: controller.signal });
    if (response.ok && String(response.headers.get("content-type") || "").toLowerCase().startsWith("image/")) return true;
    response = await fetch(url, { method: "GET", headers: { Range: "bytes=0-128", "User-Agent": "Cardoria/6.0" }, signal: controller.signal });
    return (response.ok || response.status === 206) && String(response.headers.get("content-type") || "").toLowerCase().startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function parseSeriesLinks(html) {
  const found = new Map();
  const anchor = /<a\b[^>]*href=["']([^"']*\/(fr|ja)\/tcg\/pokemon\/[^"']+\/(\d+))["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchor.exec(html))) {
    const href = match[1].startsWith("http") ? match[1] : BASE + (match[1].startsWith("/") ? match[1] : `/${match[1]}`);
    let url;
    try { url = new URL(href); } catch { continue; }
    const parts = url.pathname.split("/").filter(Boolean);
    const languageIndex = parts.indexOf(match[2]);
    const tcgIndex = parts.indexOf("tcg");
    if (languageIndex < 0 || tcgIndex < 0 || parts[tcgIndex + 1] !== "pokemon") continue;
    const seriesId = match[3];
    const seriesSlug = parts[parts.length - 2] || "";
    const setCode = parts[parts.length - 3] || "";
    const title = stripTags(match[4]);
    const key = `${match[2]}:${seriesId}`;
    found.set(key, { language: match[2], url: href, seriesId, seriesSlug, setCode, title });
  }
  return [...found.values()];
}

async function loadSeriesIndex() {
  if (seriesCache.rows.length && Date.now() - seriesCache.at < SERIES_CACHE_MS) return seriesCache.rows;
  const urls = [`${BASE}/series`, `${BASE}/series?lang=fr`, `${BASE}/series?lang=ja`];
  const pages = await Promise.all(urls.map(fetchText));
  const map = new Map();
  for (const html of pages) for (const row of parseSeriesLinks(html)) map.set(`${row.language}:${row.seriesId}`, row);
  seriesCache = { at: Date.now(), rows: [...map.values()] };
  console.log(`[zebradex-image-repair] indexed ${seriesCache.rows.length} public series`);
  return seriesCache.rows;
}

function chooseSeries(card, rows) {
  const zebraLanguage = card.language === "ja" ? "ja" : (card.language === "fr" || card.language === "en") ? "fr" : "";
  if (!zebraLanguage) return null;
  const candidates = rows.filter((row) => row.language === zebraLanguage);
  if (!candidates.length) return null;

  const extensionCode = String(card.extension_code || "").toLowerCase();
  if (extensionCode) {
    const exactCode = candidates.filter((row) => String(row.setCode || "").toLowerCase() === extensionCode);
    if (exactCode.length === 1) return exactCode[0];
    if (exactCode.length > 1) {
      const extensionSlug = slug(card.source_extension || card.extension);
      const exactName = exactCode.find((row) => row.seriesSlug === extensionSlug || slug(row.title) === extensionSlug);
      if (exactName) return exactName;
    }
  }

  const names = [card.extension, card.source_extension].map(slug).filter(Boolean)
    .filter((value) => !value.startsWith("extension-anglaise-") && !value.startsWith("extension-japonaise-"));
  for (const name of names) {
    const matched = candidates.filter((row) => row.seriesSlug === name || slug(row.title) === name);
    if (matched.length === 1) return matched[0];
  }
  return null;
}

function parseCardLinks(html, series) {
  const key = `${series.language}:${series.seriesId}`;
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return cached.cards;
  const cards = [];
  const hrefRegex = /href=["']([^"']+\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/(\d+))(?:[?#][^"']*)?["']/gi;
  let match;
  while ((match = hrefRegex.exec(html))) {
    const href = match[1];
    if (!href.includes(`/${series.language}/tcg/pokemon/`)) continue;
    const codeSlug = String(match[2] || "").toLowerCase();
    cards.push({ href, codeSlug, numberKey: codeNumberKey(codeSlug), nameSlug: String(match[3] || "").toLowerCase(), itemId: String(match[4] || "") });
  }
  const unique = [...new Map(cards.map((row) => [`${row.codeSlug}:${row.itemId}`, row])).values()];
  pageCache.set(key, { at: Date.now(), cards: unique });
  return unique;
}

async function loadSeriesCards(series) {
  const key = `${series.language}:${series.seriesId}`;
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return cached.cards;
  const html = await fetchText(series.url);
  if (!html) return [];
  return parseCardLinks(html, series);
}

function chooseCard(card, zebraCards) {
  const wantedNumber = numberKey(card.number);
  if (!wantedNumber) return null;
  let candidates = zebraCards.filter((row) => row.numberKey === wantedNumber);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const names = [card.name, card.source_name].map(slug).filter(Boolean);
  for (const name of names) {
    const exact = candidates.filter((row) => row.nameSlug === name || row.nameSlug.includes(name) || name.includes(row.nameSlug));
    if (exact.length === 1) return exact[0];
  }
  return null;
}

async function resolveZebraDex(card, seriesIndex) {
  const series = chooseSeries(card, seriesIndex);
  if (!series) return { reason: "series" };
  const zebraCards = await loadSeriesCards(series);
  if (!zebraCards.length) return { reason: "series_cards" };
  const matched = chooseCard(card, zebraCards);
  if (!matched) return { reason: "card" };
  const imageUrl = `${MEDIA}/images/pokemon/${series.language}/1/${series.seriesId}/item/${matched.itemId}.webp?v=5`;
  if (!(await imageExists(imageUrl))) return { reason: "image" };
  return { imageUrl, zebraLanguage: series.language, seriesId: series.seriesId, itemId: matched.itemId };
}

export function getZebraDexRepairStatus() {
  const db = ensureColumn(getDb());
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const row = db.prepare(`SELECT COUNT(*) AS missing,
    SUM(CASE WHEN language IN ('fr','en','ja') AND (COALESCE(zebradex_checked_at,'')='' OR zebradex_checked_at<?) THEN 1 ELSE 0 END) AS pending
    FROM cards WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')`).get(retryBefore);
  const byLanguage = db.prepare(`SELECT language,COUNT(*) AS missing,
    SUM(CASE WHEN language IN ('fr','en','ja') AND (COALESCE(zebradex_checked_at,'')='' OR zebradex_checked_at<?) THEN 1 ELSE 0 END) AS pending
    FROM cards WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='') GROUP BY language`).all(retryBefore);
  return {
    missing: Number(row?.missing || 0), pending: Number(row?.pending || 0),
    languages: Object.fromEntries(byLanguage.map((item) => [item.language, { missing: Number(item.missing || 0), pending: Number(item.pending || 0) }]))
  };
}

export async function repairImagesWithZebraDex({ limit = 100 } = {}) {
  const db = ensureColumn(getDb());
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const targets = db.prepare(`SELECT id,language,name,source_name,extension,source_extension,extension_code,number
    FROM cards WHERE license_slug='pokemon' AND language IN ('fr','en','ja') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
      AND (language='fr' OR COALESCE(image_repair_checked_at,'')<>'')
      AND (COALESCE(zebradex_checked_at,'')='' OR zebradex_checked_at<?)
    ORDER BY CASE language WHEN 'fr' THEN 0 WHEN 'ja' THEN 1 ELSE 2 END, id LIMIT ?`).all(retryBefore, safeLimit);
  if (!targets.length) return { ok: true, requested: 0, repaired: 0, unresolved: 0, ...getZebraDexRepairStatus() };

  const seriesIndex = await loadSeriesIndex();
  if (!seriesIndex.length) return { ok: false, requested: targets.length, repaired: 0, unresolved: targets.length, error: "zebradex_series_unavailable", ...getZebraDexRepairStatus() };

  const now = new Date().toISOString();
  const resolved = [], unresolved = [];
  const reasons = { series: 0, series_cards: 0, card: 0, image: 0 };
  for (const card of targets) {
    const image = await resolveZebraDex(card, seriesIndex);
    if (image?.imageUrl) resolved.push({ card, image });
    else { unresolved.push(card); if (image?.reason && Object.prototype.hasOwnProperty.call(reasons, image.reason)) reasons[image.reason] += 1; }
  }

  const update = db.prepare(`UPDATE cards SET image_hd=?,image_thumb=?,image_language=?,image_source='zebradex',zebradex_checked_at=?,updated_at=? WHERE id=?`);
  const mark = db.prepare("UPDATE cards SET zebradex_checked_at=? WHERE id=?");
  db.transaction(() => {
    for (const { card, image } of resolved) update.run(image.imageUrl, image.imageUrl, image.zebraLanguage, now, now, card.id);
    for (const card of unresolved) mark.run(now, card.id);
  })();
  const repairedFr = resolved.filter(({ card }) => card.language === "fr").length;
  if (repairedFr > 0) scheduleEngineSnapshot("zebradex-fr-image-repair", 30000);
  const status = getZebraDexRepairStatus();
  console.log(`[zebradex-image-repair] requested=${targets.length} repaired=${resolved.length} repaired-fr=${repairedFr} unresolved=${unresolved.length} reasons=series:${reasons.series},series-cards:${reasons.series_cards},card:${reasons.card},image:${reasons.image} remaining=${status.missing} pending=${status.pending}`);
  return { ok: true, requested: targets.length, repaired: resolved.length, repairedFr, unresolved: unresolved.length, reasons, ...status };
}
