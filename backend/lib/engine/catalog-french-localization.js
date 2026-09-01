import { getDb, normalizeText } from "./database.js";

const LANGUAGE_LABELS = { en: "anglaise", ja: "japonaise", ko: "coréenne" };
const UNSAFE_TRANSLATION_SOURCES = new Set(["reference-fr-directe", "dictionnaire-fr-cardoria"]);

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

function imageBelongsToLanguage(value, language) {
  const url = String(value || "").trim();
  if (!url) return false;
  const detected = urlLanguage(url);
  return !detected || detected === language;
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

function sourceNameIsUsable(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return !/^Carte Pokémon (?:anglaise|japonaise|coréenne)(?:\s|$)/i.test(raw);
}

function sourceExtensionIsUsable(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return !/^Extension (?:anglaise|japonaise|coréenne)(?:\s|$)/i.test(raw);
}

export function localizeMultilingualCatalogToFrench() {
  const db = ensureCatalogFrenchLocalizationSchema();
  const now = new Date().toISOString();

  // Preserve the provider identity before changing display fields. Rows that were
  // already produced by the old unsafe cross-language mapping are deliberately
  // not copied back into source_* when their real source value is absent.
  db.prepare(`UPDATE cards SET
    source_name=CASE
      WHEN (source_name='' OR source_name IS NULL)
        AND COALESCE(translation_source,'') NOT IN ('reference-fr-directe','dictionnaire-fr-cardoria')
      THEN name ELSE source_name END,
    source_extension=CASE
      WHEN (source_extension='' OR source_extension IS NULL)
        AND COALESCE(translation_source,'') NOT IN ('reference-fr-directe','dictionnaire-fr-cardoria')
      THEN extension ELSE source_extension END,
    source_rarity=CASE WHEN source_rarity='' OR source_rarity IS NULL THEN rarity ELSE source_rarity END,
    source_image_hd=CASE
      WHEN (source_image_hd='' OR source_image_hd IS NULL)
        AND COALESCE(image_hd,'')<>''
        AND (COALESCE(image_language,'')=language OR image_hd LIKE '%assets.tcgdex.net/' || language || '/%')
      THEN image_hd ELSE source_image_hd END,
    source_image_thumb=CASE
      WHEN (source_image_thumb='' OR source_image_thumb IS NULL)
        AND COALESCE(image_thumb,'')<>''
        AND (COALESCE(image_language,'')=language OR image_thumb LIKE '%assets.tcgdex.net/' || language || '/%')
      THEN image_thumb ELSE source_image_thumb END
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko')`).run();

  const update = db.prepare(`UPDATE cards SET
    name=?,name_normalized=?,extension=?,rarity=?,hit_family=?,
    image_hd=?,image_thumb=?,source_image_hd=?,source_image_thumb=?,translation_source=?,image_language=?,
    meta_title=?,meta_description=?,updated_at=? WHERE id=?`);

  const stats = {
    total: 0,
    officialSource: 0,
    genericSource: 0,
    exactSourceImages: 0,
    discardedUnsafeNames: 0,
    discardedWrongLanguageImages: 0,
    missingImages: 0
  };

  const rows = db.prepare(`SELECT id,language,number,extension_code,name,extension,rarity,hit_family,image_hd,image_thumb,
    source_name,source_extension,source_rarity,source_image_hd,source_image_thumb,translation_source,image_language
    FROM cards WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1 ORDER BY language,id`).all();

  const tx = db.transaction(() => {
    for (const row of rows) {
      stats.total += 1;

      const sourceName = String(row.source_name || "").trim();
      const sourceExtension = String(row.source_extension || "").trim();
      const officialName = sourceNameIsUsable(sourceName) ? sourceName : "";
      const officialExtension = sourceExtensionIsUsable(sourceExtension) ? sourceExtension : "";
      const wasUnsafeTranslation = UNSAFE_TRANSLATION_SOURCES.has(String(row.translation_source || ""));

      let displayName = "";
      let displayExtension = "";
      let translationSource = "";
      if (officialName) {
        displayName = officialName;
        displayExtension = officialExtension || fallbackExtension(row.language, row.extension_code);
        translationSource = "source-officielle-verifiee";
        stats.officialSource += 1;
        if (wasUnsafeTranslation) stats.discardedUnsafeNames += 1;
      } else {
        displayName = fallbackName(row.language, row.number, row.extension_code);
        displayExtension = officialExtension || fallbackExtension(row.language, row.extension_code);
        translationSource = "libelle-fr-sans-equivalent-officiel";
        stats.genericSource += 1;
      }

      let displayRarity = rarityFr(row.source_rarity || row.rarity);
      let displayHit = hitFr(row.hit_family || "");
      if (!displayRarity) displayRarity = "Non renseignée";
      if (!displayHit) displayHit = "Standard";

      let sourceHd = String(row.source_image_hd || "").trim();
      let sourceThumb = String(row.source_image_thumb || "").trim();
      if (sourceHd && !imageBelongsToLanguage(sourceHd, row.language)) {
        sourceHd = "";
        stats.discardedWrongLanguageImages += 1;
      }
      if (sourceThumb && !imageBelongsToLanguage(sourceThumb, row.language)) {
        sourceThumb = "";
        stats.discardedWrongLanguageImages += 1;
      }

      const currentImageIsExact = String(row.image_language || "") === row.language
        || urlLanguage(row.image_hd) === row.language
        || urlLanguage(row.image_thumb) === row.language;
      if (!sourceHd && currentImageIsExact && imageBelongsToLanguage(row.image_hd, row.language)) sourceHd = String(row.image_hd || "").trim();
      if (!sourceThumb && currentImageIsExact && imageBelongsToLanguage(row.image_thumb, row.language)) sourceThumb = String(row.image_thumb || "").trim();

      const imageHd = sourceHd || sourceThumb;
      const imageThumb = sourceThumb || sourceHd;
      const imageLanguage = imageHd || imageThumb ? row.language : "";
      if (imageHd || imageThumb) stats.exactSourceImages += 1;
      else stats.missingImages += 1;

      const languageLabel = LANGUAGE_LABELS[row.language] || "étrangère";
      const metaTitle = `${displayName} — ${displayExtension} · version ${languageLabel} | Cardoria`;
      const metaDescription = `Référence Cardoria pour ${displayName}, ${displayExtension}, numéro ${row.number || "non renseigné"}, carte ${languageLabel}.`;
      update.run(displayName, normalizeText(displayName), displayExtension, displayRarity, displayHit,
        imageHd, imageThumb, sourceHd, sourceThumb, translationSource, imageLanguage,
        metaTitle, metaDescription, now, row.id);
    }
  });
  tx();

  try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  console.log(`[catalog-fr-localization] total=${stats.total} official=${stats.officialSource} generic=${stats.genericSource} unsafe-names-repaired=${stats.discardedUnsafeNames} images-exact=${stats.exactSourceImages} images-wrong-discarded=${stats.discardedWrongLanguageImages} images-missing=${stats.missingImages} direct=0 dictionary=0`);
  return stats;
}

export function frenchHitLabel(value) {
  return hitFr(value);
}
