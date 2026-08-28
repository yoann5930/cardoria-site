import { getDb, normalizeText } from "./database.js";

const LANGUAGES = ["en", "ja", "ko"];
const LANGUAGE_LABELS = { en: "anglaise", ja: "japonaise", ko: "coréenne" };

const RARITY_FR = new Map([
  ["common", "Commune"], ["c", "Commune"],
  ["uncommon", "Peu Commune"], ["u", "Peu Commune"],
  ["rare", "Rare"], ["r", "Rare"],
  ["rare holo", "Rare Holographique"], ["holo rare", "Rare Holographique"],
  ["double rare", "Double Rare"], ["rr", "Double Rare"],
  ["triple rare", "Triple Rare"], ["rrr", "Triple Rare"],
  ["illustration rare", "Illustration Rare"], ["art rare", "Illustration Rare"], ["ar", "Illustration Rare"],
  ["special illustration rare", "Illustration Spéciale Rare"], ["sar", "Illustration Spéciale Rare"],
  ["ultra rare", "Ultra Rare"], ["ur", "Ultra Rare"],
  ["super rare", "Super Rare"], ["sr", "Super Rare"],
  ["hyper rare", "Hyper Rare"], ["hr", "Hyper Rare"],
  ["secret rare", "Rare Secrète"],
  ["amazing rare", "Rare Amazing"],
  ["radiant rare", "Pokémon Radieux"],
  ["shiny rare", "Rare Chromatique"],
  ["shiny ultra rare", "Ultra Rare Chromatique"],
  ["ace spec rare", "ACE SPEC Rare"],
  ["promo", "Promo"]
]);

const HIT_FR = new Map([
  ["Gold", "Dorée"],
  ["SAR / Special Illustration Rare", "Illustration Spéciale Rare (SAR)"],
  ["AR / Illustration Rare", "Illustration Rare (AR)"],
  ["Secret / Hyper Rare", "Secrète / Hyper Rare"],
  ["Full Art / Ultra Rare", "Full Art / Ultra Rare"],
  ["Full Art", "Full Art"],
  ["Ultra Rare", "Ultra Rare"],
  ["Double Rare", "Double Rare"],
  ["VMAX / VSTAR", "VMAX / VSTAR"],
  ["V / ex", "V / ex"],
  ["Holo", "Holographique"],
  ["Reverse Holo", "Holographique inversée"],
  ["Rare", "Rare"],
  ["Peu Commune", "Peu Commune"],
  ["Commune", "Commune"]
]);

function ensureColumn(db, column, definition) {
  const columns = db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE cards ADD COLUMN ${column} ${definition}`);
}

export function ensureCatalogFrenchLocalizationSchema() {
  const db = getDb();
  ensureColumn(db, "source_name", "TEXT DEFAULT ''");
  ensureColumn(db, "source_extension", "TEXT DEFAULT ''");
  ensureColumn(db, "source_rarity", "TEXT DEFAULT ''");
  ensureColumn(db, "source_image_hd", "TEXT DEFAULT ''");
  ensureColumn(db, "source_image_thumb", "TEXT DEFAULT ''");
  ensureColumn(db, "translation_source", "TEXT DEFAULT ''");
  ensureColumn(db, "image_language", "TEXT DEFAULT ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cards_translation_source ON cards(language, translation_source, active)");
  return db;
}

function rawId(row) {
  const prefix = `pokemon-${row.language}-`;
  return String(row.id || "").startsWith(prefix) ? String(row.id).slice(prefix.length) : "";
}

function addUnique(map, key, value) {
  if (!key || !value) return;
  let values = map.get(key);
  if (!values) { values = new Set(); map.set(key, values); }
  values.add(value);
}

function uniqueValue(map, key) {
  const values = map.get(key);
  return values && values.size === 1 ? values.values().next().value : "";
}

function rarityFr(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = normalizeText(raw);
  return RARITY_FR.get(key) || raw;
}

function hitFr(value) {
  return HIT_FR.get(String(value || "").trim()) || String(value || "").trim();
}

function urlLanguage(value) {
  const match = String(value || "").match(/assets\.tcgdex\.net\/(fr|en|ja|ko)\//i);
  return match ? match[1].toLowerCase() : "";
}

function siblingImageTemplate(value, localId, quality) {
  const url = String(value || "");
  if (!url || !localId) return "";
  const replaced = url.replace(/\/[^/]+\/(?:high|low)\.webp(?:\?.*)?$/i, `/${encodeURIComponent(String(localId))}/${quality}.webp`);
  return replaced === url ? "" : replaced;
}

function fallbackName(language, number, extensionCode) {
  const label = LANGUAGE_LABELS[language] || "étrangère";
  const reference = String(number || extensionCode || "").trim();
  return reference ? `Carte Pokémon ${label} n° ${reference}` : `Carte Pokémon ${label}`;
}

function fallbackExtension(language, extensionCode) {
  const label = LANGUAGE_LABELS[language] || "étrangère";
  const code = String(extensionCode || "").trim();
  return code ? `Extension ${label} ${code}` : `Extension ${label}`;
}

function buildTranslationMaps(db) {
  const nameMap = new Map();
  const extensionMap = new Map();
  const matches = db.prepare(`
    SELECT f.language, f.source_name, f.source_extension, fr.name AS french_name, fr.extension AS french_extension
    FROM cards f
    JOIN cards fr
      ON fr.id = 'pokemon-' || substr(f.id, length('pokemon-' || f.language || '-') + 1)
     AND fr.language='fr' AND fr.license_slug='pokemon'
    WHERE f.license_slug='pokemon' AND f.language IN ('en','ja','ko') AND f.active=1
  `).iterate();
  for (const row of matches) {
    addUnique(nameMap, `${row.language}\u0000${row.source_name}`, row.french_name);
    addUnique(extensionMap, `${row.language}\u0000${row.source_extension}`, row.french_extension);
  }
  return { nameMap, extensionMap };
}

export function localizeMultilingualCatalogToFrench() {
  const db = ensureCatalogFrenchLocalizationSchema();
  const now = new Date().toISOString();

  db.prepare(`UPDATE cards SET
    source_name=CASE WHEN source_name='' OR source_name IS NULL THEN name ELSE source_name END,
    source_extension=CASE WHEN source_extension='' OR source_extension IS NULL THEN extension ELSE source_extension END,
    source_rarity=CASE WHEN source_rarity='' OR source_rarity IS NULL THEN rarity ELSE source_rarity END,
    source_image_hd=CASE WHEN (source_image_hd='' OR source_image_hd IS NULL) AND image_hd LIKE '%assets.tcgdex.net/' || language || '/%' THEN image_hd ELSE source_image_hd END,
    source_image_thumb=CASE WHEN (source_image_thumb='' OR source_image_thumb IS NULL) AND image_thumb LIKE '%assets.tcgdex.net/' || language || '/%' THEN image_thumb ELSE source_image_thumb END
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko')`).run();

  const { nameMap, extensionMap } = buildTranslationMaps(db);
  const getFrench = db.prepare("SELECT name,extension,rarity,hit_family,image_hd,image_thumb FROM cards WHERE id=? AND license_slug='pokemon' AND language='fr' AND active=1 LIMIT 1");
  const getEnglish = db.prepare("SELECT name,extension,rarity,hit_family,image_hd,image_thumb,source_image_hd,source_image_thumb FROM cards WHERE id=? AND license_slug='pokemon' AND language='en' AND active=1 LIMIT 1");
  const getSibling = db.prepare("SELECT source_image_hd,source_image_thumb,image_hd,image_thumb FROM cards WHERE license_slug='pokemon' AND language=? AND extension_code=? AND id<>? AND active=1 AND (source_image_hd<>'' OR image_hd<>'' OR source_image_thumb<>'' OR image_thumb<>'') LIMIT 1");
  const update = db.prepare(`UPDATE cards SET
    name=?,name_normalized=?,extension=?,rarity=?,hit_family=?,
    image_hd=?,image_thumb=?,source_image_hd=?,source_image_thumb=?,translation_source=?,image_language=?,
    meta_title=?,meta_description=?,updated_at=? WHERE id=?`);

  const stats = {
    total: 0,
    directFrench: 0,
    dictionaryFrench: 0,
    genericFrench: 0,
    sourceImages: 0,
    frenchImageFallbacks: 0,
    englishImageFallbacks: 0,
    reconstructedImages: 0,
    missingImages: 0
  };
  const siblingCache = new Map();

  const tx = db.transaction(() => {
    const rows = db.prepare(`SELECT id,language,number,extension_code,name,extension,rarity,hit_family,image_hd,image_thumb,
      source_name,source_extension,source_rarity,source_image_hd,source_image_thumb
      FROM cards WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1 ORDER BY language,id`).iterate();

    for (const row of rows) {
      stats.total += 1;
      const sourceId = rawId(row);
      const french = sourceId ? getFrench.get(`pokemon-${sourceId}`) : null;
      const nameFromDictionary = uniqueValue(nameMap, `${row.language}\u0000${row.source_name}`);
      const extensionFromDictionary = uniqueValue(extensionMap, `${row.language}\u0000${row.source_extension}`);

      let displayName = "";
      let displayExtension = "";
      let displayRarity = "";
      let displayHit = "";
      let translationSource = "";

      if (french) {
        displayName = String(french.name || "");
        displayExtension = String(french.extension || "");
        displayRarity = String(french.rarity || "");
        displayHit = hitFr(french.hit_family || "");
        translationSource = "reference-fr-directe";
        stats.directFrench += 1;
      } else if (nameFromDictionary || extensionFromDictionary) {
        displayName = nameFromDictionary || fallbackName(row.language, row.number, row.extension_code);
        displayExtension = extensionFromDictionary || fallbackExtension(row.language, row.extension_code);
        displayRarity = rarityFr(row.source_rarity || row.rarity);
        displayHit = hitFr(row.hit_family || "");
        translationSource = "dictionnaire-fr-cardoria";
        stats.dictionaryFrench += 1;
      } else {
        displayName = fallbackName(row.language, row.number, row.extension_code);
        displayExtension = fallbackExtension(row.language, row.extension_code);
        displayRarity = rarityFr(row.source_rarity || row.rarity);
        displayHit = hitFr(row.hit_family || "");
        translationSource = "libelle-fr-sans-equivalent-officiel";
        stats.genericFrench += 1;
      }

      if (!displayRarity) displayRarity = "Non renseignée";
      if (!displayHit) displayHit = "Standard";

      let sourceHd = String(row.source_image_hd || "");
      let sourceThumb = String(row.source_image_thumb || "");
      if (!sourceHd && urlLanguage(row.image_hd) === row.language) sourceHd = String(row.image_hd || "");
      if (!sourceThumb && urlLanguage(row.image_thumb) === row.language) sourceThumb = String(row.image_thumb || "");

      let imageHd = sourceHd;
      let imageThumb = sourceThumb || sourceHd;
      let imageLanguage = sourceHd || sourceThumb ? row.language : "";

      if (imageHd || imageThumb) {
        stats.sourceImages += 1;
      } else if (french?.image_hd || french?.image_thumb) {
        imageHd = String(french.image_hd || french.image_thumb || "");
        imageThumb = String(french.image_thumb || french.image_hd || "");
        imageLanguage = "fr";
        stats.frenchImageFallbacks += 1;
      } else {
        const english = sourceId && row.language !== "en" ? getEnglish.get(`pokemon-en-${sourceId}`) : null;
        if (english?.source_image_hd || english?.image_hd || english?.source_image_thumb || english?.image_thumb) {
          imageHd = String(english.source_image_hd || english.image_hd || english.source_image_thumb || english.image_thumb || "");
          imageThumb = String(english.source_image_thumb || english.image_thumb || english.source_image_hd || english.image_hd || "");
          imageLanguage = "en";
          stats.englishImageFallbacks += 1;
        } else if (row.extension_code && row.number) {
          const cacheKey = `${row.language}\u0000${row.extension_code}`;
          let sibling = siblingCache.get(cacheKey);
          if (sibling === undefined) {
            sibling = getSibling.get(row.language, row.extension_code, row.id) || null;
            siblingCache.set(cacheKey, sibling);
          }
          const siblingHd = sibling?.source_image_hd || (urlLanguage(sibling?.image_hd) === row.language ? sibling?.image_hd : "");
          const siblingThumb = sibling?.source_image_thumb || (urlLanguage(sibling?.image_thumb) === row.language ? sibling?.image_thumb : "");
          const reconstructedHd = siblingImageTemplate(siblingHd || siblingThumb, row.number, "high");
          const reconstructedThumb = siblingImageTemplate(siblingThumb || siblingHd, row.number, "low");
          if (reconstructedHd || reconstructedThumb) {
            imageHd = reconstructedHd || reconstructedThumb;
            imageThumb = reconstructedThumb || reconstructedHd;
            imageLanguage = row.language;
            stats.reconstructedImages += 1;
          }
        }
      }

      if (!imageHd && !imageThumb) stats.missingImages += 1;

      const languageLabel = LANGUAGE_LABELS[row.language] || "étrangère";
      const metaTitle = `${displayName} — ${displayExtension} · version ${languageLabel} | Cardoria`;
      const metaDescription = `Référence Cardoria en français pour ${displayName}, ${displayExtension}, numéro ${row.number || "non renseigné"}, carte ${languageLabel}.`;
      update.run(displayName, normalizeText(displayName), displayExtension, displayRarity, displayHit,
        imageHd, imageThumb, sourceHd, sourceThumb, translationSource, imageLanguage,
        metaTitle, metaDescription, now, row.id);
    }
  });
  tx();

  try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  console.log(`[catalog-fr-localization] total=${stats.total} direct=${stats.directFrench} dictionary=${stats.dictionaryFrench} generic=${stats.genericFrench} images-source=${stats.sourceImages} images-fr=${stats.frenchImageFallbacks} images-en=${stats.englishImageFallbacks} images-rebuilt=${stats.reconstructedImages} images-missing=${stats.missingImages}`);
  return stats;
}

export function frenchHitLabel(value) {
  return hitFr(value);
}
