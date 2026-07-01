/**
 * Prédictions de prix 7 / 30 / 90 / 180 / 365 jours + confiance.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";

const HORIZONS = [
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
  { key: "90d", days: 90 },
  { key: "180d", days: 180 },
  { key: "365d", days: 365 }
];

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function computeTrendSlope(history) {
  if (history.length < 2) return 0;
  const recent = history.slice(0, Math.min(20, history.length));
  const oldest = recent[recent.length - 1];
  const newest = recent[0];
  const days = Math.max(1, (new Date(newest.created_at) - new Date(oldest.created_at)) / 86400000);
  const priceDelta = (newest.price_market || newest.price_sell_advised || 0) -
    (oldest.price_market || oldest.price_sell_advised || 0);
  return priceDelta / days;
}

export function computePredictionsForCard(cardId) {
  if (!cardId) return null;

  const db = getDb();
  const card = getCardById(cardId);
  const stats = db.prepare("SELECT * FROM market_card_stats WHERE card_id = ?").get(cardId);
  const history = db.prepare(`
    SELECT price_market, price_sell_advised, price_actual_sell, created_at, reliability_score
    FROM ai_enterprise_history WHERE card_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(cardId);

  const basePrice =
    stats?.avg_price ??
    history[0]?.price_sell_advised ??
    history[0]?.price_market ??
    card?.avg_price ??
    card?.low_price ??
    10;

  const slope = computeTrendSlope(history);
  const trendPct = stats?.evolution_30d ?? card?.trend_percent ?? 0;
  const sampleCount = history.length;
  const relRow = db.prepare("SELECT score FROM ai_enterprise_reliability WHERE entity_key = ?").get(cardId);
  const reliability = relRow?.score ?? 42;

  const predictions = {};
  for (const h of HORIZONS) {
    const trendFactor = 1 + (trendPct / 100) * (h.days / 90);
    const slopeFactor = 1 + (slope * h.days) / Math.max(basePrice, 1);
    const combined = (trendFactor + slopeFactor) / 2;
    const price = round2(basePrice * clamp(combined, 0.7, 1.5));

    const horizonPenalty = h.days <= 7 ? 0 : h.days <= 30 ? 3 : h.days <= 90 ? 8 : h.days <= 180 ? 14 : 22;
    const dataBonus = clamp(sampleCount * 0.4, 0, 20);
    const confidence = clamp(Math.round(reliability * 0.5 + 30 + dataBonus - horizonPenalty), 25, 95);

    predictions[`price_${h.key}`] = price;
    predictions[`conf_${h.key}`] = confidence;
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_enterprise_predictions (
      card_id, price_7d, conf_7d, price_30d, conf_30d, price_90d, conf_90d,
      price_180d, conf_180d, price_365d, conf_365d, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      price_7d = excluded.price_7d, conf_7d = excluded.conf_7d,
      price_30d = excluded.price_30d, conf_30d = excluded.conf_30d,
      price_90d = excluded.price_90d, conf_90d = excluded.conf_90d,
      price_180d = excluded.price_180d, conf_180d = excluded.conf_180d,
      price_365d = excluded.price_365d, conf_365d = excluded.conf_365d,
      computed_at = excluded.computed_at
  `).run(
    cardId,
    predictions.price_7d, predictions.conf_7d,
    predictions.price_30d, predictions.conf_30d,
    predictions.price_90d, predictions.conf_90d,
    predictions.price_180d, predictions.conf_180d,
    predictions.price_365d, predictions.conf_365d,
    now
  );

  return formatPredictions(cardId, predictions, now, basePrice);
}

function formatPredictions(cardId, p, computedAt, currentPrice) {
  return {
    cardId,
    currentPrice: round2(currentPrice),
    computedAt,
    forecasts: [
      { horizon: "7 jours", days: 7, price: p.price_7d, confidencePercent: p.conf_7d },
      { horizon: "30 jours", days: 30, price: p.price_30d, confidencePercent: p.conf_30d },
      { horizon: "90 jours", days: 90, price: p.price_90d, confidencePercent: p.conf_90d },
      { horizon: "180 jours", days: 180, price: p.price_180d, confidencePercent: p.conf_180d },
      { horizon: "1 an", days: 365, price: p.price_365d, confidencePercent: p.conf_365d }
    ]
  };
}

export function getPredictions(cardId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM ai_enterprise_predictions WHERE card_id = ?").get(cardId);
  if (!row) return computePredictionsForCard(cardId);

  const card = getCardById(cardId);
  const stats = db.prepare("SELECT avg_price FROM market_card_stats WHERE card_id = ?").get(cardId);
  const current = stats?.avg_price ?? card?.avg_price ?? row.price_30d;

  return formatPredictions(
    cardId,
    {
      price_7d: row.price_7d, conf_7d: row.conf_7d,
      price_30d: row.price_30d, conf_30d: row.conf_30d,
      price_90d: row.price_90d, conf_90d: row.conf_90d,
      price_180d: row.price_180d, conf_180d: row.conf_180d,
      price_365d: row.price_365d, conf_365d: row.conf_365d
    },
    row.computed_at,
    current
  );
}

export function refreshAllPredictions(limit = 300) {
  const db = getDb();
  const cards = db.prepare(`
    SELECT DISTINCT card_id FROM ai_enterprise_history WHERE card_id IS NOT NULL LIMIT ?
  `).all(limit);
  return cards.map(({ card_id }) => computePredictionsForCard(card_id)).filter(Boolean);
}
