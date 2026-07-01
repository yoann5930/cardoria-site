/**
 * Estimation intelligente Cardoria — marché + logique achat / revente + indice marché.
 */
import { getCardById, searchCards } from "../engine/cards.js";
import { estimatePrice } from "../engine/pricing.js";
import { comparePrices } from "../marketplace/compare.js";
import { searchListings } from "../marketplace/listings.js";
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
  { id: "cardoria_engine", label: "Moteur Cardoria", weight: 0.35 },
  { id: "cardoria_marketplace", label: "Marketplace Cardoria", weight: 0.25 },
  { id: "cardmarket", label: "Cardmarket (ref.)", weight: 0.2 },
  { id: "tcgplayer", label: "TCGPlayer (ref.)", weight: 0.12 },
  { id: "ebay", label: "eBay (ref.)", weight: 0.08 }
];

const CONDITION_MARKET_FACTOR = {
  mint: 1.1,
  near_mint: 1.0,
  excellent: 0.88,
  good: 0.68,
  played: 0.52,
  poor: 0.3
};

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

export function matchCatalogCard(detection) {
  if (!detection?.name) return null;
  const license = normalizeLicense(detection.license);
  const q = [detection.name, detection.number, detection.extension].filter(Boolean).join(" ");
  const result = searchCards({ q, license: license !== "autre" ? license : "", limit: 1 });
  return result.cards?.[0] || null;
}

function cardMeta(card) {
  if (!card) return null;
  return {
    id: card.id,
    name: card.name,
    extension: card.extension,
    rarity: card.rarity,
    license: card.license,
    salesCount: card.salesCount || 0,
    views: card.views || 0
  };
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
  const marketFactor = CONDITION_MARKET_FACTOR[condKey] ?? 1;
  const buybackFactor = CONDITION_BUYBACK_FACTOR[condKey] ?? 0.9;

  const rawLow = base.prices?.low || 0;
  const rawHigh = base.prices?.high || 0;
  const rawAvg = base.prices?.avg || 0;

  const market = {
    low: round2(rawLow > 0 ? rawLow * 0.98 : 0),
    avg: round2(rawAvg * marketFactor),
    high: round2(Math.max(rawHigh, rawAvg * marketFactor * 1.12, marketFactor * rawAvg))
  };

  if (market.avg <= 0 && rawAvg > 0) market.avg = round2(rawAvg);
  if (market.high <= market.avg && market.avg > 0) market.high = round2(market.avg * 1.15);

  let resell = market.avg;
  if (condKey === "mint" || condKey === "near_mint") {
    resell = round2((market.avg + market.high) / 2);
  } else if (condKey === "excellent") {
    resell = round2(market.avg * 1.02);
  }
  resell = Math.max(resell, market.low);

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

  if (suspicionAlert) {
    buybackStatus = "manual_verification_required";
    adminNote = "À vérifier en main — authenticité douteuse, pas de rachat automatique";
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
  let card = cardId ? getCardById(cardId) : matchCatalogCard(detection);
  const resolvedCardId = card?.id || null;
  const meta = cardMeta(card);

  const sources = [];
  const prices = [];

  if (card) {
    const mstats = getCardMarketStats(card.id);
    if (mstats?.volume > 0) {
      sources.push({ source: "cardoria_engine", price: mstats.medianPrice || mstats.avgPrice, label: "Données marché Cardoria" });
      prices.push(mstats.avgPrice, mstats.medianPrice, mstats.minPrice, mstats.maxPrice);
    }
    const eng = estimatePrice(card.id, engineKey);
    if (eng) {
      sources.push({ source: "cardoria_engine", price: eng.recommended, label: "Moteur Cardoria" });
      prices.push(eng.recommended);
      if (eng.range?.low) prices.push(eng.range.low);
      if (eng.range?.high) prices.push(eng.range.high);
    }
    const cmp = comparePrices({ cardId: card.id });
    (cmp.comparison || []).forEach((c) => {
      if (c.type === "marketplace" || c.type === "listing" || c.type === "engine") {
        sources.push({ source: c.type === "engine" ? "cardoria_engine" : "cardoria_marketplace", price: c.price, label: c.source });
        prices.push(c.price);
      }
    });
    const refLow = card.prices?.low || eng?.range?.low;
    const refHigh = card.prices?.high || eng?.range?.high;
    if (refLow) { sources.push({ source: "cardmarket", price: refLow * 0.98, label: "Cardmarket (ref.)" }); prices.push(refLow * 0.98); }
    if (refHigh) { sources.push({ source: "tcgplayer", price: refHigh * 0.95, label: "TCGPlayer (ref.)" }); prices.push(refHigh * 0.95); }
  } else if (detection?.name) {
    searchListings({ q: detection.name, limit: 5 }).listings.forEach((l) => {
      sources.push({ source: "cardoria_marketplace", price: l.price, label: l.title });
      prices.push(l.price);
    });
  }

  const emptyBase = {
    cardId: resolvedCardId,
    card: meta,
    detection: detection || {},
    condition: cond.label,
    conditionKey: cond.key,
    prices: { low: 0, avg: 0, high: 0, recommended: 0 },
    sources: [],
    marketTrend: "unknown",
    trendPercent: 0
  };

  if (!prices.length) {
    const trade = computeBuyResellPricing(emptyBase, { suspicionAlert, confidenceScore });
    return { ...emptyBase, trade, marketIndex: trade.marketIndex };
  }

  const low = round2(Math.min(...prices));
  const high = round2(Math.max(...prices));
  const avg = round2(prices.reduce((a, b) => a + b, 0) / prices.length);

  let recommended = 0;
  let totalW = 0;
  sources.forEach((s) => {
    const w = MARKET_SOURCES.find((m) => m.id === s.source)?.weight || 0.15;
    recommended += s.price * w;
    totalW += w;
  });
  recommended = round2(recommended / (totalW || 1));

  const trend = card?.marketTrend || (recommended > avg * 1.05 ? "up" : recommended < avg * 0.95 ? "down" : "stable");

  const base = {
    cardId: resolvedCardId,
    card: meta,
    detection: detection || {},
    condition: cond.label,
    conditionKey: cond.key,
    prices: { low, avg, high, recommended },
    sources: sources.slice(0, 8),
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
