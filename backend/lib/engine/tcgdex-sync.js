import { getDb, normalizeText, slugify } from "./database.js";
import { ensureDefaultLicenses } from "./licenses.js";

const API_ROOT = "https://api.tcgdex.net/v2";
const SOURCE = "tcgdex-multilingual";
const MAX_PRICE_BATCH = 2000;
const IMAGE_REPAIR_BATCH = 600;
const LANGUAGE_CONFIG = [
  { code: "fr", label: "Français", minimumExpected: 1000 },
  { code: "en", label: "Anglais", minimumExpected: 1000 },
  { code: "ja", label: "Japonais", minimumExpected: 100 },
  { code: "ko", label: "Coréen", minimumExpected: 1 }
];
const SUPPORTED_LANGUAGES = new Set(LANGUAGE_CONFIG.map((item) => item.code));

function normalizeLanguage(value, fallback = "fr") {
  const language = String(value || fallback).trim().toLowerCase();
  return SUPPORTED_LANGUAGES.has(language) ? language : fallback;
}
function imageUrl(base, quality) { if (!base) return ""; return `${String(base).replace(/\/$/, "")}/${quality}.webp`; }
function setIdFromCardId(cardId) { const id = String(cardId || ""); const pos = id.lastIndexOf("-"); return pos > 0 ? id.slice(0, pos) : ""; }
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function percent(current, base) { const c = Number(current || 0), b = Number(base || 0); return c > 0 && b > 0 ? round2(((c - b) / b) * 100) : 0; }
function marketDirection(change) { return change > 2 ? "up" : change < -2 ? "down" : "stable"; }
function languageLabel(language) { return LANGUAGE_CONFIG.find((item) => item.code === language)?.label || String(language || "").toUpperCase(); }
function catalogCardId(language, rawId) { return language === "fr" ? `pokemon-${rawId}` : `pokemon-${language}-${rawId}`; }
function rawCardId(cardId, language = "fr") {
  const id = String(cardId || "");
  const lang = normalizeLanguage(language);
  const prefix = lang === "fr" ? "pokemon-" : `pokemon-${lang}-`;
  if (id.startsWith(prefix)) return id.slice(prefix.length);
  return id.replace(/^pokemon-(?:en-|ja-|ko-)?/, "");
}

async function fetchJson(language, path) {
  const lang = normalizeLanguage(language);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${API_ROOT}/${lang}${path}`, { headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`TCGdex ${response.status} ${lang}${path}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export function pokemonHitFamily(rarity, name = "", variants = {}) {
  const r = normalizeText(rarity); const n = normalizeText(name);
  if (r.includes("hyper") || r.includes("gold") || r.includes("doree") || r === "ur") return "Gold";
  if (r.includes("special illustration") || r.includes("illustration speciale") || r.includes("sar")) return "SAR / Special Illustration Rare";
  if (r.includes("illustration rare") || r === "rare illustration" || r.includes("art rare") || r === "ar") return "AR / Illustration Rare";
  if (r.includes("secret")) return "Secret / Hyper Rare";
  if (r.includes("ultra rare")) return "Full Art / Ultra Rare";
  if (r.includes("double rare") || r.includes("doublement rare") || r === "rr") return "Double Rare";
  if (r.includes("amazing") || r.includes("shiny")) return "Secret / Hyper Rare";
  if (n.includes("vmax") || n.includes("vstar")) return "VMAX / VSTAR";
  if (/\b(ex|v)\b/i.test(String(name || ""))) return "V / ex";
  if (variants?.holo) return "Holo";
  if (variants?.reverse) return "Reverse Holo";
  if (r.includes("rare")) return "Rare";
  if (r.includes("uncommon") || r.includes("peu commune")) return "Peu Commune";
  if (r.includes("common") || r.includes("commune")) return "Commune";
  return "";
}

function cardmarketReference(pricing, variants = {}) {
  const cm = pricing?.cardmarket;
  if (!cm || String(cm.unit || "EUR").toUpperCase() !== "EUR") return null;
  const holo = variants?.holo && !variants?.normal;
  const pick = (...values) => values.find((v) => Number.isFinite(Number(v)) && Number(v) > 0);
  const avg1 = holo ? pick(cm["avg1-holo"], cm.avg1) : pick(cm.avg1, cm["avg1-holo"]);
  const avg7 = holo ? pick(cm["avg7-holo"], cm.avg7) : pick(cm.avg7, cm["avg7-holo"]);
  const avg30 = holo ? pick(cm["avg30-holo"], cm.avg30) : pick(cm.avg30, cm["avg30-holo"]);
  const trend = holo ? pick(cm["trend-holo"], cm.trend, avg1, avg7, avg30) : pick(cm.trend, avg1, avg7, avg30, cm["trend-holo"]);
  const avg = holo ? pick(cm["avg-holo"], avg7, trend, cm.avg) : pick(cm.avg, avg7, trend, cm["avg-holo"]);
  const low = holo ? pick(cm["low-holo"], cm.low, avg) : pick(cm.low, cm["low-holo"], avg);
  const high = Math.max(Number(avg || 0), Number(trend || 0), Number(avg1 || 0), Number(avg7 || 0), Number(avg30 || 0));
  const current = Number(trend || avg1 || avg7 || avg || 0);
  if (!current) return null;
  return { avg: round2(avg || current), low: round2(low || current), high: round2(high || current), recommended: round2(current), avg1: round2(avg1 || 0), avg7: round2(avg7 || 0), avg30: round2(avg30 || 0), change7: percent(current, avg7), change30: percent(current, avg30), updated: cm.updated || null };
}

function languageCounts(db) {
  const rows = db.prepare("SELECT language,COUNT(*) AS count FROM cards WHERE license_slug='pokemon' AND active=1 GROUP BY language").all();
  const counts = { fr: 0, en: 0, ja: 0, ko: 0 };
  rows.forEach((row) => { if (SUPPORTED_LANGUAGES.has(row.language)) counts[row.language] = Number(row.count || 0); });
  return counts;
}

function sameText(left, right) { return String(left ?? "") === String(right ?? ""); }
function catalogRowChanged(current, next) {
  if (!current || Number(current.active || 0) !== 1) return true;
  if (!sameText(current.language, next.language)) return true;
  if (!sameText(current.slug, next.slug)) return true;
  if (!sameText(current.name, next.name)) return true;
  if (!sameText(current.name_normalized, next.name_normalized)) return true;
  if (!sameText(current.extension, next.extension)) return true;
  if (!sameText(current.extension_code, next.extension_code)) return true;
  if (!sameText(current.number, next.number)) return true;
  if (next.image_hd && !sameText(current.image_hd, next.image_hd)) return true;
  if (next.image_thumb && !sameText(current.image_thumb, next.image_thumb)) return true;
  if (!sameText(current.meta_title, next.meta_title)) return true;
  if (!sameText(current.meta_description, next.meta_description)) return true;
  return false;
}

async function syncLanguageCatalog(db, config, { force = false } = {}) {
  const language = config.code;
  const beforeCount = Number(db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language=? AND active=1").get(language)?.c || 0);
  const cards = await fetchJson(language, "/cards");
  if (!Array.isArray(cards) || cards.length < config.minimumExpected) throw new Error(`TCGdex ${language}: catalogue incomplet (${Array.isArray(cards) ? cards.length : 0} cartes)`);
  let sets = [];
  try { sets = await fetchJson(language, "/sets"); } catch { sets = []; }
  const setMap = new Map((Array.isArray(sets) ? sets : []).map((set) => [String(set.id || ""), set]));
  const existingRows = db.prepare(`SELECT id,language,slug,name,name_normalized,extension,extension_code,number,image_hd,image_thumb,meta_title,meta_description,active
    FROM cards WHERE license_slug='pokemon' AND language=?`).all(language);
  const existingById = new Map(existingRows.map((row) => [String(row.id || ""), row]));
  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO cards (id,license_slug,language,slug,name,name_normalized,extension,extension_code,number,rarity,hit_family,variants_json,illustration,image_hd,image_thumb,condition_note,avg_price,low_price,high_price,recommended_price,market_trend,trend_percent,sales_count,views,meta_title,meta_description,active,created_at,updated_at)
    VALUES (@id,'pokemon',@language,@slug,@name,@name_normalized,@extension,@extension_code,@number,'','','{}','',@image_hd,@image_thumb,'NM',0,0,0,0,'stable',0,0,0,@meta_title,@meta_description,1,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET license_slug='pokemon',language=excluded.language,slug=excluded.slug,name=excluded.name,name_normalized=excluded.name_normalized,extension=excluded.extension,extension_code=excluded.extension_code,number=excluded.number,image_hd=CASE WHEN excluded.image_hd<>'' THEN excluded.image_hd ELSE cards.image_hd END,image_thumb=CASE WHEN excluded.image_thumb<>'' THEN excluded.image_thumb ELSE cards.image_thumb END,meta_title=excluded.meta_title,meta_description=excluded.meta_description,active=1,updated_at=excluded.updated_at`);
  let existing = 0, created = 0, updated = 0, unchanged = 0, failed = 0, withoutImage = 0;
  db.transaction(() => {
    for (const raw of cards) {
      if (!raw?.id || !raw?.name) { failed += 1; continue; }
      const setId = setIdFromCardId(raw.id), set = setMap.get(setId), extension = String(set?.name || setId || ""), localId = String(raw.localId ?? ""), baseImage = String(raw.image || "");
      if (!baseImage) withoutImage += 1;
      const prefix = language === "fr" ? "" : `${language}-`;
      const next = { id: catalogCardId(language, raw.id), language, slug: slugify(`${prefix}${raw.name}-${extension}-${localId}-${raw.id}`), name: String(raw.name), name_normalized: normalizeText(raw.name), extension, extension_code: setId, number: localId, image_hd: imageUrl(baseImage, "high"), image_thumb: imageUrl(baseImage, "low"), meta_title: `${raw.name} — ${extension} (${config.label}) | Cardoria`, meta_description: `Fiche de la carte Pokémon ${raw.name}${extension ? `, extension ${extension}` : ""}${localId ? `, numéro ${localId}` : ""}, langue ${config.label}.`, created_at: now, updated_at: now };
      const current = existingById.get(next.id);
      if (!current) {
        upsert.run(next);
        created += 1;
        existingById.set(next.id, { ...next, active: 1 });
        continue;
      }
      existing += 1;
      if (!catalogRowChanged(current, next)) { unchanged += 1; continue; }
      upsert.run(next);
      updated += 1;
      existingById.set(next.id, { ...current, ...next, active: 1 });
    }
  })();
  const count = Number(db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language=? AND active=1").get(language)?.c || 0);
  const imported = created + updated;
  return { language, label: config.label, skipped: imported === 0, forced: Boolean(force), count, beforeCount, totalSource: cards.length, existing, created, updated, unchanged, failed, imported, sets: setMap.size, withoutImage, syncedAt: now };
}

export async function syncPokemonCatalog({ force = false, languages = ["fr", "en", "ja", "ko"] } = {}) {
  ensureDefaultLicenses();
  const db = getDb();
  const requested = [...new Set((Array.isArray(languages) ? languages : [languages]).map((value) => normalizeLanguage(value)).filter(Boolean))];
  const summaries = [];
  let imported = 0, created = 0, updated = 0, unchanged = 0, existing = 0, failed = 0, totalSource = 0, sets = 0, withoutImage = 0;
  for (const config of LANGUAGE_CONFIG.filter((item) => requested.includes(item.code))) {
    try {
      const result = await syncLanguageCatalog(db, config, { force });
      summaries.push({ ...result, ok: true });
      imported += Number(result.imported || 0); created += Number(result.created || 0); updated += Number(result.updated || 0); unchanged += Number(result.unchanged || 0); existing += Number(result.existing || 0); failed += Number(result.failed || 0); totalSource += Number(result.totalSource || 0); sets += Number(result.sets || 0); withoutImage += Number(result.withoutImage || 0);
      console.log(`[pokemon-catalog:${config.code}] source=${result.totalSource} existing=${result.existing} created=${result.created} updated=${result.updated} unchanged=${result.unchanged} failed=${result.failed} total=${result.count}`);
    } catch (error) {
      const message = error?.message || String(error);
      failed += 1;
      summaries.push({ language: config.code, label: config.label, ok: false, skipped: false, forced: Boolean(force), totalSource: 0, existing: 0, created: 0, updated: 0, unchanged: 0, failed: 1, imported: 0, count: Number(db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language=? AND active=1").get(config.code)?.c || 0), error: message });
      console.warn(`[pokemon-catalog:${config.code}] reconciliation failed: ${message}`);
    }
  }
  if (imported > 0) {
    try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  }
  const counts = languageCounts(db);
  const count = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const failures = summaries.filter((item) => !item.ok);
  const hasUsableCatalog = counts.fr >= 1000 || count >= 1000;
  if (!hasUsableCatalog && failures.length) throw new Error(failures.map((item) => `${item.language}: ${item.error}`).join(" · "));
  return { ok: true, skipped: imported === 0, partial: failures.length > 0, forced: Boolean(force), source: SOURCE, totalSource, existing, created, updated, unchanged, failed, imported, count, sets, withoutImage, languageCounts: counts, languages: summaries, syncedAt: new Date().toISOString() };
}

export async function syncPokemonReferenceCatalog({ priceLimit = 120, skipRarities = false, language = "fr" } = {}) {
  ensureDefaultLicenses();
  const lang = normalizeLanguage(language);
  const db = getDb();
  let rarities = [], rarityUpdated = 0;
  if (!skipRarities) {
    rarities = await fetchJson(lang, "/rarities");
    if (!Array.isArray(rarities)) throw new Error(`TCGdex ${lang}: raretés indisponibles`);
    const updateRarity = db.prepare("UPDATE cards SET rarity=?,hit_family=? WHERE id=? AND license_slug='pokemon' AND language=?");
    const rarityResults = await Promise.all(rarities.map(async (rarity) => ({ rarity: String(rarity), cards: await fetchJson(lang, `/cards?rarity=eq:${encodeURIComponent(String(rarity))}`) })));
    db.transaction(() => { for (const group of rarityResults) for (const raw of (Array.isArray(group.cards) ? group.cards : [])) { const id = catalogCardId(lang, raw.id), family = pokemonHitFamily(group.rarity, raw.name); rarityUpdated += updateRarity.run(group.rarity, family, id, lang).changes || 0; } })();
  }
  const requestedPriceLimit = Number(priceLimit);
  const safePriceLimit = Number.isFinite(requestedPriceLimit) ? Math.max(0, Math.min(requestedPriceLimit, MAX_PRICE_BATCH)) : 120;
  const missingImagesBefore = Number(db.prepare(`SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language=? AND active=1 AND (image_hd='' OR image_hd IS NULL OR image_thumb='' OR image_thumb IS NULL)`).get(lang)?.c || 0);
  const effectiveLimit = missingImagesBefore > 0 ? Math.max(safePriceLimit, IMAGE_REPAIR_BATCH) : safePriceLimit;
  const candidates = effectiveLimit > 0 ? db.prepare(`SELECT id,name,image_hd,image_thumb,language FROM cards WHERE license_slug='pokemon' AND language=? AND active=1 ORDER BY CASE WHEN image_hd='' OR image_hd IS NULL OR image_thumb='' OR image_thumb IS NULL THEN 0 ELSE 1 END, CASE WHEN recommended_price<=0 THEN 0 ELSE 1 END, CASE WHEN market_checked_at='' OR market_checked_at IS NULL THEN 0 ELSE 1 END, market_checked_at ASC, updated_at ASC LIMIT ?`).all(lang, effectiveLimit) : [];
  const updateDetail = db.prepare(`UPDATE cards SET rarity=?,hit_family=?,variants_json=?,illustration=?,image_hd=CASE WHEN ?<>'' THEN ? ELSE image_hd END,image_thumb=CASE WHEN ?<>'' THEN ? ELSE image_thumb END,avg_price=?,low_price=?,high_price=?,recommended_price=?,market_avg1=?,market_avg7=?,market_avg30=?,market_source=?,market_updated_at=?,market_checked_at=?,market_trend=?,trend_percent=?,updated_at=? WHERE id=?`);
  const updateWithoutPrice = db.prepare(`UPDATE cards SET rarity=?,hit_family=?,variants_json=?,illustration=?,image_hd=CASE WHEN ?<>'' THEN ? ELSE image_hd END,image_thumb=CASE WHEN ?<>'' THEN ? ELSE image_thumb END,market_checked_at=?,updated_at=? WHERE id=?`);
  const markChecked = db.prepare("UPDATE cards SET market_checked_at=? WHERE id=?");
  const deleteSource = db.prepare("DELETE FROM price_sources WHERE card_id=? AND source='cardmarket'");
  const insertSource = db.prepare("INSERT INTO price_sources(card_id,source,price,currency,weight,fetched_at) VALUES (?,'cardmarket',?,'EUR',0.55,?)");
  const insertHistory = db.prepare(`INSERT OR IGNORE INTO card_price_history(card_id,source,current_price,avg_price,low_price,high_price,avg1,avg7,avg30,captured_at) VALUES (?,'cardmarket',?,?,?,?,?,?,?,?)`);
  let detailed = 0, priced = 0, rising = 0, falling = 0, stable = 0, unavailable = 0, imagesRepaired = 0;
  for (let i = 0; i < candidates.length; i += 10) {
    const batch = candidates.slice(i, i + 10);
    const details = await Promise.all(batch.map(async (c) => { try { return await fetchJson(lang, `/cards/${encodeURIComponent(rawCardId(c.id, lang))}`); } catch { return null; } }));
    db.transaction(() => {
      details.forEach((raw, index) => {
        const candidate = batch[index], cardId = candidate.id, stampedAt = new Date().toISOString();
        if (!raw) { markChecked.run(stampedAt, cardId); unavailable += 1; return; }
        const variants = raw.variants || {}, rarity = String(raw.rarity || ""), family = pokemonHitFamily(rarity, raw.name, variants), price = cardmarketReference(raw.pricing, variants), baseImage = String(raw.image || ""), imageHd = imageUrl(baseImage, "high"), imageThumb = imageUrl(baseImage, "low");
        if (baseImage && (!candidate.image_hd || !candidate.image_thumb)) imagesRepaired += 1;
        if (!price) { updateWithoutPrice.run(rarity, family, JSON.stringify(variants), String(raw.illustrator || ""), imageHd, imageHd, imageThumb, imageThumb, stampedAt, stampedAt, cardId); detailed += 1; unavailable += 1; return; }
        const direction = marketDirection(price.change7);
        updateDetail.run(rarity, family, JSON.stringify(variants), String(raw.illustrator || ""), imageHd, imageHd, imageThumb, imageThumb, price.avg, price.low, price.high, price.recommended, price.avg1, price.avg7, price.avg30, "cardmarket", price.updated || stampedAt, stampedAt, direction, price.change7, stampedAt, cardId);
        deleteSource.run(cardId); insertSource.run(cardId, price.recommended, price.updated || stampedAt); insertHistory.run(cardId, price.recommended, price.avg, price.low, price.high, price.avg1, price.avg7, price.avg30, price.updated || stampedAt);
        priced += 1; detailed += 1; if (direction === "up") rising += 1; else if (direction === "down") falling += 1; else stable += 1;
      });
    })();
  }
  try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  const missingImagesAfter = Number(db.prepare(`SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language=? AND active=1 AND (image_hd='' OR image_hd IS NULL OR image_thumb='' OR image_thumb IS NULL)`).get(lang)?.c || 0);
  return { ok: true, language: lang, languageLabel: languageLabel(lang), source: `${SOURCE}-${lang}`, rarities: rarities.length, rarityUpdated, detailed, priced, unavailable, rising, falling, stable, priceLimit: candidates.length, maxPriceBatch: MAX_PRICE_BATCH, imageRepairBatch: IMAGE_REPAIR_BATCH, imagesRepaired, missingImagesBefore, missingImagesAfter, syncedAt: new Date().toISOString() };
}

export function getMarketPriceStatus({ language = "fr" } = {}) {
  const db = getDb(), lang = normalizeLanguage(language);
  const totals = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN recommended_price>0 THEN 1 ELSE 0 END) AS priced, SUM(CASE WHEN market_trend='up' THEN 1 ELSE 0 END) AS rising, SUM(CASE WHEN market_trend='down' THEN 1 ELSE 0 END) AS falling, SUM(CASE WHEN market_trend='stable' AND recommended_price>0 THEN 1 ELSE 0 END) AS stable, SUM(CASE WHEN image_hd='' OR image_hd IS NULL OR image_thumb='' OR image_thumb IS NULL THEN 1 ELSE 0 END) AS missingImages, MAX(market_checked_at) AS lastCheckedAt, MAX(market_updated_at) AS lastMarketUpdate FROM cards WHERE license_slug='pokemon' AND language=? AND active=1`).get(lang);
  return { language: lang, languageLabel: languageLabel(lang), total: Number(totals?.total || 0), priced: Number(totals?.priced || 0), rising: Number(totals?.rising || 0), falling: Number(totals?.falling || 0), stable: Number(totals?.stable || 0), missingImages: Number(totals?.missingImages || 0), lastCheckedAt: totals?.lastCheckedAt || "", lastMarketUpdate: totals?.lastMarketUpdate || "", source: "Cardmarket via TCGdex" };
}

export function getCardPriceHistory(cardId, limit = 90) { return getDb().prepare(`SELECT source,current_price AS current,avg_price AS avg,low_price AS low,high_price AS high,avg1,avg7,avg30,captured_at AS capturedAt FROM card_price_history WHERE card_id=? ORDER BY captured_at DESC LIMIT ?`).all(cardId, Math.min(Math.max(Number(limit) || 90, 1), 365)); }
