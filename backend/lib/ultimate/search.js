/**
 * Recherche IA en langage naturel.
 */
import { getDb, normalizeText } from "../engine/database.js";
import { searchCards } from "../engine/cards.js";

const LICENSE_ALIASES = {
  pokemon: ["pokemon", "pokémon", "poke", "tcg pokemon"],
  yugioh: ["yugioh", "yu-gi-oh", "ygo", "duel monsters"],
  onepiece: ["one piece", "onepiece", "op tcg"],
  lorcana: ["lorcana", "disney lorcana"],
  magic: ["magic", "mtg", "magic the gathering"],
  dbs: ["dragon ball", "dbs", "dragonball"],
  starwars: ["star wars", "swu", "unlimited"]
};

const RARITY_PATTERNS = [
  { re: /ghost rare/i, rarity: "Ghost Rare" },
  { re: /manga rare/i, rarity: "Manga Rare" },
  { re: /secret rare/i, rarity: "Secret Rare" },
  { re: /ultra rare/i, rarity: "Ultra Rare" },
  { re: /illustration rare/i, rarity: "Illustration Rare" },
  { re: /psa\s*10/i, tag: "psa10" },
  { re: /psa\s*9/i, tag: "psa9" }
];

export function parseNaturalLanguageQuery(query) {
  const raw = String(query || "").trim();
  const lower = raw.toLowerCase();
  const parsed = {
    raw,
    license: "",
    extension: "",
    number: "",
    grade: "",
    rarity: "",
    nameTerms: [],
    tags: []
  };

  for (const [slug, aliases] of Object.entries(LICENSE_ALIASES)) {
    if (aliases.some((a) => lower.includes(a))) {
      parsed.license = slug;
      break;
    }
  }

  const psa = lower.match(/psa\s*(\d+(?:\.\d+)?)/);
  if (psa) parsed.grade = `PSA ${psa[1]}`;

  for (const rp of RARITY_PATTERNS) {
    if (rp.re.test(raw)) {
      if (rp.rarity) parsed.rarity = rp.rarity;
      if (rp.tag) parsed.tags.push(rp.tag);
    }
  }

  const num = raw.match(/\b(\d{1,4}\/\d{1,4}|\d{3}\/\d{3})\b/);
  if (num) parsed.number = num[1];

  let cleaned = raw;
  Object.values(LICENSE_ALIASES).flat().forEach((a) => {
    cleaned = cleaned.replace(new RegExp(a, "gi"), " ");
  });
  cleaned = cleaned.replace(/psa\s*\d+(?:\.\d+)?/gi, " ");
  RARITY_PATTERNS.forEach((rp) => { cleaned = cleaned.replace(rp.re, " "); });

  parsed.nameTerms = normalizeText(cleaned).split(/\s+/).filter((t) => t.length >= 2);
  parsed.searchText = parsed.nameTerms.join(" ") || raw;

  return parsed;
}

export function searchNaturalLanguage(query, { page = 1, limit = 24 } = {}) {
  const start = Date.now();
  const parsed = parseNaturalLanguageQuery(query);

  const result = searchCards({
    q: parsed.searchText,
    license: parsed.license,
    extension: parsed.extension,
    rarity: parsed.rarity,
    page,
    limit
  });

  let cards = result.cards || [];

  if (parsed.number) {
    cards = cards.filter((c) => String(c.number || "").includes(parsed.number.split("/")[0]));
  }

  if (parsed.grade) {
    cards = cards.map((c) => ({
      ...c,
      matchedGrade: parsed.grade,
      gradeHint: `Recherche gradée ${parsed.grade}`
    }));
  }

  const latency = Date.now() - start;

  getDb().prepare(`
    INSERT INTO ultimate_search_log (query_text, parsed_json, results_count, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(query, JSON.stringify(parsed), cards.length, latency, new Date().toISOString());

  return {
    ok: true,
    query: parsed.raw,
    understood: {
      license: parsed.license || null,
      terms: parsed.nameTerms,
      rarity: parsed.rarity || null,
      grade: parsed.grade || null,
      number: parsed.number || null,
      tags: parsed.tags
    },
    cards,
    pagination: result.pagination,
    latencyMs: latency
  };
}

export function getTopNaturalSearches(limit = 20) {
  return getDb().prepare(`
    SELECT query_text AS query, COUNT(*) AS count, AVG(results_count) AS avgResults
    FROM ultimate_search_log GROUP BY query_text ORDER BY count DESC LIMIT ?
  `).all(limit);
}
