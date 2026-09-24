const CARD_LANGUAGES = new Set(["fr", "en", "ja", "ko"]);
const LANGUAGE_LABELS = { fr: "française", en: "anglaise", ja: "japonaise", ko: "coréenne" };
const LANGUAGE_SEO_CODES = { fr: "FR", en: "EN", ja: "JP", ko: "KR" };
const LICENSE_SEO_NAMES = {
  pokemon: "Pokémon",
  yugioh: "Yu-Gi-Oh!",
  onepiece: "One Piece",
  lorcana: "Lorcana",
  magic: "Magic",
  dragonball: "Dragon Ball",
  sports: "Sports"
};

function normalizeLanguage(value, fallback = "fr") {
  const language = String(value || fallback).trim().toLowerCase();
  return CARD_LANGUAGES.has(language) ? language : fallback;
}

function seoLicenseName(card = {}) {
  const raw = String(card.licenseName || card.license || card.licenseSlug || "").trim();
  return LICENSE_SEO_NAMES[raw.toLowerCase()] || raw || "TCG";
}

function compactSeoTitle(prefix, suffix, maxLength = 95) {
  const cleanPrefix = String(prefix || "").replace(/\s+/g, " ").trim();
  const cleanSuffix = String(suffix || "").replace(/\s+/g, " ").trim();
  const full = cleanPrefix + cleanSuffix;
  if (full.length <= maxLength) return full;
  const room = Math.max(12, maxLength - cleanSuffix.length - 2);
  return cleanPrefix.slice(0, room).trimEnd() + "…" + cleanSuffix;
}

export function buildCardSeoMeta(card = {}) {
  const name = String(card.name || "Carte").replace(/\s+/g, " ").trim();
  const number = String(card.number || "").replace(/\s+/g, " ").trim();
  const extension = String(card.extension || "").replace(/\s+/g, " ").trim();
  const rarity = String(card.rarity || card.hitFamily || "").replace(/\s+/g, " ").trim();
  const language = normalizeLanguage(card.language || "fr");
  const languageCode = LANGUAGE_SEO_CODES[language] || language.toUpperCase();
  const languageLabel = LANGUAGE_LABELS[language] || language;
  const licenseName = seoLicenseName(card);
  const identity = [name, number].filter(Boolean).join(" ");

  const titleSuffix = ` – Carte ${licenseName}, prix & cote | Cardoria`;
  const titleContext = [identity, extension, languageCode].filter(Boolean).join(" ");
  const title = compactSeoTitle(titleContext, titleSuffix);

  const context = [];
  if (extension) context.push(`de l'extension ${extension}`);
  context.push(`version ${languageCode}`);
  if (rarity) context.push(`rareté ${rarity}`);

  let description = `${identity}, carte ${licenseName} ${context.join(", ")}. Consultez son visuel, son prix et sa cote sur Cardoria.`;
  description = description.replace(/\s+/g, " ").trim();
  if (description.length > 158) {
    description = `${identity}, carte ${licenseName}${extension ? " – " + extension : ""} (${languageCode}${rarity ? ", " + rarity : ""}). Prix, cote, rareté et visuel sur Cardoria.`;
  }
  if (description.length > 158) description = description.slice(0, 157).trimEnd() + "…";

  return { title, description, languageCode, languageLabel, licenseName };
}
