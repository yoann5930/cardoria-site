/**
 * Estimation intelligente Cardoria — marché + logique achat / revente + indice marché.
 */
import { getCardById, searchCards } from "../engine/cards.js";
import { conditionMultiplierFor, estimatePrice, getPriceSources } from "../engine/pricing.js";
import { comparePrices } from "../marketplace/compare.js";
import { normalizeCondition, conditionToEngineKey } from "./condition.js";
import { normalizeLicense } from "./prompts.js";
import {
  computeMarketIndex,
  applyMarketScoreToPricing,
  enrichPricingWithMarketIndex
} from "./market-index.js";
import { formatClientIntelligenceBlock, toClientIntelligence } from "./intelligence.js";
import { getCardMarketStats } from "../market/stats.js";

const MARKET_SOURCES = [
  { id: "actual_sales", label: "Ventes réelles Cardoria", weight: 0.65 },
  { id: "cardmarket", label: "Cardmarket", weight: 0.55 },
  { id: "tcgplayer", label: "TCGPlayer", weight: 0.45 },
  { id: "zebradex", label: "ZebraDex", weight: 0.35 },
  { id: "cardoria", label: "Référence Cardoria", weight: 0.25 },
  { id: "cardoria_marketplace", label: "Annonces Cardoria", weight: 0.18 },
  { id: "cardoria_engine", label: "Moteur Cardoria", weight: 0.15 }
];

const CONDITION_BUYBACK_FACTOR = {
  mint: 1.0,
  near_mint: 0.96,
  excellent: 0.9,
  good: 0.72,
  played: 0.55,
  poor: 0.35
};

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function textKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function compactKey(value) {
  return textKey(value).replace(/\s+/g, "");
}

function numberKey(value) {
  return compactKey(String(value || "").split("/")[0].replace(/^0+(?=\d)/, ""));
}

function languageKey(value) {
  const key = compactKey(value);
  const map = {
    fr: "fr", french: "fr", francais: "fr",
    en: "en", english: "en", anglais: "en",
    jp: "ja", ja: "ja", japanese: "ja", japonais: "ja",
    kr: "ko", ko: "ko", korean: "ko", coreen: "ko"
  };
  return map[key] || key;
}

export function scoreCatalogMatch(card, detection = {}) {
  if (!card) return { score: 0, exact: false, signals: {} };

  const wantedLicense = normalizeLicense(detection.license);
  const cardLicense = normalizeLicense(card.license);
  const wantedName = textKey(detection.name);
  const cardName = textKey(card.name);
  const wantedNumber = numberKey(detection.number);
  const cardNumber = numberKey(card.number);
  const wantedExtension = textKey(detection.extension);
  const cardExtension = textKey(card.extension);
  const wantedLanguage = languageKey(detection.language);
  const cardLanguage = languageKey(card.language);

  const signals = {
    license: Boolean(wantedLicense && wantedLicense !== "autre" && wantedLicense === cardLicense),
    nameExact: Boolean(wantedName && wantedName === cardName),
    namePartial: Boolean(wantedName && cardName && (wantedName.includes(cardName) || cardName.includes(wantedName))),
    numberExact: Boolean(wantedNumber && wantedNumber === cardNumber),
    extensionExact: Boolean(wantedExtension && wantedExtension === cardExtension),
    extensionPartial: Boolean(wantedExtension && cardExtension && (wantedExtension.includes(cardExtension) || cardExtension.includes(wantedExtension))),
    language: Boolean(wantedLanguage && wantedLanguage === cardLanguage)
  };

  let score = 0;
  if (signals.license) score += 3;
  if (signals.nameExact) score += 6;
  else if (signals.namePartial) score += 3;
  if (signals.numberExact) score += 7;
  if (signals.extensionExact) score += 5;
  else if (signals.extensionPartial) score += 2;
  if (signals.language) score += 2;

  const exact = Boolean(
    signals.numberExact &&
    (signals.nameExact || signals.extensionExact) &&
    (!wantedLicense || wantedLicense === "autre" || signals.license)
  );

  return { score, exact, signals };
}

export function resolveCatalogCard({ detection = {}, cardId = "" } = {}) {
  if (cardId) {
    const selected = getCardById(cardId);
    if (!selected) {
      return { card: null, method: "selected_missing", score: 0, exact: false, ambiguous: false };
    }
    const scored = scoreCatalogMatch(selected, detection);
    const acceptable = scored.exact || scored.score >= 9;
    return {
      card: acceptable ? selected : null,
      selectedCard: selected,
      method: acceptable ? "selected_verified" : "selected_mismatch",
      score: scored.score,
      exact: scored.exact,
      ambiguous: !acceptable,
      signals: scored.signals
    };
  }

  if (!detection?.name) {
    return { card: null, method: "missing_identity", score: 0, exact: false, ambiguous: true };
  }

  const license = normalizeLicense(detection.license);
  const language = languageKey(detection.language);
  const result = searchCards({
    q: detection.name,
    license: license !== "autre" ? license : "",
    language: ["fr", "en", "ja", "ko"].includes(language) ? language : "",
    limit: 20
  });

  const ranked = (result.cards || [])
    .map((card) => ({ card, ...scoreCatalogMatch(card, detection) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  if (!top) return { card: null, method: "no_match", score: 0, exact: false, ambiguous: true };

  const uniqueEnough = !second || top.score - second.score >= 2;
  const acceptable = top.exact || (top.score >= 9 && uniqueEnough);

  return {
    card: acceptable ? top.card : null,
    method: acceptable ? "automatic_verified" : "automatic_ambiguous",
    score: top.score,
    exact: top.exact,
    ambiguous: !acceptable,
    signals: top.signals
  };
}

export function matchCatalogCard(detection) {
  return resolveCatalogCard({ detection }).card;
}

function cardMeta(card) {
  if (!card) return null;
  return {
    id: card.id,
    name: card.name,
    extension: card.extension,
    number: card.number,
    rarity: card.rarity,
    license: card.license,
    language: card.language,
    variants: card.variants || {},
    salesCount: card.salesCount || 0,
    views: card.views || 0
  };
}

function sourceLabel(source) {
  return MARKET_SOURCES.find((item) => item.id === source)?.label || String(source || "Source marché");
}

function sourceBaseWeight(source, explicitWeight) {
  const configured = Number(explicitWeight);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return MARKET_SOURCES.find((item) => item.id === source)?.weight || 0.12;
}

function freshnessFactor(fetchedAt) {
  const at = Date.parse(String(fetchedAt || ""));
  if (!Number.isFinite(at)) return 1;
  const ageDays = Math.max(0, (Date.now() - at) / 86400000);
  if (ageDays <= 2) return 1;
  if (ageDays <= 7) return 0.9;
  if (ageDays <= 30) return 0.7;
  if (ageDays <= 90) return 0.45;
  return 0.25;
}

function median(values) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function computeLiquidityProfile({ marketTrend, trendPercent, salesCount, resellPrice }) {
  let score = 0;
  if (marketTrend === "up") score += 2;
  else if (marketTrend === "down") score -= 2;
  if (salesCount >= 20) score += 2;
  else if (salesCount >= 8) score += 1;
  else if (salesCount <= 2) score -= 1;
  if (trendPercent > 10) score += 1;
  if (trendPercent < -10) score -= 1;
  if (resellPrice > 300) score -= 1;

  if (score >= 3) return { tier: "high", marginRate: 0.12, label: "Très liquide et recherchée" };
  if (score >= 0) return { tier: "normal", marginRate: 0.22, label: "Demande normale" };
  return { tier: "low", marginRate: 0.34, label: "Peu demandée" };
}

function computeBaseBuyResellPricing(base, { suspicionAlert = false, confidenceScore = null } = {}) {
  const condKey = base.conditionKey || "near_mint";
  const buybackFactor = CONDITION_BUYBACK_FACTOR[condKey] ?? 0.9;

  const rawLow = Number(base.prices?.low || 0);
  const rawHigh = Number(base.prices?.high || 0);
  const rawAvg = Number(base.prices?.avg || 0);
  const rawRecommended = Number(base.prices?.recommended || rawAvg || 0);

  const market = {
    low: round2(rawLow),
    avg: round2(rawAvg),
    high: round2(Math.max(rawHigh, rawAvg)),
    recommended: round2(rawRecommended)
  };

  let resell = market.recommended || market.avg;
  if (market.low > 0) resell = Math.max(resell, market.low);
  if (market.high > 0) resell = Math.min(resell, market.high);

  const cardMetaData = base.card || {};
  const liquidity = computeLiquidityProfile({
    marketTrend: base.marketTrend,
    trendPercent: base.trendPercent || 0,
    salesCount: cardMetaData.salesCount || 0,
    resellPrice: resell
  });

  let marginRate = liquidity.marginRate;
  if (condKey === "played" || condKey === "poor") marginRate += 0.06;

  let buyback = null;
  let margin = null;
  let marginPercent = null;
  let buybackStatus = "ok";
  let adminNote = "";

  if (suspicionAlert || base.catalogMatch?.ambiguous || !base.cardId) {
    buybackStatus = "manual_verification_required";
    adminNote = suspicionAlert
      ? "À vérifier en main — authenticité douteuse, pas de rachat automatique"
      : "Identification catalogue insuffisamment certaine — vérification manuelle requise";
  } else if (resell > 0) {
    buyback = round2(resell * (1 - marginRate) * buybackFactor);
    buyback = Math.min(buyback, round2(resell - 0.5));
    if (buyback <= 0) {
      buyback = null;
      buybackStatus = "manual_verification_required";
      adminNote = "Prix de rachat non calculable automatiquement";
    } else {
      margin = round2(resell - buyback);
      marginPercent = resell > 0 ? round2((margin / resell) * 100) : null;
    }
  }

  const confidenceLevel =
    confidenceScore == null ? "unknown" :
    confidenceScore >= 95 ? "high" :
    confidenceScore >= 85 ? "medium" : "low";

  return {
    market,
    buyback,
    resell: round2(resell),
    margin,
    marginPercent,
    liquidity: liquidity.tier,
    liquidityLabel: liquidity.label,
    targetMarginRate: round2(marginRate * 100),
    buybackStatus,
    adminNote,
    confidenceLevel,
    confidenceScore: confidenceScore ?? null,
    _buybackFactor: buybackFactor,
    _conditionKey: condKey
  };
}

export function computeBuyResellPricing(base, opts = {}) {
  const basePricing = computeBaseBuyResellPricing(base, opts);

  const marketIndex = computeMarketIndex({
    card: base.card,
    detection: base.detection,
    cardId: base.cardId,
    resellPrice: basePricing.resell,
    marketTrend: base.marketTrend,
    trendPercent: base.trendPercent || 0,
    suspicionAlert: opts.suspicionAlert,
    conditionKey: base.conditionKey
  });

  const scored = applyMarketScoreToPricing(basePricing, marketIndex);
  return enrichPricingWithMarketIndex(scored, marketIndex, {
    suspicionAlert: opts.suspicionAlert,
    conditionKey: base.conditionKey
  });
}

export function buildSmartEstimate({ detection, conditionGrade, cardId, suspicionAlert = false, confidenceScore = null }) {
  const cond = normalizeCondition(conditionGrade);
  const engineKey = conditionToEngineKey(cond.key);
  const conditionFactor = conditionMultiplierFor(engineKey);
  const catalogMatch = resolveCatalogCard({ detection, cardId });
  const card = catalogMatch.card;
  const resolvedCardId = card?.id || null;
  const meta = cardMeta(card);

  const sources = [];
  const rangeCandidates = [];

  if (card) {
    const actualStats = getCardMarketStats(card.id);
    if (actualStats?.volume > 0) {
      const saleRef = Number(actualStats.medianPrice || actualStats.avgPrice || 0);
      if (saleRef > 0) {
        sources.push({
          source: "actual_sales",
          price: saleRef,
          label: "Ventes réelles Cardoria",
          weight: MARKET_SOURCES.find((item) => item.id === "actual_sales").weight
        });
      }
      [actualStats.minPrice, actualStats.maxPrice].forEach((value) => {
        if (Number(value) > 0) rangeCandidates.push(Number(value));
      });
    }

    getPriceSources(card.id).forEach((row) => {
      const price = Number(row.price || 0);
      if (price <= 0) return;
      sources.push({
        source: row.source,
        price,
        label: sourceLabel(row.source),
        fetchedAt: row.fetchedAt || null,
        weight: sourceBaseWeight(row.source, row.weight) * freshnessFactor(row.fetchedAt)
      });
    });

    const cmp = comparePrices({ cardId: card.id });
    const listingPrices = (cmp.comparison || [])
      .filter((row) => row.type === "marketplace" || row.type === "listing")
      .map((row) => Number(row.price || 0))
      .filter((price) => price > 0);
    const listingMedian = median(listingPrices);
    if (listingMedian > 0) {
      sources.push({
        source: "cardoria_marketplace",
        price: listingMedian,
        label: "Annonces Cardoria",
        weight: MARKET_SOURCES.find((item) => item.id === "cardoria_marketplace").weight
      });
      rangeCandidates.push(...listingPrices);
    }

    if (!sources.length) {
      const engine = estimatePrice(card.id, "nm");
      if (engine?.recommended > 0) {
        sources.push({
          source: "cardoria_engine",
          price: engine.recommended,
          label: "Moteur Cardoria",
          weight: MARKET_SOURCES.find((item) => item.id === "cardoria_engine").weight
        });
        if (engine.range?.low > 0) rangeCandidates.push(engine.range.low);
        if (engine.range?.high > 0) rangeCandidates.push(engine.range.high);
      }
    }
  }

  const emptyBase = {
    cardId: resolvedCardId,
    card: meta,
    catalogMatch,
    detection: detection || {},
    condition: cond.label,
    conditionKey: cond.key,
    conditionMultiplier: conditionFactor,
    prices: { low: 0, avg: 0, high: 0, recommended: 0 },
    sources: [],
    marketTrend: "unknown",
    trendPercent: 0
  };

  if (!sources.length) {
    const trade = computeBuyResellPricing(emptyBase, { suspicionAlert, confidenceScore });
    return { ...emptyBase, trade, marketIndex: trade.marketIndex };
  }

  const sourcePrices = sources.map((source) => Number(source.price)).filter((price) => price > 0);
  const rawLow = Math.min(...sourcePrices, ...(rangeCandidates.length ? rangeCandidates : sourcePrices));
  const rawHigh = Math.max(...sourcePrices, ...(rangeCandidates.length ? rangeCandidates : sourcePrices));
  const rawAvg = sourcePrices.reduce((sum, price) => sum + price, 0) / sourcePrices.length;

  let weighted = 0;
  let totalWeight = 0;
  sources.forEach((source) => {
    const weight = Number(source.weight || sourceBaseWeight(source.source));
    weighted += Number(source.price || 0) * weight;
    totalWeight += weight;
  });
  const rawRecommended = totalWeight > 0 ? weighted / totalWeight : rawAvg;

  const prices = {
    low: round2(rawLow * conditionFactor),
    avg: round2(rawAvg * conditionFactor),
    high: round2(rawHigh * conditionFactor),
    recommended: round2(rawRecommended * conditionFactor)
  };

  const trend = card?.marketTrend ||
    (prices.recommended > prices.avg * 1.05 ? "up" : prices.recommended < prices.avg * 0.95 ? "down" : "stable");

  const base = {
    cardId: resolvedCardId,
    card: meta,
    catalogMatch,
    detection: detection || {},
    condition: cond.label,
    conditionKey: cond.key,
    conditionMultiplier: conditionFactor,
    prices,
    sources: sources.slice(0, 10),
    marketTrend: trend,
    trendPercent: card?.trendPercent || 0
  };

  const trade = computeBuyResellPricing(base, { suspicionAlert, confidenceScore });

  return { ...base, trade, marketIndex: trade.marketIndex };
}

/** Prix complets pour stockage admin */
export function flattenPricing(estimate, intelligence = null) {
  const t = estimate.trade || {};
  const m = t.market || {};
  const idx = t.marketIndex || estimate.marketIndex || {};
  const rec = t.adminRecommendation || {};

  return {
    low: m.low ?? estimate.prices?.low ?? 0,
    avg: m.avg ?? estimate.prices?.avg ?? 0,
    high: m.high ?? estimate.prices?.high ?? 0,
    recommended: t.resell ?? estimate.prices?.recommended ?? 0,
    market: { low: m.low, avg: m.avg, high: m.high },
    sources: (estimate.sources || []).map((source) => ({
      source: source.source,
      label: source.label,
      price: source.price,
      fetchedAt: source.fetchedAt || null
    })),
    catalogMatch: estimate.catalogMatch || null,
    conditionMultiplier: estimate.conditionMultiplier ?? null,
    buyback: t.buyback,
    resell: t.resell,
    margin: t.margin,
    marginPercent: t.marginPercent,
    liquidity: t.liquidity,
    liquidityLabel: t.liquidityLabel,
    targetMarginRate: t.targetMarginRate,
    estimatedRotationDays: t.estimatedRotationDays,
    estimatedRotationLabel: t.estimatedRotationLabel,
    buybackStatus: t.buybackStatus,
    adminNote: t.adminNote,
    confidenceLevel: t.confidenceLevel,
    confidenceScore: t.confidenceScore,
    marketIndex: idx,
    adminRecommendation: rec,
    intelligence: intelligence || null
  };
}

/** Réponse API client — intelligence premium visible, détails admin masqués */
export function toClientEstimate(estimate, intelligence = null) {
  const clientIntel = intelligence ? toClientIntelligence(intelligence) : null;
  const t = estimate.trade || {};

  return {
    recommendedPrice: clientIntel?.recommendedPrice ?? null,
    salePrice: clientIntel?.salePrice ?? null,
    buybackPrice: clientIntel?.buybackPrice ?? null,
    cardoriaScore: clientIntel?.cardoriaScore ?? null,
    recommendation: clientIntel?.recommendation ?? null,
    requiresExpertReview: clientIntel?.requiresExpertReview || t.buybackStatus === "manual_verification_required"
  };
}

export function formatClientEstimateBlock(estimate, intelligence = null) {
  if (intelligence) return formatClientIntelligenceBlock(intelligence);

  const t = estimate.trade || {};
  const m = t.market || estimate.prices || {};
  if (!m.avg && !estimate.prices?.avg) return "";

  const trendLabel = estimate.marketTrend === "up" ? "Hausse" : estimate.marketTrend === "down" ? "Baisse" : "Stable";

  const lines = [
    "",
    "── Estimation Cardoria ──",
    estimate.card ? `Carte : ${estimate.card.name}${estimate.card.extension ? " (" + estimate.card.extension + ")" : ""}` : "",
    `État analysé : ${estimate.condition}`,
    `Prix marché bas : ${fmt(m.low ?? estimate.prices?.low)}`,
    `Prix marché moyen : ${fmt(m.avg ?? estimate.prices?.avg)}`,
    `Prix marché haut : ${fmt(m.high ?? estimate.prices?.high)}`,
    `Estimation indicative : ${fmt(m.avg ?? estimate.prices?.avg)}`,
    t.liquidityLabel ? `Demande marché : ${t.liquidityLabel}` : "",
    `Tendance : ${trendLabel}`
  ];

  if (t.buybackStatus === "manual_verification_required") {
    lines.push("Notre équipe doit examiner cette carte avant toute offre de rachat.");
  } else {
    lines.push("Une offre de rachat personnalisée peut vous être proposée après validation par nos experts.");
  }

  return lines.filter(Boolean).join("\n");
}

function fmt(n) {
  return Number(n || 0).toFixed(2).replace(".", ",") + " €";
}
