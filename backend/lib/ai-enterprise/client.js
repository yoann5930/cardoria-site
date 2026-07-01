/**
 * Payload client-safe — aucune donnée interne admin.
 */
import { getPredictions } from "./predict.js";
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function buildEnterpriseClientView({ cardId, intelligence, pricing, detection }) {
  const db = getDb();
  const stats = cardId ? db.prepare("SELECT avg_price, evolution_30d FROM market_card_stats WHERE card_id = ?").get(cardId) : null;
  const card = cardId ? getCardById(cardId) : null;

  const recommendedPrice = round2(
    pricing?.resell ?? pricing?.recommended ?? intelligence?.pricing?.optimalSale ?? stats?.avg_price ?? 0
  );
  const marketIndex = round2(
    intelligence?.indices?.marketScore ??
    intelligence?.marketIndex?.cardoriaMarketScore ??
    50 + (stats?.evolution_30d ?? card?.trend_percent ?? 0)
  );

  const evolution = buildEvolutionChart(cardId);
  const predictions = cardId ? getPredictions(cardId) : buildGenericPredictions(recommendedPrice);

  return {
    estimation: {
      recommendedPrice,
      buybackPrice: round2(pricing?.buyback ?? intelligence?.pricing?.professionalBuy),
      marketAverage: round2(pricing?.avg ?? pricing?.market?.avg ?? stats?.avg_price),
      currency: "EUR"
    },
    marketIndex: {
      score: marketIndex,
      label: marketIndexLabel(marketIndex),
      trendPercent: round2(stats?.evolution_30d ?? card?.trend_percent ?? 0)
    },
    evolution: {
      labels: evolution.labels,
      values: evolution.values,
      direction: evolution.direction
    },
    forecast: {
      currentPrice: predictions.currentPrice ?? recommendedPrice,
      horizons: (predictions.forecasts || []).map((f) => ({
        label: f.horizon,
        price: f.price,
        confidencePercent: f.confidencePercent
      }))
    },
    card: detection ? {
      name: detection.name || card?.name,
      license: detection.license,
      extension: detection.extension,
      number: detection.number
    } : undefined
  };
}

function marketIndexLabel(score) {
  if (score >= 75) return "Marché dynamique";
  if (score >= 55) return "Marché stable";
  if (score >= 40) return "Marché calme";
  return "Marché faible";
}

function buildEvolutionChart(cardId) {
  if (!cardId) {
    return { labels: [], values: [], direction: "stable" };
  }

  const db = getDb();
  const rows = db.prepare(`
    SELECT strftime('%d/%m', created_at) AS label, price_market, price_sell_advised, created_at
    FROM ai_enterprise_history WHERE card_id = ? AND (price_market > 0 OR price_sell_advised > 0)
    ORDER BY created_at ASC LIMIT 20
  `).all(cardId);

  const labels = rows.map((r) => r.label);
  const values = rows.map((r) => round2(r.price_sell_advised || r.price_market));

  let direction = "stable";
  if (values.length >= 2) {
    const delta = values[values.length - 1] - values[0];
    if (delta > values[0] * 0.05) direction = "up";
    else if (delta < -values[0] * 0.05) direction = "down";
  }

  return { labels, values, direction };
}

function buildGenericPredictions(basePrice) {
  const p = Number(basePrice) || 10;
  return {
    currentPrice: p,
    forecasts: [
      { horizon: "7 jours", price: round2(p * 1.01), confidencePercent: 35 },
      { horizon: "30 jours", price: round2(p * 1.02), confidencePercent: 32 },
      { horizon: "90 jours", price: round2(p * 1.04), confidencePercent: 28 },
      { horizon: "180 jours", price: round2(p * 1.05), confidencePercent: 25 },
      { horizon: "1 an", price: round2(p * 1.08), confidencePercent: 22 }
    ]
  };
}

export function getEnterpriseClientByCardId(cardId) {
  const db = getDb();
  const last = db.prepare(`
    SELECT * FROM ai_enterprise_history WHERE card_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(cardId);

  const card = getCardById(cardId);
  const metadata = last ? JSON.parse(last.metadata_json || "{}") : {};

  return buildEnterpriseClientView({
    cardId,
    detection: {
      name: card?.name,
      license: last?.license_slug,
      extension: last?.extension,
      number: last?.card_number
    },
    pricing: {
      resell: last?.price_sell_advised,
      buyback: last?.price_buy_advised,
      avg: last?.price_market
    },
    intelligence: { indices: { marketScore: last?.cardoria_trend_score }, ...metadata }
  });
}
