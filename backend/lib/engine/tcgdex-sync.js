import { getDb, normalizeText, slugify } from "./database.js";
import { ensureDefaultLicenses } from "./licenses.js";

const API = "https://api.tcgdex.net/v2/fr";
const SOURCE = "tcgdex-fr";

function imageUrl(base, quality) { if (!base) return ""; return `${String(base).replace(/\/$/, "")}/${quality}.webp`; }
function setIdFromCardId(cardId) { const id = String(cardId || ""); const pos = id.lastIndexOf("-"); return pos > 0 ? id.slice(0, pos) : ""; }
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function percent(current, base) {
  const c = Number(current || 0), b = Number(base || 0);
  return c > 0 && b > 0 ? round2(((c - b) / b) * 100) : 0;
}
function marketDirection(change) { return change > 2 ? "up" : change < -2 ? "down" : "stable"; }

async function fetchJson(path) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(API + path, { headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`TCGdex ${response.status} ${path}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export function pokemonHitFamily(rarity, name = "", variants = {}) {
  const r = normalizeText(rarity); const n = normalizeText(name);
  if (r.includes("hyper") || r.includes("gold") || r.includes("doree")) return "Gold";
  if (r.includes("special illustration") || r.includes("illustration speciale") || r.includes("sar")) return "SAR / Special Illustration Rare";
  if (r.includes("illustration rare") || r === "rare illustration" || r.includes("art rare") || r === "ar") return "AR / Illustration Rare";
  if (r.includes("secret")) return "Secret / Hyper Rare";
  if (r.includes("ultra rare")) return "Full Art / Ultra Rare";
  if (r.includes("double rare") || r.includes("doublement rare")) return "Double Rare";
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
  return {
    avg: round2(avg || current),
    low: round2(low || current),
    high: round2(high || current),
    recommended: round2(current),
    avg1: round2(avg1 || 0),
    avg7: round2(avg7 || 0),
    avg30: round2(avg30 || 0),
    change7: percent(current, avg7),
    change30: percent(current, avg30),
    updated: cm.updated || null
  };
}

export async function syncPokemonCatalog({ force = false } = {}) {
  ensureDefaultLicenses(); const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND active=1").get()?.c ?? 0;
  if (!force && existing >= 1000) return { ok: true, skipped: true, reason: "already_populated", count: existing, source: SOURCE };
  const [cards, sets] = await Promise.all([fetchJson("/cards"), fetchJson("/sets")]);
  if (!Array.isArray(cards) || cards.length < 1000) throw new Error("TCGdex: catalogue cartes incomplet");
  if (!Array.isArray(sets) || !sets.length) throw new Error("TCGdex: liste des extensions indisponible");
  const setMap = new Map(sets.map((set) => [String(set.id || ""), set])); const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO cards (id,license_slug,slug,name,name_normalized,extension,extension_code,number,rarity,hit_family,variants_json,illustration,image_hd,image_thumb,condition_note,avg_price,low_price,high_price,recommended_price,market_trend,trend_percent,sales_count,views,meta_title,meta_description,active,created_at,updated_at) VALUES (@id,'pokemon',@slug,@name,@name_normalized,@extension,@extension_code,@number,'','','{}','',@image_hd,@image_thumb,'NM',0,0,0,0,'stable',0,0,0,@meta_title,@meta_description,1,@created_at,@updated_at) ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_normalized=excluded.name_normalized,extension=excluded.extension,extension_code=excluded.extension_code,number=excluded.number,image_hd=excluded.image_hd,image_thumb=excluded.image_thumb,meta_title=excluded.meta_title,meta_description=excluded.meta_description,active=1,updated_at=excluded.updated_at`);
  let imported = 0, withoutImage = 0;
  db.transaction(() => {
    for (const raw of cards) {
      if (!raw?.id || !raw?.name) continue; const setId = setIdFromCardId(raw.id); const set = setMap.get(setId); const extension = String(set?.name || setId || ""); const localId = String(raw.localId ?? ""); const baseImage = String(raw.image || ""); if (!baseImage) withoutImage += 1;
      upsert.run({ id: `pokemon-${raw.id}`, slug: slugify(`${raw.name}-${extension}-${localId}-${raw.id}`), name: String(raw.name), name_normalized: normalizeText(raw.name), extension, extension_code: setId, number: localId, image_hd: imageUrl(baseImage,"high"), image_thumb: imageUrl(baseImage,"low"), meta_title: `${raw.name} — ${extension} | Cardoria`, meta_description: `Fiche de la carte Pokémon ${raw.name}${extension ? `, extension ${extension}` : ""}${localId ? `, numéro ${localId}` : ""}.`, created_at: now, updated_at: now }); imported += 1;
    }
    try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  })();
  const count = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND active=1").get()?.c ?? 0;
  return { ok: true, skipped: false, source: SOURCE, imported, count, sets: setMap.size, withoutImage, syncedAt: now };
}

export async function syncPokemonReferenceCatalog({ priceLimit = 120, skipRarities = false } = {}) {
  ensureDefaultLicenses();
  const db = getDb();
  let rarities = [], rarityUpdated = 0;
  if (!skipRarities) {
    rarities = await fetchJson("/rarities");
    if (!Array.isArray(rarities)) throw new Error("TCGdex: raretés indisponibles");
    const updateRarity = db.prepare("UPDATE cards SET rarity=?,hit_family=? WHERE id=? AND license_slug='pokemon'");
    const rarityResults = await Promise.all(rarities.map(async (rarity) => ({ rarity: String(rarity), cards: await fetchJson(`/cards?rarity=eq:${encodeURIComponent(String(rarity))}`) })));
    db.transaction(() => {
      for (const group of rarityResults) for (const raw of (Array.isArray(group.cards) ? group.cards : [])) {
        const id = `pokemon-${raw.id}`; const family = pokemonHitFamily(group.rarity, raw.name); const result = updateRarity.run(group.rarity, family, id); rarityUpdated += result.changes || 0;
      }
    })();
  }

  const requestedPriceLimit = Number(priceLimit);
  const safePriceLimit = Number.isFinite(requestedPriceLimit) ? Math.max(0, Math.min(requestedPriceLimit, 500)) : 120;
  const candidates = safePriceLimit > 0
    ? db.prepare(`SELECT id,name FROM cards WHERE license_slug='pokemon' AND active=1
        ORDER BY CASE WHEN hit_family<>'' OR rarity LIKE '%Rare%' THEN 0 ELSE 1 END,
                 CASE WHEN market_checked_at='' THEN 0 ELSE 1 END,
                 market_checked_at ASC, updated_at ASC LIMIT ?`).all(safePriceLimit)
    : [];
  const updateDetail = db.prepare(`UPDATE cards SET rarity=?,hit_family=?,variants_json=?,illustration=?,avg_price=?,low_price=?,high_price=?,recommended_price=?,market_avg1=?,market_avg7=?,market_avg30=?,market_source=?,market_updated_at=?,market_checked_at=?,market_trend=?,trend_percent=?,updated_at=? WHERE id=?`);
  const markChecked = db.prepare("UPDATE cards SET market_checked_at=? WHERE id=?");
  const deleteSource = db.prepare("DELETE FROM price_sources WHERE card_id=? AND source='cardmarket'");
  const insertSource = db.prepare("INSERT INTO price_sources(card_id,source,price,currency,weight,fetched_at) VALUES (?,'cardmarket',?,'EUR',0.55,?)");
  const insertHistory = db.prepare(`INSERT OR IGNORE INTO card_price_history(card_id,source,current_price,avg_price,low_price,high_price,avg1,avg7,avg30,captured_at) VALUES (?,'cardmarket',?,?,?,?,?,?,?,?)`);
  let detailed = 0, priced = 0, rising = 0, falling = 0, stable = 0;
  const concurrency = 10;
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const details = await Promise.all(batch.map(async (c) => { try { return await fetchJson(`/cards/${encodeURIComponent(c.id.replace(/^pokemon-/,""))}`); } catch { return null; } }));
    db.transaction(() => {
      details.forEach((raw, index) => {
        const cardId = batch[index].id; const stampedAt = new Date().toISOString();
        if (!raw) { markChecked.run(stampedAt, cardId); return; }
        const variants = raw.variants || {}; const rarity = String(raw.rarity || ""); const family = pokemonHitFamily(rarity, raw.name, variants); const price = cardmarketReference(raw.pricing, variants);
        if (!price) {
          updateDetail.run(rarity, family, JSON.stringify(variants), String(raw.illustrator || ""), 0, 0, 0, 0, 0, 0, 0, "", "", stampedAt, "stable", 0, stampedAt, cardId);
          detailed += 1; return;
        }
        const direction = marketDirection(price.change7);
        updateDetail.run(rarity, family, JSON.stringify(variants), String(raw.illustrator || ""), price.avg, price.low, price.high, price.recommended, price.avg1, price.avg7, price.avg30, "cardmarket", price.updated || stampedAt, stampedAt, direction, price.change7, stampedAt, cardId);
        deleteSource.run(cardId); insertSource.run(cardId, price.recommended, price.updated || stampedAt);
        insertHistory.run(cardId, price.recommended, price.avg, price.low, price.high, price.avg1, price.avg7, price.avg30, price.updated || stampedAt);
        priced += 1; detailed += 1;
        if (direction === "up") rising += 1; else if (direction === "down") falling += 1; else stable += 1;
      });
    })();
  }
  try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  return { ok: true, source: SOURCE, rarities: rarities.length, rarityUpdated, detailed, priced, rising, falling, stable, priceLimit: candidates.length, syncedAt: new Date().toISOString() };
}

export function getMarketPriceStatus() {
  const db = getDb();
  const totals = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN recommended_price>0 THEN 1 ELSE 0 END) AS priced,
    SUM(CASE WHEN market_trend='up' THEN 1 ELSE 0 END) AS rising,
    SUM(CASE WHEN market_trend='down' THEN 1 ELSE 0 END) AS falling,
    SUM(CASE WHEN market_trend='stable' AND recommended_price>0 THEN 1 ELSE 0 END) AS stable,
    MAX(market_checked_at) AS lastCheckedAt, MAX(market_updated_at) AS lastMarketUpdate
    FROM cards WHERE license_slug='pokemon' AND active=1`).get();
  return {
    total: Number(totals?.total || 0), priced: Number(totals?.priced || 0), rising: Number(totals?.rising || 0),
    falling: Number(totals?.falling || 0), stable: Number(totals?.stable || 0),
    lastCheckedAt: totals?.lastCheckedAt || "", lastMarketUpdate: totals?.lastMarketUpdate || "", source: "Cardmarket via TCGdex"
  };
}

export function getCardPriceHistory(cardId, limit = 90) {
  return getDb().prepare(`SELECT source,current_price AS current,avg_price AS avg,low_price AS low,high_price AS high,avg1,avg7,avg30,captured_at AS capturedAt FROM card_price_history WHERE card_id=? ORDER BY captured_at DESC LIMIT ?`).all(cardId, Math.min(Math.max(Number(limit) || 90, 1), 365));
}
