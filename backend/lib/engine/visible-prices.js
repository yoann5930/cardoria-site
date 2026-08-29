import { getDb, normalizeText } from "./database.js";

const API_ROOT = "https://api.tcgdex.net/v2";
const VISIBLE_LIMIT = 100;
const RETRY_MISSING_AFTER_MS = 6 * 60 * 60 * 1000;
const SUPPORTED_LANGUAGES = new Set(["fr", "en", "ja", "ko"]);

function normalizeLanguage(value) { const v = String(value || "fr").toLowerCase(); return SUPPORTED_LANGUAGES.has(v) ? v : "fr"; }
function rawCardId(cardId, language) {
  const lang = normalizeLanguage(language), id = String(cardId || ""), prefix = lang === "fr" ? "pokemon-" : `pokemon-${lang}-`;
  if (id.startsWith(prefix)) return id.slice(prefix.length);
  return id.replace(/^pokemon-(?:en-|ja-|ko-)?/, "");
}
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function percent(current, base) { const c = Number(current || 0), b = Number(base || 0); return c > 0 && b > 0 ? round2(((c - b) / b) * 100) : 0; }
function marketDirection(change) { return change > 2 ? "up" : change < -2 ? "down" : "stable"; }
function shouldRetryMissing(row) {
  if (Number(row?.recommended_price || 0) > 0) return false;
  if (!row?.market_checked_at) return true;
  const checkedAt = Date.parse(row.market_checked_at);
  return !Number.isFinite(checkedAt) || (Date.now() - checkedAt) >= RETRY_MISSING_AFTER_MS;
}

async function fetchJson(language, path) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000), lang = normalizeLanguage(language);
  try {
    const response = await fetch(`${API_ROOT}/${lang}${path}`, { headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`TCGdex ${response.status} ${lang}${path}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function hitFamily(rarity, name = "", variants = {}) {
  const r = normalizeText(rarity), n = normalizeText(name);
  if (r.includes("hyper") || r.includes("gold") || r.includes("doree") || r === "ur") return "Gold";
  if (r.includes("special illustration") || r.includes("illustration speciale") || r.includes("sar")) return "SAR / Special Illustration Rare";
  if (r.includes("illustration rare") || r.includes("art rare") || r === "ar") return "AR / Illustration Rare";
  if (r.includes("secret")) return "Secret / Hyper Rare";
  if (r.includes("ultra rare")) return "Full Art / Ultra Rare";
  if (r.includes("double rare") || r.includes("doublement rare") || r === "rr") return "Double Rare";
  if (n.includes("vmax") || n.includes("vstar")) return "VMAX / VSTAR";
  if (/\b(ex|v)\b/i.test(String(name || ""))) return "V / ex";
  if (variants?.holo) return "Holo";
  if (variants?.reverse) return "Reverse Holo";
  if (r.includes("rare")) return "Rare";
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
  const current = Number(trend || avg1 || avg7 || avg || 0);
  if (!current) return null;
  const high = Math.max(Number(avg || 0), Number(current || 0), Number(avg1 || 0), Number(avg7 || 0), Number(avg30 || 0));
  return { current: round2(current), avg: round2(avg || current), low: round2(low || current), high: round2(high || current), avg1: round2(avg1 || 0), avg7: round2(avg7 || 0), avg30: round2(avg30 || 0), updated: cm.updated || null };
}

export async function refreshVisibleCardPrices(ids = [], { retryMissingNow = true } = {}) {
  const cleanIds = [...new Set((ids || []).map(String).filter((id) => /^pokemon-(?:en-|ja-|ko-)?[a-zA-Z0-9_.-]+$/.test(id)))].slice(0, VISIBLE_LIMIT);
  if (!cleanIds.length) return { ok: true, requested: 0, checked: 0, priced: 0, unavailable: 0 };
  const db = getDb();
  const select = db.prepare("SELECT id,language,market_checked_at,recommended_price FROM cards WHERE id=? AND license_slug='pokemon' AND active=1");
  const update = db.prepare(`UPDATE cards SET rarity=?,hit_family=?,variants_json=?,illustration=?,avg_price=?,low_price=?,high_price=?,recommended_price=?,market_avg1=?,market_avg7=?,market_avg30=?,market_source=?,market_updated_at=?,market_checked_at=?,market_trend=?,trend_percent=?,updated_at=? WHERE id=?`);
  const updateWithoutPrice = db.prepare(`UPDATE cards SET rarity=?,hit_family=?,variants_json=?,illustration=?,market_checked_at=?,updated_at=? WHERE id=?`);
  const markChecked = db.prepare("UPDATE cards SET market_checked_at=? WHERE id=?");
  const deleteSource = db.prepare("DELETE FROM price_sources WHERE card_id=? AND source='cardmarket'");
  const insertSource = db.prepare("INSERT INTO price_sources(card_id,source,price,currency,weight,fetched_at) VALUES (?,'cardmarket',?,'EUR',0.55,?)");
  const insertHistory = db.prepare(`INSERT OR IGNORE INTO card_price_history(card_id,source,current_price,avg_price,low_price,high_price,avg1,avg7,avg30,captured_at) VALUES (?,'cardmarket',?,?,?,?,?,?,?,?)`);
  const rows = cleanIds.map((id) => select.get(id)).filter(Boolean);
  const candidates = rows.filter((row) => Number(row?.recommended_price || 0) <= 0 && (retryMissingNow || shouldRetryMissing(row)));
  let checked = 0, priced = 0, unavailable = 0;
  for (let i = 0; i < candidates.length; i += 8) {
    const batch = candidates.slice(i, i + 8);
    const details = await Promise.all(batch.map(async (c) => { try { return await fetchJson(c.language, `/cards/${encodeURIComponent(rawCardId(c.id, c.language))}`); } catch { return null; } }));
    db.transaction(() => {
      details.forEach((raw, index) => {
        const card = batch[index], cardId = card.id, stampedAt = new Date().toISOString(); checked += 1;
        if (!raw) { markChecked.run(stampedAt, cardId); unavailable += 1; return; }
        const variants = raw.variants || {}, rarity = String(raw.rarity || ""), family = hitFamily(rarity, raw.name, variants), price = cardmarketReference(raw.pricing, variants);
        if (!price) { updateWithoutPrice.run(rarity, family, JSON.stringify(variants), String(raw.illustrator || ""), stampedAt, stampedAt, cardId); unavailable += 1; return; }
        const change7 = percent(price.current, price.avg7), direction = marketDirection(change7);
        update.run(rarity, family, JSON.stringify(variants), String(raw.illustrator || ""), price.avg, price.low, price.high, price.current, price.avg1, price.avg7, price.avg30, "cardmarket", price.updated || stampedAt, stampedAt, direction, change7, stampedAt, cardId);
        deleteSource.run(cardId); insertSource.run(cardId, price.current, price.updated || stampedAt); insertHistory.run(cardId, price.current, price.avg, price.low, price.high, price.avg1, price.avg7, price.avg30, price.updated || stampedAt); priced += 1;
      });
    })();
  }
  return { ok: true, requested: rows.length, checked, priced, unavailable };
}
