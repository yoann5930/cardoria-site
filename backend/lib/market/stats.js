/**
 * Statistiques automatiques par carte — alimente l'IA.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";
import { recordPriceSnapshot } from "../ai/history.js";
import { computeTrendForCard } from "../ai/trends.js";
import { computeIndicesFromStats } from "./indices.js";

const SALE_TYPES = ["sale", "listing_sale", "admin_sale", "boutique_sale"];
const BUYBACK_TYPES = ["buyback", "estimate_buyback", "admin_buyback"];

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function periodEvolution(rows, days) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const prevCutoff = new Date(Date.now() - days * 2 * 86400000).toISOString().slice(0, 10);

  const recent = rows.filter((r) => r.transaction_at >= cutoff).map((r) => r.sale_price).filter(Boolean);
  const older = rows.filter((r) => r.transaction_at >= prevCutoff && r.transaction_at < cutoff).map((r) => r.sale_price).filter(Boolean);

  if (!recent.length || !older.length) return 0;
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
  if (!avgOlder) return 0;
  return round2(((avgRecent - avgOlder) / avgOlder) * 100);
}

export function getCardMarketStats(cardId) {
  const row = getDb().prepare("SELECT * FROM market_card_stats WHERE card_id = ?").get(cardId);
  if (!row) return null;
  return toStats(row);
}

export function recomputeCardStats(cardId) {
  const db = getDb();
  const card = getCardById(cardId);
  if (!card) return null;

  const saleRows = db.prepare(`
    SELECT sale_price, buyback_price, transaction_at, days_to_sell, transaction_type
    FROM market_transactions
    WHERE card_id = ? AND sale_price IS NOT NULL AND sale_price > 0
    ORDER BY transaction_at ASC
  `).all(cardId);

  const buybackRows = db.prepare(`
    SELECT buyback_price, transaction_at FROM market_transactions
    WHERE card_id = ? AND buyback_price IS NOT NULL AND buyback_price > 0
    ORDER BY transaction_at DESC LIMIT 100
  `).all(cardId);

  const prices = saleRows.map((r) => Number(r.sale_price));
  const avg = prices.length ? round2(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const med = round2(median(prices));
  const min = prices.length ? round2(Math.min(...prices)) : 0;
  const max = prices.length ? round2(Math.max(...prices)) : 0;
  const volume = prices.length;

  const buybackPrices = buybackRows.map((r) => Number(r.buyback_price));
  const buybackAvg = buybackPrices.length
    ? round2(buybackPrices.reduce((a, b) => a + b, 0) / buybackPrices.length)
    : 0;

  const internalRows = db.prepare(`
    SELECT sale_price, buyback_price FROM market_transactions
    WHERE card_id = ? AND channel = 'Cardoria' AND transaction_at >= date('now', '-365 day')
  `).all(cardId);
  const internalVals = internalRows.flatMap((r) => [r.sale_price, r.buyback_price].filter((v) => v > 0));
  const internalAvg = internalVals.length
    ? round2(internalVals.reduce((a, b) => a + b, 0) / internalVals.length)
    : avg;

  const ev7 = periodEvolution(saleRows, 7);
  const ev30 = periodEvolution(saleRows, 30);
  const ev90 = periodEvolution(saleRows, 90);
  const ev365 = periodEvolution(saleRows, 365);

  const avgDaysToSell = (() => {
    const delays = saleRows.map((r) => r.days_to_sell).filter((d) => d != null && d >= 0);
    return delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null;
  })();

  const indices = computeIndicesFromStats({
    card,
    volume,
    avgPrice: avg || med,
    evolution30: ev30,
    evolution90: ev90,
    avgDaysToSell,
    buybackVolume: buybackPrices.length
  });

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO market_card_stats (
      card_id, avg_price, median_price, min_price, max_price, volume, buyback_avg, buyback_volume,
      internal_avg, evolution_7d, evolution_30d, evolution_90d, evolution_1y,
      liquidity_index, demand_index, rarity_index, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      avg_price = excluded.avg_price,
      median_price = excluded.median_price,
      min_price = excluded.min_price,
      max_price = excluded.max_price,
      volume = excluded.volume,
      buyback_avg = excluded.buyback_avg,
      buyback_volume = excluded.buyback_volume,
      internal_avg = excluded.internal_avg,
      evolution_7d = excluded.evolution_7d,
      evolution_30d = excluded.evolution_30d,
      evolution_90d = excluded.evolution_90d,
      evolution_1y = excluded.evolution_1y,
      liquidity_index = excluded.liquidity_index,
      demand_index = excluded.demand_index,
      rarity_index = excluded.rarity_index,
      computed_at = excluded.computed_at
  `).run(
    cardId, avg, med, min, max, volume, buybackAvg, buybackPrices.length,
    internalAvg, ev7, ev30, ev90, ev365,
    indices.liquidity, indices.demand, indices.rarity, now
  );

  if (avg > 0) {
    db.prepare(`
      UPDATE cards SET avg_price = ?, low_price = ?, high_price = ?, recommended_price = ?,
        market_trend = ?, trend_percent = ?, sales_count = ?, updated_at = ?
      WHERE id = ?
    `).run(
      avg,
      min || avg * 0.9,
      max || avg * 1.1,
      med || avg,
      ev30 > 4 ? "up" : ev30 < -4 ? "down" : "stable",
      ev30,
      volume,
      now,
      cardId
    );

    recordPriceSnapshot(cardId, {
      low: min || avg * 0.9,
      avg,
      high: max || avg * 1.1,
      recommended: med || avg
    }, "market_engine");

    computeTrendForCard(cardId, card.name, card.license);
  }

  return getCardMarketStats(cardId);
}

export function recomputeAllCardStats(limit = 5000) {
  const ids = getDb().prepare(`
    SELECT DISTINCT card_id FROM market_transactions WHERE card_id IS NOT NULL LIMIT ?
  `).all(limit).map((r) => r.card_id);

  let count = 0;
  ids.forEach((id) => {
    recomputeCardStats(id);
    count++;
  });
  return { recomputed: count };
}

export function getMarketDashboard() {
  const db = getDb();
  const txCount = db.prepare("SELECT COUNT(*) AS c FROM market_transactions").get()?.c ?? 0;
  const cardsTracked = db.prepare("SELECT COUNT(*) AS c FROM market_card_stats WHERE volume > 0").get()?.c ?? 0;
  const last7 = db.prepare(`
    SELECT COUNT(*) AS c FROM market_transactions WHERE transaction_at >= date('now', '-7 day')
  `).get()?.c ?? 0;
  const avgLiquidity = db.prepare(`
    SELECT AVG(liquidity_index) AS a FROM market_card_stats WHERE volume > 0
  `).get()?.a ?? 0;

  return {
    transactions: txCount,
    cardsTracked,
    transactionsLast7Days: last7,
    avgLiquidityIndex: round2(avgLiquidity)
  };
}

export function listRecentTransactions({ cardId, limit = 50 } = {}) {
  const db = getDb();
  let rows;
  if (cardId) {
    rows = db.prepare(`
      SELECT * FROM market_transactions WHERE card_id = ? ORDER BY transaction_at DESC LIMIT ?
    `).all(cardId, limit);
  } else {
    rows = db.prepare(`
      SELECT * FROM market_transactions ORDER BY transaction_at DESC LIMIT ?
    `).all(limit);
  }
  return rows.map(toTransaction);
}

function toStats(row) {
  return {
    cardId: row.card_id,
    avgPrice: row.avg_price,
    medianPrice: row.median_price,
    minPrice: row.min_price,
    maxPrice: row.max_price,
    volume: row.volume,
    buybackAvg: row.buyback_avg,
    buybackVolume: row.buyback_volume,
    internalAvg: row.internal_avg,
    evolution: {
      days7: row.evolution_7d,
      days30: row.evolution_30d,
      days90: row.evolution_90d,
      days1y: row.evolution_1y
    },
    indices: {
      liquidity: row.liquidity_index,
      demand: row.demand_index,
      rarity: row.rarity_index
    },
    computedAt: row.computed_at
  };
}

function toTransaction(row) {
  return {
    id: row.id,
    cardId: row.card_id,
    type: row.transaction_type,
    salePrice: row.sale_price,
    buybackPrice: row.buyback_price,
    currency: row.currency,
    transactionAt: row.transaction_at,
    condition: row.condition,
    language: row.language,
    license: row.license_slug,
    extension: row.extension,
    number: row.card_number,
    seller: row.seller,
    buyer: row.buyer,
    daysToSell: row.days_to_sell,
    channel: row.channel,
    sourceRef: row.source_ref,
    notes: row.notes,
    createdAt: row.created_at
  };
}

export { toStats, toTransaction };
