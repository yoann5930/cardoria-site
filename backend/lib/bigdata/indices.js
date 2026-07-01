/**
 * Indices Cardoria Big Data — demande, vendeur, acheteur, spéculation, collection, investissement.
 * + popularité, vitesse vente, rareté réelle.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Number(n) || 0));
}

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

export function computeCardMetrics(cardId) {
  if (!cardId) return null;
  const db = getDb();
  const records = db.prepare(`
    SELECT * FROM bigdata_records WHERE card_id = ? ORDER BY recorded_at DESC LIMIT 200
  `).all(cardId);

  const card = getCardById(cardId);
  const market = db.prepare("SELECT * FROM market_card_stats WHERE card_id = ?").get(cardId);
  const sample = records.length;

  const popularity = clamp(
    40 + sample * 1.2 + (card?.views || 0) * 0.05 + (market?.sales_count || 0) * 2,
    0, 100
  );

  const saleDelays = db.prepare(`
    SELECT sale_delay_days FROM ai_enterprise_history
    WHERE card_id = ? AND sale_delay_days IS NOT NULL AND sale_delay_days >= 0
  `).all(cardId).map((r) => r.sale_delay_days);

  const saleVelocity = saleDelays.length
    ? round1(saleDelays.reduce((a, b) => a + b, 0) / saleDelays.length)
    : null;

  const rarityCounts = db.prepare(`
    SELECT COUNT(DISTINCT card_id) AS cards, COUNT(*) AS estimates
    FROM bigdata_records WHERE license_slug = ?
  `).get(card?.license || records[0]?.license_slug || "");

  const realRarity = clamp(
    100 - (rarityCounts?.cards || 100) * 0.05 + (sample < 5 ? 15 : 0) +
    (/secret|ultra|ghost|manga/i.test(card?.rarity || "") ? 20 : 0),
    5, 99
  );

  const trend = market?.trend_percent ?? card?.trendPercent ?? 0;
  const avgPrice = market?.avg_price ?? card?.avgPrice ?? 0;
  const volume = market?.volume ?? market?.sales_count ?? sample;

  const demandIndex = clamp(50 + trend * 1.5 + sample * 0.3 + volume * 0.5);
  const sellerIndex = clamp(50 + trend * 0.8 - (saleVelocity || 30) * 0.2 + volume * 0.4);
  const buyerIndex = clamp(50 - trend * 0.3 + (100 - (saleVelocity || 45)) * 0.15);
  const speculationIndex = clamp(50 + Math.abs(trend) * 1.2 + (avgPrice > 100 ? 8 : 0));
  const collectionIndex = clamp(50 + realRarity * 0.35 + popularity * 0.2);
  const investmentIndex = clamp(
    demandIndex * 0.35 + speculationIndex * 0.25 + collectionIndex * 0.2 +
    (100 - (saleVelocity || 40)) * 0.2
  );

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO bigdata_card_metrics (
      card_id, popularity_score, sale_velocity_days, real_rarity_score,
      demand_index, seller_index, buyer_index, speculation_index, collection_index,
      investment_index, estimation_count, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      popularity_score = excluded.popularity_score,
      sale_velocity_days = excluded.sale_velocity_days,
      real_rarity_score = excluded.real_rarity_score,
      demand_index = excluded.demand_index,
      seller_index = excluded.seller_index,
      buyer_index = excluded.buyer_index,
      speculation_index = excluded.speculation_index,
      collection_index = excluded.collection_index,
      investment_index = excluded.investment_index,
      estimation_count = excluded.estimation_count,
      computed_at = excluded.computed_at
  `).run(
    cardId, round1(popularity), saleVelocity, round1(realRarity),
    round1(demandIndex), round1(sellerIndex), round1(buyerIndex),
    round1(speculationIndex), round1(collectionIndex), round1(investmentIndex),
    sample, now
  );

  return {
    cardId,
    popularity: round1(popularity),
    saleVelocityDays: saleVelocity,
    realRarity: round1(realRarity),
    indices: {
      demand: round1(demandIndex),
      seller: round1(sellerIndex),
      buyer: round1(buyerIndex),
      speculation: round1(speculationIndex),
      collection: round1(collectionIndex),
      investment: round1(investmentIndex)
    },
    estimationCount: sample,
    computedAt: now
  };
}

export function refreshAllCardMetrics(limit = 400) {
  const ids = getDb().prepare(`
    SELECT DISTINCT card_id FROM bigdata_records WHERE card_id != '' LIMIT ?
  `).all(limit).map((r) => r.card_id);
  return ids.map((id) => computeCardMetrics(id)).filter(Boolean);
}

export function getCardMetrics(cardId) {
  const row = getDb().prepare("SELECT * FROM bigdata_card_metrics WHERE card_id = ?").get(cardId);
  if (!row) return computeCardMetrics(cardId);
  return {
    cardId,
    popularity: row.popularity_score,
    saleVelocityDays: row.sale_velocity_days,
    realRarity: row.real_rarity_score,
    indices: {
      demand: row.demand_index,
      seller: row.seller_index,
      buyer: row.buyer_index,
      speculation: row.speculation_index,
      collection: row.collection_index,
      investment: row.investment_index
    },
    estimationCount: row.estimation_count,
    computedAt: row.computed_at
  };
}

export function getGlobalIndicesSummary() {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      AVG(demand_index) AS demand, AVG(seller_index) AS seller, AVG(buyer_index) AS buyer,
      AVG(speculation_index) AS speculation, AVG(collection_index) AS collection,
      AVG(investment_index) AS investment, AVG(popularity_score) AS popularity,
      AVG(real_rarity_score) AS realRarity, AVG(sale_velocity_days) AS saleVelocity
    FROM bigdata_card_metrics
  `).get();

  return {
    demand: round1(row?.demand ?? 50),
    seller: round1(row?.seller ?? 50),
    buyer: round1(row?.buyer ?? 50),
    speculation: round1(row?.speculation ?? 50),
    collection: round1(row?.collection ?? 50),
    investment: round1(row?.investment ?? 50),
    popularity: round1(row?.popularity ?? 50),
    realRarity: round1(row?.realRarity ?? 50),
    saleVelocityDays: row?.saleVelocity != null ? round1(row.saleVelocity) : null
  };
}
