import { getDb } from "./database.js";
import { ensureCatalogFrenchLocalizationSchema } from "./catalog-french-localization.js";
import { pokemonHitFamily } from "./tcgdex-sync.js";

const API_ROOT = "https://api.tcgdex.net/v2";
const LANGUAGES = ["fr", "en", "ja", "ko"];
const REQUEST_TIMEOUT_MS = 20000;
const FETCH_CONCURRENCY = 6;
const RETRIES = 2;

function catalogCardId(language, rawId) {
  return language === "fr" ? `pokemon-${rawId}` : `pokemon-${language}-${rawId}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(language, path, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ROOT}/${language}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0 rarity-fast-repair" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= RETRIES) throw error;
    await sleep(750 * (attempt + 1));
    return fetchJson(language, path, attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(values, limit, mapper) {
  const out = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      out[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return out;
}

export async function repairPokemonRaritiesFast({ languages = LANGUAGES } = {}) {
  const db = ensureCatalogFrenchLocalizationSchema();
  const wanted = [...new Set((Array.isArray(languages) ? languages : [languages]).map((v) => String(v || "").toLowerCase()).filter((v) => LANGUAGES.includes(v)))];
  const now = new Date().toISOString();
  const update = db.prepare(`UPDATE cards SET rarity=?,source_rarity=?,hit_family=?,updated_at=?
    WHERE id=? AND license_slug='pokemon' AND language=? AND active=1`);
  const summaries = [];

  for (const language of wanted) {
    try {
      const rarities = await fetchJson(language, "/rarities");
      if (!Array.isArray(rarities) || !rarities.length) throw new Error("rarities_unavailable");
      const groups = await mapLimit(rarities, FETCH_CONCURRENCY, async (rarity) => {
        const cards = await fetchJson(language, `/cards?rarity=eq:${encodeURIComponent(String(rarity))}`);
        return { rarity: String(rarity), cards: Array.isArray(cards) ? cards : [] };
      });
      let updated = 0;
      let matched = 0;
      db.transaction(() => {
        for (const group of groups) {
          for (const raw of group.cards) {
            if (!raw?.id) continue;
            const family = pokemonHitFamily(group.rarity, raw.name || "");
            const changes = update.run(group.rarity, group.rarity, family, now, catalogCardId(language, raw.id), language).changes || 0;
            matched += changes;
            updated += changes;
          }
        }
      })();
      const missing = Number(db.prepare(`SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language=? AND active=1
        AND (COALESCE(rarity,'')='' OR lower(rarity)='non renseignée')`).get(language)?.c || 0);
      const result = { language, ok: true, rarities: rarities.length, matched, updated, missing };
      summaries.push(result);
      console.log(`[catalog-rarity-fast:${language}] rarities=${rarities.length} updated=${updated} missing=${missing}`);
    } catch (error) {
      const missing = Number(db.prepare(`SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language=? AND active=1
        AND (COALESCE(rarity,'')='' OR lower(rarity)='non renseignée')`).get(language)?.c || 0);
      const result = { language, ok: false, error: error?.message || String(error), missing };
      summaries.push(result);
      console.warn(`[catalog-rarity-fast:${language}] failed ${result.error} missing=${missing}`);
    }
  }

  const missingTotal = summaries.reduce((sum, row) => sum + Number(row.missing || 0), 0);
  return { ok: summaries.every((row) => row.ok), missingTotal, languages: summaries };
}
