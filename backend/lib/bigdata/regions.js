/**
 * Régions & pays — HeatMap mondiale Cardoria.
 */
const REGION_BUCKETS = ["france", "belgium", "switzerland", "canada", "usa", "japan", "europe", "world"];

const COUNTRY_TO_REGION = {
  FR: "france",
  BE: "belgium",
  CH: "switzerland",
  CA: "canada",
  US: "usa",
  JP: "japan",
  DE: "europe", ES: "europe", IT: "europe", NL: "europe", PT: "europe",
  AT: "europe", PL: "europe", SE: "europe", NO: "europe", DK: "europe",
  FI: "europe", IE: "europe", LU: "europe", GB: "europe", UK: "europe"
};

const TLD_TO_COUNTRY = {
  fr: "FR", be: "BE", ch: "CH", ca: "CA", jp: "JP", us: "US",
  de: "DE", es: "ES", it: "IT", nl: "NL", pt: "PT", at: "AT",
  pl: "PL", se: "SE", uk: "GB", co: "US", com: "FR"
};

export function inferCountryFromEmail(email) {
  if (!email || !email.includes("@")) return "FR";
  const domain = email.split("@")[1].toLowerCase();
  const tld = domain.split(".").pop();
  return TLD_TO_COUNTRY[tld] || "FR";
}

export function countryToRegion(countryCode) {
  const cc = String(countryCode || "FR").toUpperCase();
  return COUNTRY_TO_REGION[cc] || "europe";
}

export function resolveRegion({ countryCode, email } = {}) {
  const cc = countryCode || inferCountryFromEmail(email);
  return { countryCode: cc, regionBucket: countryToRegion(cc) };
}

export function getHeatmapRegionLabels() {
  return {
    france: "France",
    belgium: "Belgique",
    switzerland: "Suisse",
    canada: "Canada",
    usa: "USA",
    japan: "Japon",
    europe: "Europe",
    world: "Monde"
  };
}

export { REGION_BUCKETS, COUNTRY_TO_REGION };
