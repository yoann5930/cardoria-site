import { getDb, normalizeText } from "./database.js";
import { ensureCatalogFrenchLocalizationSchema } from "./catalog-french-localization.js";
import { persistMultilingualCards } from "./multilingual-card-persistence.js";
import { syncPokemonReferenceCatalog, pokemonHitFamily } from "./tcgdex-sync.js";
import { syncKoreanCardmarketProxyPrices } from "./korean-official-backfill.js";

const MINIMUMS = { fr: 21000, en: 23000, ja: 12000, ko: 200 };
const LANGUAGES = ["fr", "en", "ja", "ko"];
const GENERIC_NAME = /^Carte Pokémon (?:anglaise|japonaise|coréenne|étrangère)(?: n° .*)?$/i;
const GENERIC_EXTENSION = /^Extension (?:anglaise|japonaise|coréenne|étrangère)(?: .*)?$/i;
const PERSIST_RETRY_MS = 5 * 60 * 1000;

let initialized = false;
let running = false;
let raritySweepDone = false;
let lastPersistAt = 0;

function ensureGreenSchema() {
  const db = ensureCatalogFrenchLocalizationSchema();
  const columns = new Set(db.prepare("PRAGMA table_info(cards)").all().map((row) => String(row.name || "")));
  if (!columns.has("image_source")) db.exec("ALTER TABLE cards ADD COLUMN image_source TEXT DEFAULT ''");
  return db;
}

function counts() {
  const db = getDb();
  const result = { fr: 0, en: 0, ja: 0, ko: 0 };
  const rows = db.prepare(`SELECT language,COUNT(*) AS count FROM cards
    WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1 GROUP BY language`).all();
  for (const row of rows) if (Object.prototype.hasOwnProperty.call(result, row.language)) result[row.language] = Number(row.count || 0);
  return result;
}

function catalogReady() {
  const value = counts();
  return { counts: value, ready: LANGUAGES.every((language) => value[language] >= MINIMUMS[language]) };
}

function rawReference(id, language) {
  const value = String(id || "");
  const prefix = language === "fr" ? "pokemon-" : `pokemon-${language}-`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

function isMissingRarity(value) {
  const raw = normalizeText(value || "");
  return !raw || raw === "non renseignee" || raw === "unknown" || raw === "n a";
}

function restoreOfficialSourceNames() {
  const db = ensureGreenSchema();
  const rows = db.prepare(`SELECT id,language,number,name,extension,source_name,source_extension,translation_source
    FROM cards WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
      AND COALESCE(source_name,'')<>''`).all();
  const now = new Date().toISOString();
  const update = db.prepare(`UPDATE cards SET name=?,name_normalized=?,extension=?,translation_source=?,meta_title=?,meta_description=?,updated_at=? WHERE id=?`);
  let repaired = 0;
  db.transaction(() => {
    for (const row of rows) {
      const currentName = String(row.name || "").trim();
      const currentExtension = String(row.extension || "").trim();
      const translationSource = String(row.translation_source || "");
      const shouldRestore = translationSource === "libelle-fr-sans-equivalent-officiel" || GENERIC_NAME.test(currentName);
      if (!shouldRestore) continue;
      const sourceName = String(row.source_name || "").trim();
      if (!sourceName || GENERIC_NAME.test(sourceName)) continue;
      const sourceExtension = String(row.source_extension || "").trim();
      const extension = sourceExtension && !GENERIC_EXTENSION.test(sourceExtension) ? sourceExtension : currentExtension;
      const languageLabel = row.language === "en" ? "anglaise" : row.language === "ja" ? "japonaise" : "coréenne";
      const metaTitle = `${sourceName} — ${extension} · version ${languageLabel} | Cardoria`;
      const metaDescription = `Référence Cardoria ${sourceName}, ${extension}, numéro ${row.number || "non renseigné"}, carte ${languageLabel}.`;
      repaired += update.run(sourceName, normalizeText(sourceName), extension, "source-officielle-sans-equivalent-fr", metaTitle, metaDescription, now, row.id).changes || 0;
    }
  })();
  return repaired;
}

function clearWrongLanguageImages() {
  const db = ensureGreenSchema();
  const rows = db.prepare(`SELECT id,language,image_language,image_hd,image_thumb,source_image_hd,source_image_thumb
    FROM cards WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1
      AND COALESCE(image_language,'')<>'' AND image_language<>language`).all();
  const now = new Date().toISOString();
  const update = db.prepare(`UPDATE cards SET image_hd=?,image_thumb=?,image_language=?,image_source='',updated_at=? WHERE id=?`);
  let repaired = 0;
  db.transaction(() => {
    for (const row of rows) {
      const nativeHd = String(row.source_image_hd || "");
      const nativeThumb = String(row.source_image_thumb || "");
      const nativePattern = new RegExp(`assets\\.tcgdex\\.net/${row.language}/`, "i");
      const hd = nativePattern.test(nativeHd) ? nativeHd : "";
      const thumb = nativePattern.test(nativeThumb) ? nativeThumb : hd;
      repaired += update.run(hd, thumb, hd || thumb ? row.language : "", now, row.id).changes || 0;
    }
  })();
  return repaired;
}

function repairPeerRarities() {
  const db = ensureGreenSchema();
  const rows = db.prepare(`SELECT id,language,rarity,source_rarity,hit_family FROM cards
    WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1`).all();
  const byReference = new Map();
  const priority = { fr: 0, en: 1, ja: 2, ko: 3 };
  for (const row of rows) {
    const ref = rawReference(row.id, row.language);
    if (!ref || isMissingRarity(row.rarity)) continue;
    const current = byReference.get(ref);
    if (!current || priority[row.language] < priority[current.language]) byReference.set(ref, row);
  }
  const update = db.prepare(`UPDATE cards SET rarity=?,source_rarity=CASE WHEN COALESCE(source_rarity,'')='' OR lower(source_rarity)='non renseignée' THEN ? ELSE source_rarity END,
    hit_family=CASE WHEN COALESCE(hit_family,'')='' OR hit_family='Standard' THEN ? ELSE hit_family END,updated_at=? WHERE id=?`);
  const now = new Date().toISOString();
  let repaired = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (!isMissingRarity(row.rarity)) continue;
      const ref = rawReference(row.id, row.language);
      const source = byReference.get(ref);
      if (!source || isMissingRarity(source.rarity)) continue;
      const rarity = String(source.rarity || "");
      const hit = String(source.hit_family || pokemonHitFamily(rarity, "") || "");
      repaired += update.run(rarity, rarity, hit, now, row.id).changes || 0;
    }
  })();
  return repaired;
}

function refreshSourceRarities() {
  const db = ensureGreenSchema();
  const now = new Date().toISOString();
  const update = db.prepare(`UPDATE cards SET source_rarity=rarity,updated_at=?
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
      AND rarity<>'' AND lower(rarity)<>'non renseignée'
      AND (COALESCE(source_rarity,'')='' OR lower(source_rarity)='non renseignée')`);
  return update.run(now).changes || 0;
}

function currentIntegrity() {
  const db = ensureGreenSchema();
  const row = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN COALESCE(name,'')='' THEN 1 ELSE 0 END) AS missing_name,
    SUM(CASE WHEN COALESCE(rarity,'')='' OR lower(rarity)='non renseignée' THEN 1 ELSE 0 END) AS missing_rarity,
    SUM(CASE WHEN COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='' THEN 1 ELSE 0 END) AS missing_image,
    SUM(CASE WHEN recommended_price<=0 THEN 1 ELSE 0 END) AS missing_price,
    SUM(CASE WHEN COALESCE(image_language,'')<>'' AND image_language<>language THEN 1 ELSE 0 END) AS wrong_image_language
    FROM cards WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1`).get() || {};
  const generic = Number(db.prepare(`SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
    AND (name LIKE 'Carte Pokémon anglaise%' OR name LIKE 'Carte Pokémon japonaise%' OR name LIKE 'Carte Pokémon coréenne%')`).get()?.c || 0);
  return {
    total: Number(row.total || 0),
    missingName: Number(row.missing_name || 0),
    genericName: generic,
    missingRarity: Number(row.missing_rarity || 0),
    missingImage: Number(row.missing_image || 0),
    missingPrice: Number(row.missing_price || 0),
    wrongImageLanguage: Number(row.wrong_image_language || 0)
  };
}

async function runRaritySweep() {
  const results = [];
  for (const language of LANGUAGES) {
    try {
      const result = await syncPokemonReferenceCatalog({ language, priceLimit: 0, skipRarities: false });
      results.push({ language, ok: true, rarityUpdated: Number(result.rarityUpdated || 0), detailed: Number(result.detailed || 0), priced: Number(result.priced || 0), imagesRepaired: Number(result.imagesRepaired || 0) });
    } catch (error) {
      results.push({ language, ok: false, error: error?.message || String(error) });
      console.warn(`[catalog-green-repair] rarity sweep ${language} failed`, error?.message || String(error));
    }
  }
  raritySweepDone = results.every((item) => item.ok);
  console.log(`[catalog-green-rarities] ${JSON.stringify(results)}`);
  return results;
}

async function persistIfNeeded(force = false) {
  const now = Date.now();
  if (!force && now - lastPersistAt < PERSIST_RETRY_MS) return { ok: true, skipped: true, reason: "recent" };
  const result = await persistMultilingualCards("catalog-green-repair");
  if (result?.ok) lastPersistAt = now;
  return result;
}

async function runGreenPass() {
  if (running) return;
  const state = catalogReady();
  if (!state.ready) return;
  running = true;
  try {
    let changed = 0;
    if (!initialized) {
      ensureGreenSchema();
      initialized = true;
    }

    changed += restoreOfficialSourceNames();
    changed += clearWrongLanguageImages();

    if (!raritySweepDone) {
      await runRaritySweep();
      changed += refreshSourceRarities();
    }

    changed += repairPeerRarities();
    const koPrices = syncKoreanCardmarketProxyPrices();
    changed += Number(koPrices?.updated || 0);

    const integrity = currentIntegrity();
    console.log(`[catalog-green-progress] counts=${JSON.stringify(state.counts)} integrity=${JSON.stringify(integrity)} changed=${changed}`);

    if (changed > 0 || !lastPersistAt) {
      const saved = await persistIfNeeded(!lastPersistAt);
      if (saved?.ok === false) console.error("[catalog-green-repair] persistence failed", saved.error || "unknown");
    }
  } catch (error) {
    console.error("[catalog-green-repair] pass failed", error?.message || String(error));
  } finally {
    running = false;
  }
}

if (process.env.NODE_ENV !== "test") {
  const startupTimer = setInterval(() => {
    const state = catalogReady();
    if (!state.ready) return;
    clearInterval(startupTimer);
    runGreenPass().catch(() => {});
  }, 15000);
  startupTimer.unref?.();

  const maintenanceTimer = setInterval(() => {
    runGreenPass().catch(() => {});
  }, 2 * 60 * 1000);
  maintenanceTimer.unref?.();
}
