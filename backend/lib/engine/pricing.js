/**
 * Moteur de prix Cardoria — agrégation multi-sources et tendances marché.
 */
import { getDb } from "./database.js";
import { ingestAdminManualSale } from "../market/ingest.js";

const SOURCE_WEIGHTS = {
  cardoria: 0.4,
  cardmarket: 0.35,
  tcgplayer: 0.25,
  ebay: 0.15,
  manual: 0.5
};

const CONDITION_MULTIPLIERS = {
  mint: 1.15,
  nm: 1.0,
  ex: 0.85,
  gd: 0.65,
  lp: 0.75,
  mp: 0.55,
  hp: 0.35,
  dmg: 0.2
};

export function getPriceSources(cardId) {
  return getDb().prepare(
    "SELECT source, price, currency, fetched_at AS fetchedAt FROM price_sources WHERE card_id = ? ORDER BY fetched_at DESC"
  ).all(cardId);
}

export function setPriceSources(cardId, sources) {
  const db = getDb();
  const now = new Date().toISOString();
  const del = db.prepare("DELETE FROM price_sources WHERE card_id = ? AND source = ?");
  const ins = db.prepare(`
    INSERT INTO price_sources (card_id, source, price, currency, weight, fetched_at)
    VALUES (?, ?, ?, 'EUR', ?, ?)
  `);
  (sources || []).forEach((s) => {
    if (!s.source || s.price == null) return;
    del.run(cardId, s.source);
    ins.run(cardId, s.source, Number(s.price), SOURCE_WEIGHTS[s.source] || 0.2, now);
  });
  return recalculateCardPrices(cardId);
}

export function recalculateCardPrices(cardId) {
  const db = getDb();
  const sources = db.prepare("SELECT source, price, weight FROM price_sources WHERE card_id = ?").all(cardId);

  let avg = 0, low = 0, high = 0, recommended = 0;

  if (sources.length) {
    const prices = sources.map((s) => s.price);
    avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    low = Math.min(...prices);
    high = Math.max(...prices);
    const totalWeight = sources.reduce((s, x) => s + (x.weight || SOURCE_WEIGHTS[x.source] || 0.2), 0);
    recommended = sources.reduce((s, x) => s + x.price * (x.weight || SOURCE_WEIGHTS[x.source] || 0.2), 0) / (totalWeight || 1);
  }

  const trend = computeMarketTrend(cardId, recommended || avg);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE cards SET avg_price = ?, low_price = ?, high_price = ?, recommended_price = ?,
      market_trend = ?, trend_percent = ?, updated_at = ?
    WHERE id = ?
  `).run(
    round2(avg), round2(low), round2(high), round2(recommended),
    trend.trend, trend.percent, now, cardId
  );

  return { avg: round2(avg), low: round2(low), high: round2(high), recommended: round2(recommended), ...trend };
}

function computeMarketTrend(cardId, currentPrice) {
  const db = getDb();
  const sales = db.prepare(
    "SELECT price, sold_at FROM sales_history WHERE card_id = ? ORDER BY sold_at DESC LIMIT 60"
  ).all(cardId);

  if (sales.length < 2 || !currentPrice) {
    return { trend: "stable", percent: 0 };
  }

  const mid = Math.floor(sales.length / 2);
  const recent = sales.slice(0, mid);
  const older = sales.slice(mid);
  const avgRecent = recent.reduce((s, x) => s + x.price, 0) / recent.length;
  const avgOlder = older.reduce((s, x) => s + x.price, 0) / older.length;
  const percent = avgOlder ? round2(((avgRecent - avgOlder) / avgOlder) * 100) : 0;

  let trend = "stable";
  if (percent > 5) trend = "up";
  else if (percent < -5) trend = "down";

  return { trend, percent };
}

export function estimatePrice(cardId, condition = "nm") {
  const db = getDb();
  const card = db.prepare("SELECT recommended_price, avg_price, low_price, high_price, market_trend, trend_percent FROM cards WHERE id = ?").get(cardId);
  if (!card) return null;

  const mult = CONDITION_MULTIPLIERS[normalizeCondition(condition)] ?? 1;
  const base = card.recommended_price || card.avg_price;
  const adjusted = round2(base * mult);

  const sources = getPriceSources(cardId);
  const variation = card.trend_percent || 0;

  return {
    cardId,
    condition: normalizeCondition(condition),
    conditionMultiplier: mult,
    recommended: adjusted,
    range: {
      low: round2((card.low_price || adjusted * 0.85) * mult),
      high: round2((card.high_price || adjusted * 1.15) * mult)
    },
    marketTrend: card.market_trend,
    trendPercent: card.trend_percent,
    variationAlert: Math.abs(variation) >= 10 ? (variation > 0 ? "hausse" : "baisse") : null,
    sources: sources.map((s) => ({ source: s.source, price: s.price })),
    computedAt: new Date().toISOString()
  };
}

export function addSaleRecord(cardId, { price, condition, channel, soldAt }) {
  ingestAdminManualSale(cardId, {
    type: "admin_sale",
    salePrice: price,
    condition,
    channel,
    transactionAt: soldAt
  });
  return getSalesHistory(cardId, 20);
}

export function getSalesHistory(cardId, limit = 50) {
  return getDb().prepare(
    "SELECT sold_at AS date, price, condition, channel FROM sales_history WHERE card_id = ? ORDER BY sold_at DESC LIMIT ?"
  ).all(cardId, limit);
}

function normalizeCondition(c) {
  return String(c || "nm").toLowerCase().replace(/\s+/g, "");
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
