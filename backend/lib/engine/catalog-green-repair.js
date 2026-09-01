import { getDb, normalizeText } from "./database.js";
import { ensureCatalogFrenchLocalizationSchema } from "./catalog-french-localization.js";
import { persistMultilingualCards } from "./multilingual-card-persistence.js";
import { pokemonHitFamily } from "./tcgdex-sync.js";
import { syncKoreanCardmarketProxyPrices } from "./korean-official-backfill.js";
import { repairPokemonRaritiesFast } from "./catalog-rarity-fast-repair.js";

const MINIMUMS = { fr: 21000, en: 23000, ja: 12000, ko: 200 };
const LANGUAGES = ["fr", "en", "ja", "ko"];
const PERSIST_RETRY_MS = 5 * 60 * 1000;
const PROVIDER_SETTLE_MS = 150 * 1000;
const RARITY_RETRY_MS = 10 * 60 * 1000;

let running = false;
let lastPersistAt = 0;
let lastRarityAt = 0;
let rarityHealthy = false;
let readySince = 0;

function ensureGreenSchema() {
  const db = ensureCatalogFrenchLocalizationSchema();
  const columns = new Set(db.prepare("PRAGMA table_info(cards)").all().map((row) => String(row.name || "")));
  if (!columns.has("image_source")) db.exec("ALTER TABLE cards ADD COLUMN image_source TEXT DEFAULT ''");
  return db;
}

function counts() {
  const db = getDb();
  const result = { fr: 0, en: 0, ja: 0, ko: 0 };
  for (const row of db.prepare(`SELECT language,COUNT(*) AS count FROM cards
    WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1 GROUP BY language`).all()) {
    if (Object.prototype.hasOwnProperty.call(result, row.language)) result[row.language] = Number(row.count || 0);
  }
  return result;
}

function catalogReady() {
  const value = counts();
  const ready = LANGUAGES.every((language) => value[language] >= MINIMUMS[language]);
  if (ready && !readySince) readySince = Date.now();
  if (!ready) readySince = 0;
  return { counts: value, ready, settled: ready && Date.now() - readySince >= PROVIDER_SETTLE_MS };
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
  const now = new Date().toISOString();
  return db.prepare(`UPDATE cards SET
      name=source_name,
      name_normalized=lower(source_name),
      extension=CASE
        WHEN COALESCE(source_extension,'')<>''
          AND source_extension NOT LIKE 'Extension anglaise%'
          AND source_extension NOT LIKE 'Extension japonaise%'
          AND source_extension NOT LIKE 'Extension coréenne%'
        THEN source_extension ELSE extension END,
      translation_source='source-officielle-verifiee',
      meta_title=source_name || ' — ' || CASE WHEN COALESCE(source_extension,'')<>'' THEN source_extension ELSE extension END || ' | Cardoria',
      meta_description='Référence Cardoria ' || source_name || ', numéro ' || COALESCE(number,'') || '.',
      updated_at=?
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
      AND COALESCE(source_name,'')<>''
      AND source_name NOT LIKE 'Carte Pokémon anglaise%'
      AND source_name NOT LIKE 'Carte Pokémon japonaise%'
      AND source_name NOT LIKE 'Carte Pokémon coréenne%'
      AND (
        translation_source IN ('reference-fr-directe','dictionnaire-fr-cardoria','libelle-fr-sans-equivalent-officiel','source-officielle-sans-equivalent-fr')
        OR name LIKE 'Carte Pokémon anglaise%'
        OR name LIKE 'Carte Pokémon japonaise%'
        OR name LIKE 'Carte Pokémon coréenne%'
        OR name<>source_name
      )`).run(now).changes || 0;
}

function clearWrongLanguageImages() {
  const db = ensureGreenSchema();
  const now = new Date().toISOString();
  return db.prepare(`UPDATE cards SET
      image_hd=CASE WHEN COALESCE(source_image_hd,'') LIKE '%assets.tcgdex.net/' || language || '/%' THEN source_image_hd ELSE '' END,
      image_thumb=CASE
        WHEN COALESCE(source_image_thumb,'') LIKE '%assets.tcgdex.net/' || language || '/%' THEN source_image_thumb
        WHEN COALESCE(source_image_hd,'') LIKE '%assets.tcgdex.net/' || language || '/%' THEN source_image_hd
        ELSE '' END,
      image_language=CASE
        WHEN COALESCE(source_image_hd,'') LIKE '%assets.tcgdex.net/' || language || '/%'
          OR COALESCE(source_image_thumb,'') LIKE '%assets.tcgdex.net/' || language || '/%'
        THEN language ELSE '' END,
      image_source='',updated_at=?
    WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1
      AND COALESCE(image_language,'')<>'' AND image_language<>language`).run(now).changes || 0;
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
      const source = byReference.get(rawReference(row.id, row.language));
      if (!source || isMissingRarity(source.rarity)) continue;
      const rarity = String(source.rarity || "");
      repaired += update.run(rarity, rarity, String(source.hit_family || pokemonHitFamily(rarity, "") || ""), now, row.id).changes || 0;
    }
  })();
  return repaired;
}

function currentIntegrity() {
  const db = ensureGreenSchema();
  const row = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN COALESCE(name,'')='' THEN 1 ELSE 0 END) AS missing_name,
    SUM(CASE WHEN COALESCE(rarity,'')='' OR lower(rarity)='non renseignée' THEN 1 ELSE 0 END) AS missing_rarity,
    SUM(CASE WHEN COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='' THEN 1 ELSE 0 END) AS missing_image,
    SUM(CASE WHEN recommended_price<=0 THEN 1 ELSE 0 END) AS missing_price,
    SUM(CASE WHEN COALESCE(image_language,'')<>'' AND image_language<>language THEN 1 ELSE 0 END) AS wrong_image_language,
    SUM(CASE WHEN language IN ('en','ja','ko') AND translation_source IN ('reference-fr-directe','dictionnaire-fr-cardoria') THEN 1 ELSE 0 END) AS unsafe_identity
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
    wrongImageLanguage: Number(row.wrong_image_language || 0),
    unsafeIdentity: Number(row.unsafe_identity || 0)
  };
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
  if (!state.settled) return;
  running = true;
  try {
    ensureGreenSchema();
    let changed = 0;
    const rarityDue = !rarityHealthy || !lastRarityAt || Date.now() - lastRarityAt >= RARITY_RETRY_MS;
    if (rarityDue) {
      const rarity = await repairPokemonRaritiesFast({ languages: LANGUAGES });
      lastRarityAt = Date.now();
      rarityHealthy = Boolean(rarity.ok);
      console.log(`[catalog-green-rarities] ok=${rarity.ok ? 'yes' : 'no'} missing=${rarity.missingTotal}`);
    }

    changed += restoreOfficialSourceNames();
    changed += clearWrongLanguageImages();
    changed += repairPeerRarities();
    const koPrices = syncKoreanCardmarketProxyPrices();
    changed += Number(koPrices?.updated || 0);

    const integrity = currentIntegrity();
    console.log(`[catalog-green-progress] counts=${JSON.stringify(state.counts)} integrity=${JSON.stringify(integrity)} changed=${changed}`);

    const persistenceDue = !lastPersistAt || Date.now() - lastPersistAt >= PERSIST_RETRY_MS;
    if (changed > 0 || persistenceDue) {
      const saved = await persistIfNeeded(changed > 0 || !lastPersistAt);
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
    if (!state.settled) return;
    clearInterval(startupTimer);
    runGreenPass().catch(() => {});
  }, 15000);
  startupTimer.unref?.();

  const maintenanceTimer = setInterval(() => runGreenPass().catch(() => {}), 2 * 60 * 1000);
  maintenanceTimer.unref?.();
}
