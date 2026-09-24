const LANGUAGE_CODES = { fr: "FR", en: "EN", ja: "JA", ko: "KO" };
const LICENSE_LABELS = {
  pokemon: "Pokémon",
  yugioh: "Yu-Gi-Oh!",
  onepiece: "One Piece",
  lorcana: "Lorcana",
  magic: "Magic",
  dragonball: "Dragon Ball",
  sports: "Sports"
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildCardPageSeo(card = {}) {
  const name = clean(card.name);
  const number = clean(card.number);
  const extension = clean(card.extension);
  const rarity = clean(card.rarity || card.hitFamily);
  const language = clean(card.language || "fr").toLowerCase();
  const lang = LANGUAGE_CODES[language] || language.toUpperCase() || "FR";
  const slug = clean(card.license || card.licenseSlug).toLowerCase();
  const licenseName = clean(card.licenseName) || LICENSE_LABELS[slug] || "Pokémon";
  const identity = [name, number, extension, lang].filter(Boolean).join(" ");
  const title = `${identity || licenseName} – Carte ${licenseName}, prix & cote | Cardoria`;
  const rarityText = rarity && !/^non renseign/i.test(rarity) ? ` ${rarity}` : "";
  const extensionText = extension ? ` de l’extension ${extension}` : "";
  const subject = [name, number].filter(Boolean).join(" ") || `Cette carte ${licenseName}`;
  const description = `${subject}, carte ${licenseName}${rarityText}${extensionText} (${lang}). Prix, cote et fiche sur Cardoria.`;
  const h1 = [name, number].filter(Boolean).join(" ") + (extension ? ` — ${extension}` : "");
  const alt = [name, extension, number, lang].filter(Boolean).join(" — ");
  return {
    title: title.slice(0, 180),
    description: description.slice(0, 200),
    h1: h1 || name || licenseName,
    alt: alt || name || licenseName
  };
}

export function extensionMetaDescription(licenseName, extensionName) {
  const license = clean(licenseName) || "TCG";
  const extension = clean(extensionName) || "cette extension";
  return `Découvrez les cartes ${license} de l’extension ${extension} : liste des cartes, numéros, raretés, prix et cotes sur Cardoria.`;
}
