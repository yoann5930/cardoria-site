import { getDb, normalizeText, slugify } from "./database.js";
import { ensureDefaultLicenses } from "./licenses.js";

const API = "https://api.tcgdex.net/v2/fr";
const SOURCE = "tcgdex-fr";

function imageUrl(base, quality) { if (!base) return ""; return `${String(base).replace(/\/$/, "")}/${quality}.webp`; }
function setIdFromCardId(cardId) { const id = String(cardId || ""); const pos = id.lastIndexOf("-"); return pos > 0 ? id.slice(0, pos) : ""; }
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
  if (r.includes("hyper") || r.includes("gold") || r.includes("doree") || r.includes("dorée")) return "Gold";
  if (r.includes("special illustration") || r.includes("illustration speciale") || r.includes("illustration spéciale") || r.includes("sar")) return "SAR / Special Illustration Rare";
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
  const cm = pricing?.cardmarket; if (!cm || String(cm.unit || "EUR").toUpperCase() !== "EUR") return null;
  const holo = variants?.holo && !variants?.normal;
  const pick = (...values) => values.find((v) => Number.isFinite(Number(v)) && Number(v) > 0);
  const avg = holo ? pick(cm["avg7-holo"], cm["trend-holo"], cm["avg-holo"], cm.avg7, cm.trend, cm.avg) : pick(cm.avg7, cm.trend, cm.avg, cm["avg7-holo"], cm["trend-holo"]);
  const low = holo ? pick(cm["low-holo"], cm.low, avg) : pick(cm.low, cm["low-holo"], avg);
  const recommended = holo ? pick(cm["trend-holo"], cm["avg7-holo"], avg) : pick(cm.trend, cm.avg7, avg);
  const high = Math.max(Number(avg || 0), Number(recommended || 0), Number(cm.avg30 || 0), Number(cm["avg30-holo"] || 0));
  if (!avg && !recommended) return null;
  return { avg: Number(avg || recommended || 0), low: Number(low || avg || recommended || 0), high: Number(high || avg || recommended || 0), recommended: Number(recommended || avg || 0), updated: cm.updated || null };
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

export async function syncPokemonReferenceCatalog({ priceLimit = 120 } = {}) {
  ensureDefaultLicenses(); const db = getDb(); const rarities = await fetchJson("/rarities");
  if (!Array.isArray(rarities)) throw new Error("TCGdex: raretés indisponibles");
  const updateRarity = db.prepare("UPDATE cards SET rarity=?,hit_family=?,updated_at=? WHERE id=? AND license_slug='pokemon'");
  const now = new Date().toISOString(); let rarityUpdated = 0;
  const rarityResults = await Promise.all(rarities.map(async (rarity) => ({ rarity: String(rarity), cards: await fetchJson(`/cards?rarity=eq:${encodeURIComponent(String(rarity))}`) })));
  db.transaction(() => {
    for (const group of rarityResults) for (const raw of (Array.isArray(group.cards) ? group.cards : [])) {
      const id = `pokemon-${raw.id}`; const family = pokemonHitFamily(group.rarity, raw.name); const result = updateRarity.run(group.rarity, family, now, id); rarityUpdated += result.changes || 0;
    }
  })();

  const candidates = db.prepare("SELECT id,name FROM cards WHERE license_slug='pokemon' AND active=1 AND (hit_family<>'' OR rarity LIKE '%Rare%') ORDER BY CASE WHEN recommended_price=0 THEN 0 ELSE 1 END, updated_at ASC LIMIT ?").all(Math.max(0, Math.min(Number(priceLimit)||120, 500)));
  const updateDetail = db.prepare("UPDATE cards SET rarity=?,hit_family=?,variants_json=?,illustration=?,avg_price=?,low_price=?,high_price=?,recommended_price=?,updated_at=? WHERE id=?");
  const deleteSource = db.prepare("DELETE FROM price_sources WHERE card_id=? AND source='cardmarket'");
  const insertSource = db.prepare("INSERT INTO price_sources(card_id,source,price,currency,weight,fetched_at) VALUES (?,'cardmarket',?,'EUR',0.55,?)");
  let detailed = 0, priced = 0;
  const concurrency = 10;
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const details = await Promise.all(batch.map(async (c) => { try { return await fetchJson(`/cards/${encodeURIComponent(c.id.replace(/^pokemon-/,""))}`); } catch { return null; } }));
    db.transaction(() => {
      details.forEach((raw, index) => {
        if (!raw) return; const cardId = batch[index].id; const variants = raw.variants || {}; const rarity = String(raw.rarity || ""); const family = pokemonHitFamily(rarity, raw.name, variants); const price = cardmarketReference(raw.pricing, variants);
        updateDetail.run(rarity, family, JSON.stringify(variants), String(raw.illustrator || ""), price?.avg || 0, price?.low || 0, price?.high || 0, price?.recommended || 0, new Date().toISOString(), cardId);
        if (price?.recommended) { deleteSource.run(cardId); insertSource.run(cardId, price.recommended, price.updated || new Date().toISOString()); priced += 1; }
        detailed += 1;
      });
    })();
  }
  try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  return { ok: true, source: SOURCE, rarities: rarities.length, rarityUpdated, detailed, priced, priceLimit: candidates.length, syncedAt: new Date().toISOString() };
}
