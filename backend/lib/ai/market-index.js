/**
 * Indice de marché Cardoria — Cardoria Market Score & recommandations admin.
 */
import { getDb } from "../engine/database.js";
import { getPriceHistory } from "./history.js";
import { getCardMarketStats } from "../market/stats.js";

const RARITY_WEIGHTS = [
  { pattern: /secret|illustration rare|alternate|gold|prismatic|1st edition|first edition/i, score: 92, label: "Très rare" },
  { pattern: /ultra rare|super rare|legendary|hyper rare|special illustration|sr|ur|sir/i, score: 78, label: "Rare" },
  { pattern: /holo rare|rare holo|double rare|promo|full art|vmax|vstar|ex\b|gx\b/i, score: 62, label: "Peu commune" },
  { pattern: /uncommon|peu commune|peu communes/i, score: 38, label: "Peu commune" },
  { pattern: /common|commune|base|standard/i, score: 22, label: "Commune" },
  { pattern: /leader|chase|grail/i, score: 85, label: "Carte chase" }
];

const LICENSE_POPULARITY = {
  pokemon: 95,
  yugioh: 82,
  onepiece: 88,
  lorcana: 75,
  magic: 70,
  dragonball: 65,
  starwars: 72,
  sports: 55,
  autre: 45
};

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function trendFromPercent(percent) {
  if (percent > 4) return "up";
  if (percent < -4) return "down";
  return "stable";
}

function trendLabel(direction) {
  if (direction === "up") return "Hausse";
  if (direction === "down") return "Baisse";
  return "Stable";
}

function computePeriodEvolution(cardId, days) {
  if (!cardId) return { percent: 0, direction: "stable" };
  const history = getPriceHistory(cardId, String(days));
  const points = history.points || [];
  if (points.length < 2) return { percent: 0, direction: "stable" };

  const first = Number(points[0].recommended || points[0].avg || 0);
  const last = Number(points[points.length - 1].recommended || points[points.length - 1].avg || 0);
  if (!first) return { percent: 0, direction: "stable" };

  const percent = round2(((last - first) / first) * 100);
  return { percent, direction: trendFromPercent(percent) };
}

function parseRarity(rarityText = "") {
  const text = String(rarityText || "");
  for (const rule of RARITY_WEIGHTS) {
    if (rule.pattern.test(text)) return { score: rule.score, label: rule.label, raw: text || "Non renseignée" };
  }
  if (text) return { score: 50, label: "Rareté intermédiaire", raw: text };
  return { score: 40, label: "Rareté inconnue", raw: "Non renseignée" };
}

function getRecentSalesStats(cardId) {
  if (!cardId) return { recentCount: 0, velocityPerWeek: 0, last30Days: 0 };
  const db = getDb();
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const last30 = db.prepare(
    "SELECT COUNT(*) AS c FROM sales_history WHERE card_id = ? AND sold_at >= ?"
  ).get(cardId, since30)?.c ?? 0;

  const last7 = db.prepare(
    "SELECT COUNT(*) AS c FROM sales_history WHERE card_id = ? AND sold_at >= ?"
  ).get(cardId, since7)?.c ?? 0;

  const total = db.prepare("SELECT sales_count FROM cards WHERE id = ?").get(cardId)?.sales_count ?? 0;

  return {
    recentCount: last30,
    last7Days: last7,
    totalSales: total,
    velocityPerWeek: round2(last7 + last30 / 4)
  };
}

function computeDemandScore({ salesStats, popularity, trend7, trend30, liquidityTier, views }) {
  let score = 35;
  score += clamp(salesStats.recentCount * 4, 0, 28);
  score += clamp(salesStats.velocityPerWeek * 3, 0, 18);
  score += clamp((popularity - 50) * 0.25, -5, 12);
  score += trend7.percent > 0 ? clamp(trend7.percent * 0.4, 0, 8) : clamp(trend7.percent * 0.3, -10, 0);
  score += trend30.percent > 0 ? clamp(trend30.percent * 0.25, 0, 6) : clamp(trend30.percent * 0.2, -8, 0);
  if (liquidityTier === "high") score += 10;
  else if (liquidityTier === "low") score -= 12;
  score += clamp((views || 0) / 50, 0, 8);
  return clamp(Math.round(score), 0, 100);
}

function computeLiquidityTier({ demandScore, salesStats, resellPrice, trendDirection }) {
  let score = demandScore * 0.5 + salesStats.velocityPerWeek * 8 + salesStats.recentCount * 2;
  if (trendDirection === "up") score += 8;
  if (trendDirection === "down") score -= 10;
  if (resellPrice > 400) score -= 8;
  if (resellPrice > 1000) score -= 12;

  if (score >= 65) return { tier: "high", label: "Élevée", score: clamp(Math.round(score), 0, 100) };
  if (score >= 35) return { tier: "normal", label: "Normale", score: clamp(Math.round(score), 0, 100) };
  return { tier: "low", label: "Faible", score: clamp(Math.round(score), 0, 100) };
}

function computeCollectionLevel({ resellPrice, rarityScore, demandScore }) {
  const composite = resellPrice * 0.015 + rarityScore * 0.4 + demandScore * 0.25;
  if (composite >= 85 || resellPrice >= 500) return { level: "investment", label: "Investissement / Premium" };
  if (composite >= 60 || resellPrice >= 120) return { level: "collector", label: "Collectionneur" };
  if (composite >= 38) return { level: "intermediate", label: "Collection intermédiaire" };
  return { level: "casual", label: "Carte accessible" };
}

function computeRotationDays({ demandScore, liquidityScore, resellPrice, trendDirection }) {
  let days = 75 - demandScore * 0.45 - liquidityScore * 0.2;
  if (trendDirection === "up") days -= 8;
  if (trendDirection === "down") days += 18;
  if (resellPrice >= 300) days += 12;
  if (resellPrice >= 800) days += 25;
  days = clamp(Math.round(days), 5, 180);

  let label = "Lente (> 60 j)";
  if (days <= 14) label = "Rapide (< 15 j)";
  else if (days <= 30) label = "Modérée (15–30 j)";
  else if (days <= 60) label = "Standard (30–60 j)";

  return { days, label };
}

function computeMarketScore({ demandScore, rarityScore, popularity, liquidityScore, trend30, salesStats }) {
  const trendBonus = trend30.percent > 0 ? clamp(trend30.percent * 0.15, 0, 8) : clamp(trend30.percent * 0.12, -10, 0);
  const raw =
    demandScore * 0.32 +
    rarityScore * 0.18 +
    popularity * 0.12 +
    liquidityScore * 0.22 +
    clamp(salesStats.recentCount * 3, 0, 12) +
    trendBonus +
    8;

  return clamp(Math.round(raw), 0, 100);
}

function computeAdminRecommendation(ctx) {
  const {
    marketScore,
    demandScore,
    rarityScore,
    resellPrice,
    buyback,
    trendDirection,
    trend30,
    liquidityTier,
    rotationDays,
    suspicionAlert,
    conditionKey
  } = ctx;

  if (suspicionAlert) {
    return {
      primary: { type: "do_not_buy", label: "Ne pas acheter", detail: "Authenticité douteuse — vérification manuelle obligatoire" },
      resale: null,
      maxBuyPrice: null
    };
  }

  if (marketScore >= 85 && resellPrice >= 150 && rarityScore >= 72) {
    return {
      primary: { type: "premium", label: "Produit premium", detail: "Carte à forte valeur et forte demande — traitement premium recommandé" },
      resale: { type: "premium", label: "Produit premium", detail: "Mise en avant catalogue + marge optimisée" },
      maxBuyPrice: buyback
    };
  }

  if (resellPrice >= 400 && rarityScore >= 75) {
    return {
      primary: { type: "auction", label: "Vendre aux enchères", detail: "Valeur élevée et rareté — canal enchères privilégié" },
      resale: { type: "auction", label: "Vendre aux enchères", detail: "Rotation lente acceptable sur segment premium" },
      maxBuyPrice: buyback ? round2(buyback * 0.95) : null
    };
  }

  if (marketScore >= 76 && demandScore >= 62 && trendDirection !== "down") {
    return {
      primary: { type: "buy_now", label: "Acheter immédiatement", detail: "Forte liquidité et demande — opportunité de rachat prioritaire" },
      resale: rotationDays <= 21
        ? { type: "sell_fast", label: "Vendre rapidement", detail: "Rotation estimée " + rotationDays + " j — écouler sous 30 j" }
        : { type: "hold", label: "Conserver en stock", detail: "Demande soutenue — stockage court terme rentable" },
      maxBuyPrice: buyback
    };
  }

  if (trendDirection === "down" && marketScore >= 55) {
    return {
      primary: { type: "sell_fast", label: "Vendre rapidement", detail: "Tendance baissière — limiter l'exposition stock" },
      resale: { type: "sell_fast", label: "Vendre rapidement", detail: "Évolution 30 j : " + trend30.percent + " %" },
      maxBuyPrice: buyback ? round2(buyback * 0.88) : null
    };
  }

  if (marketScore >= 58 && trendDirection === "stable" && resellPrice >= 60) {
    return {
      primary: { type: "hold", label: "Conserver en stock", detail: "Marché stable — marge sécurisée sur rotation modérée" },
      resale: { type: "hold", label: "Conserver en stock", detail: "Rotation estimée : " + rotationDays + " j" },
      maxBuyPrice: buyback
    };
  }

  if (marketScore >= 50 && marketScore < 76) {
    return {
      primary: { type: "buy_caution", label: "Acheter avec prudence", detail: "Demande correcte — négocier selon l'état (" + conditionKey + ")" },
      resale: liquidityTier === "high"
        ? { type: "sell_fast", label: "Vendre rapidement", detail: "Liquidité correcte malgré score modéré" }
        : { type: "hold", label: "Conserver en stock", detail: "Attendre un pic de demande" },
      maxBuyPrice: buyback ? round2(buyback * 0.94) : null
    };
  }

  if (marketScore >= 35 && marketScore < 50) {
    const ceiling = buyback ? round2(buyback * 0.9) : round2(resellPrice * 0.55);
    return {
      primary: { type: "buy_below", label: "Acheter uniquement sous un certain prix", detail: "Marché tiède — plafond rachat strict" },
      resale: { type: "hold", label: "Conserver en stock", detail: "Ne pas forcer la revente immédiate" },
      maxBuyPrice: ceiling
    };
  }

  return {
    primary: { type: "do_not_buy", label: "Ne pas acheter", detail: "Score marché faible ou risque de rotation trop long" },
    resale: marketScore < 25 ? { type: "sell_fast", label: "Vendre rapidement", detail: "Si déjà en stock, sortie prioritaire" } : null,
    maxBuyPrice: null
  };
}

/**
 * Calcule l'indice de marché complet pour une carte.
 */
export function computeMarketIndex({
  card = null,
  detection = {},
  cardId = null,
  resellPrice = 0,
  marketTrend = "stable",
  trendPercent = 0,
  suspicionAlert = false,
  conditionKey = "near_mint"
}) {
  const resolvedId = cardId || card?.id || null;
  const marketStats = resolvedId ? getCardMarketStats(resolvedId) : null;
  const rarity = parseRarity(card?.rarity || detection?.rarity || "");
  const license = card?.license || detection?.license || "autre";
  const popularity = LICENSE_POPULARITY[license] ?? 50;

  const evolution7 = marketStats?.evolution?.days7 != null
    ? { percent: marketStats.evolution.days7, direction: trendFromPercent(marketStats.evolution.days7) }
    : computePeriodEvolution(resolvedId, 7);
  const evolution30 = marketStats?.evolution?.days30 != null
    ? { percent: marketStats.evolution.days30, direction: trendFromPercent(marketStats.evolution.days30) }
    : computePeriodEvolution(resolvedId, 30);
  const evolution90 = marketStats?.evolution?.days90 != null
    ? { percent: marketStats.evolution.days90, direction: trendFromPercent(marketStats.evolution.days90) }
    : computePeriodEvolution(resolvedId, 90);

  const trendDirection = evolution30.direction !== "stable"
    ? evolution30.direction
    : (marketTrend !== "unknown" ? marketTrend : trendFromPercent(trendPercent));

  const salesStats = getRecentSalesStats(resolvedId);
  const provisionalLiquidity = computeLiquidityTier({
    demandScore: 50,
    salesStats,
    resellPrice,
    trendDirection
  });

  const demandScore = marketStats?.indices?.demand != null
    ? Math.round((computeDemandScore({
        salesStats,
        popularity,
        trend7: evolution7,
        trend30: evolution30,
        liquidityTier: provisionalLiquidity.tier,
        views: card?.views || 0
      }) + marketStats.indices.demand) / 2)
    : computeDemandScore({
        salesStats,
        popularity,
        trend7: evolution7,
        trend30: evolution30,
        liquidityTier: provisionalLiquidity.tier,
        views: card?.views || 0
      });

  const liquidity = computeLiquidityTier({
    demandScore,
    salesStats,
    resellPrice,
    trendDirection
  });
  if (marketStats?.indices?.liquidity != null) {
    liquidity.score = Math.round((liquidity.score + marketStats.indices.liquidity) / 2);
    if (liquidity.score >= 65) { liquidity.tier = "high"; liquidity.label = "Élevée"; }
    else if (liquidity.score >= 35) { liquidity.tier = "normal"; liquidity.label = "Normale"; }
    else { liquidity.tier = "low"; liquidity.label = "Faible"; }
  }

  const collection = computeCollectionLevel({
    resellPrice,
    rarityScore: rarity.score,
    demandScore
  });

  const rotation = computeRotationDays({
    demandScore,
    liquidityScore: liquidity.score,
    resellPrice,
    trendDirection
  });

  const marketScore = computeMarketScore({
    demandScore,
    rarityScore: rarity.score,
    popularity,
    liquidityScore: liquidity.score,
    trend30: evolution30,
    salesStats
  });

  return {
    cardoriaMarketScore: marketScore,
    demand: demandScore,
    rarity: {
      score: marketStats?.indices?.rarity != null
        ? Math.round((rarity.score + marketStats.indices.rarity) / 2)
        : rarity.score,
      label: rarity.label,
      raw: rarity.raw
    },
    salesVelocity: {
      perWeek: salesStats.velocityPerWeek,
      label: salesStats.velocityPerWeek >= 4 ? "Rapide" : salesStats.velocityPerWeek >= 1.5 ? "Modérée" : "Lente"
    },
    recentSalesCount: salesStats.recentCount,
    evolution: {
      days7: evolution7,
      days30: evolution30,
      days90: evolution90
    },
    trend: { direction: trendDirection, label: trendLabel(trendDirection) },
    liquidity: { tier: liquidity.tier, label: liquidity.label, score: liquidity.score },
    collectionLevel: collection,
    popularity: { score: popularity, license },
    rotation: rotation,
    computedAt: new Date().toISOString(),
    marketData: marketStats ? {
      avgPrice: marketStats.avgPrice,
      medianPrice: marketStats.medianPrice,
      volume: marketStats.volume,
      buybackAvg: marketStats.buybackAvg
    } : null
  };
}

/** Ajuste marge, rachat et revente selon le Cardoria Market Score */
export function applyMarketScoreToPricing(pricing, marketIndex) {
  if (!marketIndex || !pricing) return pricing;

  const score = marketIndex.cardoriaMarketScore ?? 50;
  const scoreNorm = (score - 50) / 50;
  const trend = marketIndex.trend?.direction || "stable";
  const liquidityTier = marketIndex.liquidity?.tier || "normal";

  let marginRate = (pricing.targetMarginRate ?? 22) / 100;
  marginRate -= scoreNorm * 0.06;
  if (liquidityTier === "high") marginRate -= 0.02;
  if (liquidityTier === "low") marginRate += 0.05;
  if (trend === "up") marginRate -= 0.015;
  if (trend === "down") marginRate += 0.025;
  marginRate = clamp(marginRate, 0.08, 0.42);

  let resell = pricing.resell || 0;
  if (score >= 72 && trend === "up") resell = round2(resell * 1.04);
  else if (score >= 60 && trend !== "down") resell = round2(resell * 1.02);
  else if (score < 35) resell = round2(resell * 0.96);

  let buyback = pricing.buyback;
  let margin = pricing.margin;
  let marginPercent = pricing.marginPercent;

  if (buyback != null && resell > 0 && pricing.buybackStatus === "ok") {
    const buybackFactor = pricing._buybackFactor ?? 1;
    buyback = round2(resell * (1 - marginRate) * buybackFactor);
    buyback = Math.min(buyback, round2(resell - 0.5));
    margin = round2(resell - buyback);
    marginPercent = resell > 0 ? round2((margin / resell) * 100) : null;
  }

  return {
    ...pricing,
    resell,
    buyback,
    margin,
    marginPercent,
    targetMarginRate: round2(marginRate * 100),
    estimatedRotationDays: marketIndex.rotation?.days,
    estimatedRotationLabel: marketIndex.rotation?.label,
    marketScoreApplied: score
  };
}

export function enrichPricingWithMarketIndex(pricing, marketIndex, ctx = {}) {
  const recommendation = computeAdminRecommendation({
    marketScore: marketIndex.cardoriaMarketScore,
    demandScore: marketIndex.demand,
    rarityScore: marketIndex.rarity?.score,
    resellPrice: pricing.resell,
    buyback: pricing.buyback,
    trendDirection: marketIndex.trend?.direction,
    trend30: marketIndex.evolution?.days30 || { percent: 0 },
    liquidityTier: marketIndex.liquidity?.tier,
    rotationDays: marketIndex.rotation?.days,
    suspicionAlert: ctx.suspicionAlert,
    conditionKey: ctx.conditionKey
  });

  return {
    ...pricing,
    marketIndex,
    adminRecommendation: recommendation
  };
}
