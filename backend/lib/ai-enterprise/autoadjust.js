/**
 * Ajustement automatique mini / moyen / premium / marge / indice marché après vente réelle.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";
import { computeReliabilityForCard } from "./reliability.js";

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function applyAutoAdjustmentFromSale({ cardId, advisedPrice, actualPrice, fingerprint = "" }) {
  if (!cardId || !actualPrice || actualPrice <= 0) return null;

  const db = getDb();
  const advised = Number(advisedPrice) || actualPrice;
  const deltaPercent = advised > 0 ? ((actualPrice - advised) / advised) * 100 : 0;
  const factor = clamp(1 + deltaPercent / 200, 0.85, 1.15);

  const card = getCardById(cardId);
  const stats = db.prepare("SELECT * FROM market_card_stats WHERE card_id = ?").get(cardId);

  const currentMin = stats?.min_price ?? card?.low_price ?? actualPrice * 0.85;
  const currentAvg = stats?.avg_price ?? card?.avg_price ?? actualPrice;
  const currentMax = stats?.max_price ?? card?.high_price ?? actualPrice * 1.15;

  const newMin = round2(currentMin * factor);
  const newAvg = round2(currentAvg * factor);
  const newMax = round2(currentMax * factor);
  const marginAdjust = clamp(0.12 + deltaPercent / 500, 0.08, 0.22);
  const marketIndexDelta = clamp(deltaPercent / 10, -5, 5);

  const adjustments = {
    priceMin: newMin,
    priceAvg: newAvg,
    pricePremium: newMax,
    marginRate: marginAdjust,
    marketIndexDelta
  };

  if (stats) {
    db.prepare(`
      UPDATE market_card_stats SET
        min_price = ?, avg_price = ?, max_price = ?,
        evolution_30d = COALESCE(evolution_30d, 0) + ?,
        computed_at = ?
      WHERE card_id = ?
    `).run(newMin, newAvg, newMax, marketIndexDelta, new Date().toISOString(), cardId);
  } else {
    db.prepare(`
      INSERT INTO market_card_stats (
        card_id, min_price, avg_price, max_price, evolution_30d, volume, computed_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(cardId, newMin, newAvg, newMax, marketIndexDelta, new Date().toISOString());
  }

  if (card) {
    try {
      db.prepare(`
        UPDATE cards SET low_price = ?, avg_price = ?, high_price = ?,
          recommended_price = ?, trend_percent = COALESCE(trend_percent, 0) + ?, updated_at = ?
        WHERE id = ?
      `).run(newMin, newAvg, newMax, newAvg, marketIndexDelta, new Date().toISOString(), cardId);
    } catch {
      /* ignore */
    }
  }

  db.prepare(`
    INSERT INTO ai_enterprise_adjustments (
      card_id, fingerprint, trigger_type, advised_price, actual_price, delta_percent, adjustments_json, created_at
    ) VALUES (?, ?, 'sale', ?, ?, ?, ?, ?)
  `).run(
    cardId, fingerprint, round2(advised), round2(actualPrice), round2(deltaPercent),
    JSON.stringify(adjustments), new Date().toISOString()
  );

  computeReliabilityForCard(cardId);
  return { deltaPercent: round2(deltaPercent), adjustments };
}

export function processPendingSaleAdjustments(limit = 50) {
  const db = getDb();
  const sales = db.prepare(`
    SELECT card_id, sale_price, source_ref, created_at
    FROM market_transactions
    WHERE card_id IS NOT NULL AND sale_price > 0
      AND transaction_type IN ('sale','listing_sale','admin_sale','boutique_sale')
      AND created_at >= datetime('now', '-7 days')
    ORDER BY created_at DESC LIMIT ?
  `).all(limit);

  const seen = new Set();
  let count = 0;
  for (const s of sales) {
    const key = `${s.card_id}:${s.created_at}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const already = db.prepare(`
      SELECT id FROM ai_enterprise_adjustments
      WHERE card_id = ? AND created_at >= datetime(?, '-1 minute')
    `).get(s.card_id, s.created_at);
    if (already) continue;

    const hist = db.prepare(`
      SELECT price_sell_advised FROM ai_enterprise_history
      WHERE card_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(s.card_id);

    applyAutoAdjustmentFromSale({
      cardId: s.card_id,
      advisedPrice: hist?.price_sell_advised ?? s.sale_price,
      actualPrice: s.sale_price,
      fingerprint: s.source_ref || ""
    });
    count++;
  }
  return count;
}
