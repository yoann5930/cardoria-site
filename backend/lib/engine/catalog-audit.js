import { getDb } from "./database.js";

const LANGUAGES = ["fr", "en", "ja", "ko"];
const VALID_LANGUAGES = new Set(LANGUAGES);
const CATEGORIES = new Set([
  "missing-image",
  "missing-price",
  "generic-name",
  "missing-source-name",
  "missing-extension",
  "missing-extension-code",
  "missing-number",
  "missing-rarity",
  "missing-market-source",
  "malformed-id",
  "image-language-mismatch",
  "duplicate-reference"
]);

function columns(db) {
  return new Set(db.prepare("PRAGMA table_info(cards)").all().map((row) => String(row.name || "")));
}

function hasColumn(cols, name) { return cols.has(name); }
function opt(cols, name, fallback = "''") { return hasColumn(cols, name) ? `COALESCE(${name},'')` : fallback; }
function boolCount(db, where, params = []) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND active=1 AND (${where})`).get(...params)?.c || 0);
}
function byLanguage(db, expression) {
  const rows = db.prepare(`SELECT language, COUNT(*) AS count FROM cards WHERE license_slug='pokemon' AND active=1 AND (${expression}) GROUP BY language`).all();
  const out = { fr: 0, en: 0, ja: 0, ko: 0, invalid: 0 };
  for (const row of rows) {
    const language = String(row.language || "");
    if (VALID_LANGUAGES.has(language)) out[language] = Number(row.count || 0);
    else out.invalid += Number(row.count || 0);
  }
  return out;
}
function totalByLanguage(db) {
  const rows = db.prepare("SELECT language,COUNT(*) AS count FROM cards WHERE license_slug='pokemon' AND active=1 GROUP BY language").all();
  const out = { fr: 0, en: 0, ja: 0, ko: 0, invalid: 0 };
  for (const row of rows) {
    const language = String(row.language || "");
    if (VALID_LANGUAGES.has(language)) out[language] = Number(row.count || 0);
    else out.invalid += Number(row.count || 0);
  }
  return out;
}
function rawReference(id, language) {
  const value = String(id || "");
  if (language === "fr") {
    if (!value.startsWith("pokemon-") || /^pokemon-(?:en|ja|ko)-/.test(value)) return "";
    return value.slice("pokemon-".length);
  }
  const prefix = `pokemon-${language}-`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}
function idIsMalformed(id, language) { return !rawReference(id, language); }
function imageUrlLanguage(value) {
  const match = String(value || "").match(/assets\.tcgdex\.net\/(fr|en|ja|ko)\//i);
  return match ? match[1].toLowerCase() : "";
}
function referenceRow(row) {
  return {
    id: row.id,
    language: row.language,
    rawReference: rawReference(row.id, row.language),
    name: row.name || "",
    sourceName: row.source_name || "",
    extension: row.extension || "",
    sourceExtension: row.source_extension || "",
    extensionCode: row.extension_code || "",
    number: row.number || "",
    rarity: row.rarity || "",
    imageHd: row.image_hd || "",
    imageThumb: row.image_thumb || "",
    imageLanguage: row.image_language || "",
    recommendedPrice: Number(row.recommended_price || 0),
    marketSource: row.market_source || "",
    translationSource: row.translation_source || "",
    catalogSource: row.catalog_source || "",
    catalogSourceUrl: row.catalog_source_url || "",
    imageSource: row.image_source || ""
  };
}

export function getCatalogAuditSummary() {
  const db = getDb();
  const cols = columns(db);
  const totals = totalByLanguage(db);
  const total = Object.values(totals).reduce((sum, n) => sum + Number(n || 0), 0);
  const genericExpr = hasColumn(cols, "translation_source")
    ? "COALESCE(translation_source,'')='libelle-fr-sans-equivalent-officiel'"
    : "name LIKE 'Carte Pokémon %'";
  const sourceNameExpr = hasColumn(cols, "source_name")
    ? "language IN ('en','ja','ko') AND COALESCE(source_name,'')=''"
    : "language IN ('en','ja','ko')";
  const imageMismatchExpr = hasColumn(cols, "image_language")
    ? "COALESCE(image_language,'')<>'' AND COALESCE(image_language,'')<>language"
    : "0";
  const malformed = { fr: 0, en: 0, ja: 0, ko: 0, invalid: 0 };
  const rows = db.prepare("SELECT id,language FROM cards WHERE license_slug='pokemon' AND active=1").all();
  const refsByLanguage = { fr: new Set(), en: new Set(), ja: new Set(), ko: new Set() };
  for (const row of rows) {
    const lang = String(row.language || "");
    if (!VALID_LANGUAGES.has(lang)) { malformed.invalid += 1; continue; }
    const raw = rawReference(row.id, lang);
    if (!raw) malformed[lang] += 1;
    else refsByLanguage[lang].add(raw);
  }
  const unionForeign = new Set([...refsByLanguage.en, ...refsByLanguage.ja, ...refsByLanguage.ko]);
  let foreignMissingFrenchCounterpart = 0;
  for (const ref of unionForeign) if (!refsByLanguage.fr.has(ref)) foreignMissingFrenchCounterpart += 1;
  const duplicateGroups = Number(db.prepare(`SELECT COUNT(*) AS c FROM (
    SELECT language,extension_code,number,COUNT(*) AS n FROM cards
    WHERE license_slug='pokemon' AND active=1 AND COALESCE(extension_code,'')<>'' AND COALESCE(number,'')<>''
    GROUP BY language,extension_code,number HAVING COUNT(*)>1
  )`).get()?.c || 0);
  const duplicateRows = Number(db.prepare(`SELECT COALESCE(SUM(n),0) AS c FROM (
    SELECT COUNT(*) AS n FROM cards
    WHERE license_slug='pokemon' AND active=1 AND COALESCE(extension_code,'')<>'' AND COALESCE(number,'')<>''
    GROUP BY language,extension_code,number HAVING COUNT(*)>1
  )`).get()?.c || 0);

  const sourceStats = {};
  if (hasColumn(cols, "catalog_source")) {
    const sourceRows = db.prepare("SELECT COALESCE(catalog_source,'') AS source,COUNT(*) AS count FROM cards WHERE license_slug='pokemon' AND active=1 GROUP BY COALESCE(catalog_source,'') ORDER BY count DESC").all();
    for (const row of sourceRows) sourceStats[row.source || "unspecified"] = Number(row.count || 0);
  }
  const translationStats = {};
  if (hasColumn(cols, "translation_source")) {
    const translationRows = db.prepare("SELECT COALESCE(translation_source,'') AS source,COUNT(*) AS count FROM cards WHERE license_slug='pokemon' AND active=1 GROUP BY COALESCE(translation_source,'') ORDER BY count DESC").all();
    for (const row of translationRows) translationStats[row.source || "unspecified"] = Number(row.count || 0);
  }

  return {
    generatedAt: new Date().toISOString(),
    total,
    totals,
    completeness: {
      missingName: { total: boolCount(db, "COALESCE(name,'')=''"), byLanguage: byLanguage(db, "COALESCE(name,'')=''") },
      genericName: { total: boolCount(db, genericExpr), byLanguage: byLanguage(db, genericExpr) },
      missingSourceName: { total: boolCount(db, sourceNameExpr), byLanguage: byLanguage(db, sourceNameExpr) },
      missingExtension: { total: boolCount(db, "COALESCE(extension,'')=''"), byLanguage: byLanguage(db, "COALESCE(extension,'')=''") },
      missingExtensionCode: { total: boolCount(db, "COALESCE(extension_code,'')=''"), byLanguage: byLanguage(db, "COALESCE(extension_code,'')=''") },
      missingNumber: { total: boolCount(db, "COALESCE(number,'')=''"), byLanguage: byLanguage(db, "COALESCE(number,'')=''") },
      missingRarity: { total: boolCount(db, "COALESCE(rarity,'')='' OR rarity='Non renseignée'"), byLanguage: byLanguage(db, "COALESCE(rarity,'')='' OR rarity='Non renseignée'") },
      missingImage: { total: boolCount(db, "COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')=''"), byLanguage: byLanguage(db, "COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')=''") },
      missingPrice: { total: boolCount(db, "COALESCE(recommended_price,0)<=0"), byLanguage: byLanguage(db, "COALESCE(recommended_price,0)<=0") },
      missingMarketSource: { total: boolCount(db, "COALESCE(market_source,'')=''"), byLanguage: byLanguage(db, "COALESCE(market_source,'')=''") },
      imageLanguageMismatch: { total: boolCount(db, imageMismatchExpr), byLanguage: byLanguage(db, imageMismatchExpr) },
      malformedId: { total: Object.values(malformed).reduce((sum, n) => sum + n, 0), byLanguage: malformed },
      duplicateReference: { groups: duplicateGroups, rows: duplicateRows }
    },
    priceIntegrity: {
      negativePrice: boolCount(db, "COALESCE(recommended_price,0)<0 OR COALESCE(avg_price,0)<0 OR COALESCE(low_price,0)<0 OR COALESCE(high_price,0)<0"),
      lowAboveHigh: boolCount(db, "COALESCE(low_price,0)>0 AND COALESCE(high_price,0)>0 AND low_price>high_price"),
      recommendedOutsideRange: boolCount(db, "COALESCE(recommended_price,0)>0 AND COALESCE(low_price,0)>0 AND COALESCE(high_price,0)>0 AND (recommended_price<low_price OR recommended_price>high_price)")
    },
    references: {
      distinctRaw: {
        fr: refsByLanguage.fr.size,
        en: refsByLanguage.en.size,
        ja: refsByLanguage.ja.size,
        ko: refsByLanguage.ko.size
      },
      foreignUnion: unionForeign.size,
      foreignMissingFrenchCounterpart
    },
    sourceStats,
    translationStats
  };
}

function conditionForCategory(category, cols) {
  switch (category) {
    case "missing-image": return "COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')=''";
    case "missing-price": return "COALESCE(recommended_price,0)<=0";
    case "generic-name": return hasColumn(cols, "translation_source") ? "COALESCE(translation_source,'')='libelle-fr-sans-equivalent-officiel'" : "name LIKE 'Carte Pokémon %'";
    case "missing-source-name": return hasColumn(cols, "source_name") ? "language IN ('en','ja','ko') AND COALESCE(source_name,'')=''" : "language IN ('en','ja','ko')";
    case "missing-extension": return "COALESCE(extension,'')=''";
    case "missing-extension-code": return "COALESCE(extension_code,'')=''";
    case "missing-number": return "COALESCE(number,'')=''";
    case "missing-rarity": return "COALESCE(rarity,'')='' OR rarity='Non renseignée'";
    case "missing-market-source": return "COALESCE(market_source,'')=''";
    case "image-language-mismatch": return hasColumn(cols, "image_language") ? "COALESCE(image_language,'')<>'' AND COALESCE(image_language,'')<>language" : "0";
    default: return "1";
  }
}

export function listCatalogAuditReferences({ category = "missing-image", language = "", page = 1, limit = 200 } = {}) {
  const db = getDb();
  const cols = columns(db);
  const selectedCategory = CATEGORIES.has(category) ? category : "missing-image";
  const selectedLanguage = VALID_LANGUAGES.has(String(language || "").toLowerCase()) ? String(language).toLowerCase() : "";
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const offset = (safePage - 1) * safeLimit;

  if (selectedCategory === "duplicate-reference") {
    const params = [];
    const langClause = selectedLanguage ? "AND language=?" : "";
    if (selectedLanguage) params.push(selectedLanguage);
    const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM (
      SELECT language,extension_code,number,COUNT(*) AS n FROM cards
      WHERE license_slug='pokemon' AND active=1 AND COALESCE(extension_code,'')<>'' AND COALESCE(number,'')<>'' ${langClause}
      GROUP BY language,extension_code,number HAVING COUNT(*)>1
    )`).get(...params)?.c || 0);
    const groups = db.prepare(`SELECT language,extension_code AS extensionCode,number,COUNT(*) AS count,GROUP_CONCAT(id) AS ids
      FROM cards WHERE license_slug='pokemon' AND active=1 AND COALESCE(extension_code,'')<>'' AND COALESCE(number,'')<>'' ${langClause}
      GROUP BY language,extension_code,number HAVING COUNT(*)>1 ORDER BY count DESC,language,extension_code,number LIMIT ? OFFSET ?`).all(...params, safeLimit, offset)
      .map((row) => ({ ...row, ids: String(row.ids || "").split(",").filter(Boolean) }));
    return { category: selectedCategory, language: selectedLanguage || "all", pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) || 1 }, groups };
  }

  if (selectedCategory === "malformed-id") {
    const all = db.prepare("SELECT * FROM cards WHERE license_slug='pokemon' AND active=1 ORDER BY language,id").all();
    const filtered = all.filter((row) => (!selectedLanguage || row.language === selectedLanguage) && idIsMalformed(row.id, row.language));
    const slice = filtered.slice(offset, offset + safeLimit).map(referenceRow);
    return { category: selectedCategory, language: selectedLanguage || "all", pagination: { page: safePage, limit: safeLimit, total: filtered.length, pages: Math.ceil(filtered.length / safeLimit) || 1 }, references: slice };
  }

  const condition = conditionForCategory(selectedCategory, cols);
  const params = [];
  const langClause = selectedLanguage ? " AND language=?" : "";
  if (selectedLanguage) params.push(selectedLanguage);
  const selectOptional = [
    hasColumn(cols, "source_name") ? "source_name" : "'' AS source_name",
    hasColumn(cols, "source_extension") ? "source_extension" : "'' AS source_extension",
    hasColumn(cols, "image_language") ? "image_language" : "'' AS image_language",
    hasColumn(cols, "translation_source") ? "translation_source" : "'' AS translation_source",
    hasColumn(cols, "catalog_source") ? "catalog_source" : "'' AS catalog_source",
    hasColumn(cols, "catalog_source_url") ? "catalog_source_url" : "'' AS catalog_source_url",
    hasColumn(cols, "image_source") ? "image_source" : "'' AS image_source"
  ].join(",");
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND active=1 AND (${condition})${langClause}`).get(...params)?.c || 0);
  const rows = db.prepare(`SELECT id,language,name,extension,extension_code,number,rarity,image_hd,image_thumb,recommended_price,market_source,${selectOptional}
    FROM cards WHERE license_slug='pokemon' AND active=1 AND (${condition})${langClause}
    ORDER BY language,extension_code,number,id LIMIT ? OFFSET ?`).all(...params, safeLimit, offset).map(referenceRow);
  return { category: selectedCategory, language: selectedLanguage || "all", pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) || 1 }, references: rows };
}

export function getImageHostAudit() {
  const db = getDb();
  const rows = db.prepare("SELECT id,language,image_hd,image_thumb FROM cards WHERE license_slug='pokemon' AND active=1").all();
  const hosts = {};
  const malformed = [];
  const tcgdexLanguageMismatch = [];
  for (const row of rows) {
    const values = [row.image_hd, row.image_thumb].filter(Boolean);
    for (const value of values) {
      try {
        const host = new URL(String(value)).host || "unknown";
        hosts[host] = (hosts[host] || 0) + 1;
        const lang = imageUrlLanguage(value);
        if (lang && lang !== row.language && tcgdexLanguageMismatch.length < 500) tcgdexLanguageMismatch.push({ id: row.id, language: row.language, imageLanguage: lang, url: value });
      } catch {
        if (malformed.length < 500) malformed.push({ id: row.id, language: row.language, url: value });
      }
    }
  }
  return { generatedAt: new Date().toISOString(), hosts, malformedCount: malformed.length, malformed, tcgdexLanguageMismatchCount: tcgdexLanguageMismatch.length, tcgdexLanguageMismatch };
}
