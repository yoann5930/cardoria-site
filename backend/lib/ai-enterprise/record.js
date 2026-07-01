/**
 * Historique complet des estimations — alimente l'apprentissage Enterprise.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";
import { makeEnterpriseHistoryId } from "./migrate.js";
import { computeReliabilityForCard } from "./reliability.js";
import { applyAutoAdjustmentFromSale } from "./autoadjust.js";
import { scheduleEnterpriseWorker } from "./worker.js";

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function gatherEngagement(cardId) {
  if (!cardId) return { views: 0, favorites: 0, offers: 0, purchases: 0 };
  try {
    const db = getDb();
    const card = getCardById(cardId);
    const views = card?.views || 0;
    const favorites = db.prepare(`
      SELECT COUNT(*) AS c FROM mk_favorites f
      JOIN mk_listings l ON l.id = f.listing_id WHERE l.card_id = ?
    `).get(cardId)?.c ?? 0;
    const offers = db.prepare(`
      SELECT COUNT(*) AS c FROM market_transactions
      WHERE card_id = ? AND transaction_type IN ('listing_sale','sale','admin_sale')
    `).get(cardId)?.c ?? 0;
    const purchases = db.prepare(`
      SELECT COUNT(*) AS c FROM market_transactions WHERE card_id = ?
    `).get(cardId)?.c ?? 0;
    return { views, favorites, offers, purchases };
  } catch {
    return { views: 0, favorites: 0, offers: 0, purchases: 0 };
  }
}

export function recordEnterpriseEstimation(ctx = {}) {
  const {
    analysisId,
    scanId,
    cardId,
    detection = {},
    conditionGrade,
    pricing = {},
    intelligence = {},
    confidenceScore,
    source = "estimation"
  } = ctx;

  const db = getDb();
  const id = makeEnterpriseHistoryId();
  const now = new Date().toISOString();
  const engagement = gatherEngagement(cardId);
  const market = pricing.market || pricing;
  const reliability = cardId ? computeReliabilityForCard(cardId, { persist: false }) : null;

  db.prepare(`
    INSERT INTO ai_enterprise_history (
      id, analysis_id, scan_id, card_id, created_at, license_slug, extension, card_number,
      language, condition_grade, price_market, price_buy_advised, price_sell_advised,
      price_actual_sell, sale_delay_days, views_count, favorites_count, offers_count,
      purchases_count, confidence_score, reliability_score, cardoria_trend_score, source, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    analysisId || null,
    scanId || null,
    cardId || null,
    now,
    detection.license || "",
    detection.extension || "",
    detection.number || "",
    detection.language || "",
    conditionGrade || "",
    round2(market.avg ?? pricing.avg ?? intelligence?.pricing?.marketAverage),
    round2(pricing.buyback ?? intelligence?.pricing?.professionalBuy),
    round2(pricing.resell ?? intelligence?.pricing?.optimalSale ?? pricing.recommended),
    null,
    null,
    engagement.views,
    engagement.favorites,
    engagement.offers,
    engagement.purchases,
    confidenceScore ?? null,
    reliability?.score ?? null,
    intelligence?.indices?.marketScore ?? intelligence?.marketIndex?.cardoriaMarketScore ?? null,
    source,
    JSON.stringify({ detection, cardoriaScore: intelligence?.scores?.overall })
  );

  scheduleEnterpriseWorker("estimation");
  return { id, reliability };
}

export function recordActualSaleOutcome({ cardId, analysisId, actualSell, saleDelayDays, advisedSell }) {
  const db = getDb();
  const row = analysisId
    ? db.prepare(`
        SELECT id, price_sell_advised FROM ai_enterprise_history WHERE analysis_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(analysisId)
    : db.prepare(`
        SELECT id, price_sell_advised FROM ai_enterprise_history WHERE card_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(cardId);

  if (row) {
    db.prepare(`
      UPDATE ai_enterprise_history SET price_actual_sell = ?, sale_delay_days = COALESCE(?, sale_delay_days)
      WHERE id = ?
    `).run(round2(actualSell), saleDelayDays ?? null, row.id);
  }

  if (cardId && actualSell > 0) {
    applyAutoAdjustmentFromSale({
      cardId,
      advisedPrice: advisedSell ?? row?.price_sell_advised,
      actualPrice: actualSell
    });
  }

  scheduleEnterpriseWorker("sale");
}

export function recordActualSaleOutcomeSync(params) {
  try {
    recordActualSaleOutcome(params);
  } catch {
    scheduleEnterpriseWorker("sale");
  }
}

export function listEnterpriseHistory({ cardId, license, limit = 100 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM ai_enterprise_history WHERE 1=1";
  const params = [];
  if (cardId) { sql += " AND card_id = ?"; params.push(cardId); }
  if (license) { sql += " AND license_slug = ?"; params.push(license); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map(mapHistory);
}

function mapHistory(row) {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    scanId: row.scan_id,
    cardId: row.card_id,
    createdAt: row.created_at,
    license: row.license_slug,
    extension: row.extension,
    number: row.card_number,
    language: row.language,
    condition: row.condition_grade,
    priceMarket: row.price_market,
    priceBuyAdvised: row.price_buy_advised,
    priceSellAdvised: row.price_sell_advised,
    priceActualSell: row.price_actual_sell,
    saleDelayDays: row.sale_delay_days,
    views: row.views_count,
    favorites: row.favorites_count,
    offers: row.offers_count,
    purchases: row.purchases_count,
    confidenceScore: row.confidence_score,
    reliabilityScore: row.reliability_score,
    cardoriaTrendScore: row.cardoria_trend_score,
    source: row.source,
    metadata: JSON.parse(row.metadata_json || "{}")
  };
}

export { mapHistory };
