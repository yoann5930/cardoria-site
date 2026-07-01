/**
 * Cardoria Intelligence Premium — moteur d'intelligence de marché.
 * Compatible toutes licences TCG (Pokémon, Yu-Gi-Oh!, One Piece, Lorcana, Magic, DBS, SWU, futures).
 */
import { getPriceHistory, seedPriceHistoryIfEmpty } from "./history.js";
import { getCardById } from "../engine/cards.js";
import { buildSmartEstimate } from "./smart-estimate.js";
import { normalizeCondition } from "./condition.js";
import { getCardMarketStats } from "../market/stats.js";

const CONDITION_SCORE = {
  mint: 98,
  near_mint: 92,
  excellent: 85,
  good: 72,
  played: 55,
  poor: 35
};

const RECOMMENDATIONS = {
  BUY: { code: "ACHETER", label: "ACHETER", clientHint: "Marché favorable — bonne opportunité d'acquisition ou de vente à Cardoria." },
  HOLD: { code: "CONSERVER", label: "CONSERVER", clientHint: "Valeur stable — conserver la carte est pertinent." },
  WAIT: { code: "ATTENDRE", label: "ATTENDRE", clientHint: "Marché incertain — patientez avant de vendre ou d'investir." },
  SELL: { code: "VENDRE", label: "VENDRE", clientHint: "Conditions favorables pour vendre maintenant." }
};

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function volatilityFromHistory(points) {
  if (!points || points.length < 3) return 0.06;
  const vals = points.map((p) => Number(p.recommended || p.avg || 0)).filter(Boolean);
  if (vals.length < 3) return 0.06;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
  return clamp(Math.sqrt(variance) / (mean || 1), 0.02, 0.25);
}

function forecastPrice({ currentPrice, trendPercent30, trendPercent90, horizonDays, volatility, dataPoints }) {
  const daily30 = (trendPercent30 || 0) / 100 / 30;
  const daily90 = (trendPercent90 || 0) / 100 / 90;
  const blendedDaily = daily30 * 0.65 + daily90 * 0.35;
  const damped = blendedDaily * Math.pow(0.92, horizonDays / 30);
  const price = round2(currentPrice * Math.pow(1 + damped, horizonDays));

  const confidence = clamp(
    Math.round(55 + Math.min(dataPoints, 40) * 0.8 - horizonDays * 0.04),
    35,
    92
  );

  return {
    days: horizonDays,
    price,
    changePercent: currentPrice > 0 ? round2(((price - currentPrice) / currentPrice) * 100) : 0,
    direction: price > currentPrice * 1.02 ? "up" : price < currentPrice * 0.98 ? "down" : "stable",
    confidence
  };
}

function buildHistoryBundle(cardId) {
  const periods = ["7", "30", "90", "365"];
  const history = {};
  periods.forEach((p) => {
    const h = getPriceHistory(cardId, p);
    history[p === "365" ? "1y" : p + "d"] = {
      period: p,
      points: h.points || [],
      latest: h.points?.length ? h.points[h.points.length - 1] : null
    };
  });
  return history;
}

function computeFuturePotential({ trend30, trend90, forecasts, liquidityScore, demandScore }) {
  const f30 = forecasts?.days30?.changePercent || 0;
  const f90 = forecasts?.days90?.changePercent || 0;
  const f365 = forecasts?.days365?.changePercent || 0;
  let score = 50;
  score += clamp(f30 * 0.35, -12, 12);
  score += clamp(f90 * 0.25, -10, 10);
  score += clamp(f365 * 0.15, -8, 8);
  score += clamp((trend30?.percent || 0) * 0.2, -8, 8);
  score += clamp((liquidityScore - 50) * 0.15, -8, 8);
  score += clamp((demandScore - 50) * 0.12, -6, 6);
  return clamp(Math.round(score), 0, 100);
}

function computeClientRecommendation(ctx) {
  const {
    overallScore,
    futurePotential,
    trendDirection,
    suspicionAlert,
    buybackStatus,
    liquidityScore,
    trend30
  } = ctx;

  if (suspicionAlert || buybackStatus === "manual_verification_required") {
    return { ...RECOMMENDATIONS.WAIT, detail: "Examen expert requis avant toute décision." };
  }

  if (trendDirection === "down" && (trend30?.percent || 0) < -8) {
    return { ...RECOMMENDATIONS.SELL, detail: "Tendance baissière marquée — vendre tant que la valeur reste correcte." };
  }

  if (overallScore >= 78 && futurePotential >= 70 && trendDirection !== "down" && liquidityScore >= 55) {
    return { ...RECOMMENDATIONS.BUY, detail: "Demande forte et potentiel positif — opportunité intéressante." };
  }

  if (overallScore >= 65 && trendDirection === "up" && futurePotential >= 60) {
    return { ...RECOMMENDATIONS.BUY, detail: "Marché en hausse avec bon score Cardoria." };
  }

  if (trendDirection === "down" || futurePotential < 42 || overallScore < 38) {
    return { ...RECOMMENDATIONS.WAIT, detail: "Marché peu favorable à court terme — patience recommandée." };
  }

  if (overallScore >= 55 && trendDirection === "stable" && liquidityScore >= 45) {
    return { ...RECOMMENDATIONS.HOLD, detail: "Valeur stable — pas d'urgence à vendre." };
  }

  if (overallScore >= 48 && liquidityScore < 40) {
    return { ...RECOMMENDATIONS.SELL, detail: "Liquidité limitée — écouler si une offre correcte se présente." };
  }

  return { ...RECOMMENDATIONS.HOLD, detail: RECOMMENDATIONS.HOLD.clientHint };
}

function computePricingTiers({ market, trade, marketIndex }) {
  const avg = market.avg || 0;
  const low = market.low || avg * 0.88;
  const high = market.high || avg * 1.15;
  const resell = trade.resell || avg;
  const score = marketIndex?.cardoriaMarketScore ?? 50;
  const liquidity = marketIndex?.liquidity?.tier || trade.liquidity || "normal";

  let quickFactor = liquidity === "high" ? 0.94 : liquidity === "low" ? 0.88 : 0.91;
  let optimalFactor = score >= 75 ? 1.08 : score >= 60 ? 1.05 : 1.02;

  if (marketIndex?.trend?.direction === "down") {
    quickFactor -= 0.03;
    optimalFactor -= 0.04;
  } else if (marketIndex?.trend?.direction === "up") {
    optimalFactor += 0.02;
  }

  return {
    marketAverage: round2(avg),
    marketMinimum: round2(low),
    marketMaximum: round2(high),
    cardoriaRecommended: round2(resell || avg),
    quickSale: round2(resell * quickFactor),
    optimalSale: round2(Math.max(resell * optimalFactor, high * 0.98)),
    professionalBuy: trade.buyback != null ? round2(trade.buyback) : null
  };
}

/**
 * Construit l'intelligence complète à partir d'une smart-estimate.
 */
export function buildCardoriaIntelligence(estimate, ctx = {}) {
  const trade = estimate.trade || {};
  const market = trade.market || estimate.prices || {};
  const idx = trade.marketIndex || estimate.marketIndex || {};
  const cardId = estimate.cardId || estimate.card?.id || null;
  const conditionKey = estimate.conditionKey || "near_mint";

  const pricing = computePricingTiers({ market, trade, marketIndex: idx });

  const potentialMargin = trade.margin != null ? round2(trade.margin) : null;
  const marginPercent = trade.marginPercent ?? null;
  const rotationDays = idx.rotation?.days || trade.estimatedRotationDays || 60;
  const estimatedProfitability = marginPercent != null && rotationDays > 0
    ? round2((marginPercent / rotationDays) * 365)
    : null;

  const history = cardId ? buildHistoryBundle(cardId) : {
    "7d": { period: "7", points: [] },
    "30d": { period: "30", points: [] },
    "90d": { period: "90", points: [] },
    "1y": { period: "365", points: [] }
  };

  const marketStats = cardId ? getCardMarketStats(cardId) : null;

  const histPoints = history["1y"]?.points?.length ? history["1y"].points : history["30d"]?.points || [];
  const volatility = volatilityFromHistory(histPoints);
  const currentPrice = pricing.cardoriaRecommended || pricing.marketAverage || 0;
  const trend30 = idx.evolution?.days30 || { percent: 0, direction: "stable" };
  const trend90 = idx.evolution?.days90 || { percent: 0, direction: "stable" };

  const forecasts = {
    days30: forecastPrice({
      currentPrice,
      trendPercent30: trend30.percent,
      trendPercent90: trend90.percent,
      horizonDays: 30,
      volatility,
      dataPoints: histPoints.length
    }),
    days90: forecastPrice({
      currentPrice,
      trendPercent30: trend30.percent,
      trendPercent90: trend90.percent,
      horizonDays: 90,
      volatility,
      dataPoints: histPoints.length
    }),
    days365: forecastPrice({
      currentPrice,
      trendPercent30: trend30.percent,
      trendPercent90: trend90.percent,
      horizonDays: 365,
      volatility,
      dataPoints: histPoints.length
    })
  };

  const authenticityScore = ctx.confidenceScore != null
    ? clamp(Math.round(ctx.confidenceScore), 0, 100)
    : null;
  const conditionScore = CONDITION_SCORE[conditionKey] ?? 75;
  const liquidityScore = idx.liquidity?.score ?? 50;
  const popularityScore = idx.popularity?.score ?? 50;
  const rarityScore = idx.rarity?.score ?? 50;
  const futurePotential = computeFuturePotential({
    trend30,
    trend90,
    forecasts,
    liquidityScore,
    demandScore: idx.demand ?? 50
  });

  const scoreWeights = {
    authenticity: authenticityScore != null ? 0.22 : 0,
    condition: 0.18,
    liquidity: 0.2,
    popularity: 0.12,
    rarity: 0.14,
    futurePotential: 0.14
  };
  if (authenticityScore == null) {
    scoreWeights.condition = 0.22;
    scoreWeights.liquidity = 0.24;
    scoreWeights.popularity = 0.14;
    scoreWeights.rarity = 0.18;
    scoreWeights.futurePotential = 0.22;
  }

  const scores = {
    authenticity: authenticityScore,
    condition: conditionScore,
    liquidity: liquidityScore,
    popularity: popularityScore,
    rarity: rarityScore,
    futurePotential
  };

  let overall = 0;
  let totalW = 0;
  if (scores.authenticity != null) {
    overall += scores.authenticity * scoreWeights.authenticity;
    totalW += scoreWeights.authenticity;
  }
  overall += scores.condition * scoreWeights.condition;
  overall += scores.liquidity * scoreWeights.liquidity;
  overall += scores.popularity * scoreWeights.popularity;
  overall += scores.rarity * scoreWeights.rarity;
  overall += scores.futurePotential * scoreWeights.futurePotential;
  totalW += scoreWeights.condition + scoreWeights.liquidity + scoreWeights.popularity + scoreWeights.rarity + scoreWeights.futurePotential;
  scores.overall = clamp(Math.round(overall / totalW), 0, 100);

  const recommendation = computeClientRecommendation({
    overallScore: scores.overall,
    futurePotential,
    trendDirection: idx.trend?.direction || estimate.marketTrend || "stable",
    suspicionAlert: ctx.suspicionAlert,
    buybackStatus: trade.buybackStatus,
    liquidityScore,
    trend30
  });

  return {
    version: "1.0",
    computedAt: new Date().toISOString(),
    cardId,
    license: estimate.card?.license || estimate.detection?.license || "autre",
    condition: estimate.condition,
    conditionKey,
    market: {
      average: pricing.marketAverage,
      minimum: pricing.marketMinimum,
      maximum: pricing.marketMaximum
    },
    pricing,
    margin: {
      amount: potentialMargin,
      percent: marginPercent,
      estimatedProfitability,
      rotationDays,
      rotationLabel: idx.rotation?.label || trade.estimatedRotationLabel
    },
    indices: {
      rarity: { score: marketStats?.indices?.rarity ?? rarityScore, label: idx.rarity?.label || "—", raw: idx.rarity?.raw },
      liquidity: { score: marketStats?.indices?.liquidity ?? liquidityScore, label: idx.liquidity?.label || trade.liquidityLabel, tier: idx.liquidity?.tier },
      demand: marketStats?.indices?.demand ?? idx.demand ?? null,
      marketScore: idx.cardoriaMarketScore ?? null
    },
    marketStats: marketStats || null,
    trend: {
      direction: idx.trend?.direction || estimate.marketTrend || "stable",
      label: idx.trend?.label || "Stable",
      evolution: idx.evolution || {}
    },
    history,
    forecasts,
    scores,
    recommendation,
    adminRecommendation: trade.adminRecommendation || null,
    marketIndex: idx
  };
}

/** Intelligence pour une fiche catalogue (sans analyse photo). */
export function buildIntelligenceForCard(cardId, conditionGrade = "Near Mint") {
  const card = getCardById(cardId);
  if (!card) return null;

  seedPriceHistoryIfEmpty(cardId, card.prices?.recommended || card.avgPrice || 10);

  const cond = normalizeCondition(conditionGrade);
  const estimate = buildSmartEstimate({
    detection: {
      license: card.license,
      name: card.name,
      extension: card.extension,
      number: card.number,
      rarity: card.rarity
    },
    conditionGrade: cond.label,
    cardId: card.id,
    suspicionAlert: false,
    confidenceScore: null
  });

  return buildCardoriaIntelligence(estimate, { suspicionAlert: false, confidenceScore: null });
}

/** Données visibles client uniquement. */
export function toClientIntelligence(intelligence) {
  if (!intelligence) return null;
  const p = intelligence.pricing || {};
  return {
    recommendedPrice: p.cardoriaRecommended,
    salePrice: p.optimalSale || p.cardoriaRecommended,
    buybackPrice: p.professionalBuy,
    cardoriaScore: intelligence.scores?.overall ?? null,
    recommendation: intelligence.recommendation
      ? { code: intelligence.recommendation.code, label: intelligence.recommendation.label, hint: intelligence.recommendation.clientHint || intelligence.recommendation.detail }
      : null,
    requiresExpertReview: intelligence.recommendation?.code === "ATTENDRE" &&
      String(intelligence.recommendation.detail || "").includes("Examen expert")
  };
}

/** Bloc texte client (5 champs visibles). */
export function formatClientIntelligenceBlock(intelligence) {
  const c = toClientIntelligence(intelligence);
  if (!c || !c.recommendedPrice) return "";

  const lines = [
    "",
    "── Intelligence Cardoria ──",
    `Prix conseillé : ${fmt(c.recommendedPrice)}`,
    `Prix de vente conseillé : ${fmt(c.salePrice)}`,
    c.buybackPrice != null ? `Prix de rachat Cardoria : ${fmt(c.buybackPrice)}` : "Prix de rachat Cardoria : sur examen expert",
    c.cardoriaScore != null ? `Score Cardoria : ${c.cardoriaScore} / 100` : "",
    c.recommendation ? `Recommandation : ${c.recommendation.label}` : ""
  ];
  if (c.recommendation?.hint) lines.push(c.recommendation.hint);
  return lines.filter(Boolean).join("\n");
}

function fmt(n) {
  return Number(n || 0).toFixed(2).replace(".", ",") + " €";
}
