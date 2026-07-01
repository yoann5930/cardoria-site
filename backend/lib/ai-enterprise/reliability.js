/**
 * Score de fiabilité 0–100 — précision, reconnaissance, marché, cohérence, risque.
 */
import { getDb } from "../engine/database.js";

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Number(n) || 0));
}

function dataVolumeBonus(count) {
  if (count >= 200) return 18;
  if (count >= 100) return 14;
  if (count >= 50) return 10;
  if (count >= 20) return 6;
  if (count >= 5) return 3;
  return 0;
}

export function computeReliabilityForCard(cardId, { persist = true } = {}) {
  if (!cardId) return defaultReliability(null);

  const db = getDb();
  const history = db.prepare(`
    SELECT price_sell_advised, price_actual_sell, confidence_score, sale_delay_days
    FROM ai_enterprise_history WHERE card_id = ? ORDER BY created_at DESC LIMIT 200
  `).all(cardId);

  const sales = history.filter((h) => h.price_actual_sell > 0 && h.price_sell_advised > 0);
  const sampleCount = history.length;

  let precisionScore = 50;
  if (sales.length > 0) {
    const errors = sales.map((s) => Math.abs(s.price_actual_sell - s.price_sell_advised) / s.price_sell_advised);
    const mape = errors.reduce((a, b) => a + b, 0) / errors.length;
    precisionScore = clamp(100 - mape * 120);
  }

  const confScores = history.map((h) => h.confidence_score).filter((c) => c != null);
  const recognitionScore = confScores.length
    ? clamp(confScores.reduce((a, b) => a + b, 0) / confScores.length)
    : 50;

  const marketRow = db.prepare(`
    SELECT evolution_30d, volume, avg_price FROM market_card_stats WHERE card_id = ?
  `).get(cardId);
  const trend = marketRow?.evolution_30d ?? 0;
  const marketEvolutionScore = clamp(50 + trend * 2);

  let salesCoherenceScore = 50;
  if (sales.length >= 2) {
    const prices = sales.map((s) => s.price_actual_sell);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((a, p) => a + Math.pow(p - mean, 2), 0) / prices.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    salesCoherenceScore = clamp(100 - cv * 80);
  }

  const delays = sales.map((s) => s.sale_delay_days).filter((d) => d != null && d >= 0);
  const avgDelay = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 45;
  const riskScore = clamp(100 - avgDelay * 0.4 - ((marketRow?.volume ?? 0) < 3 ? 15 : 0));

  const base =
    precisionScore * 0.3 +
    recognitionScore * 0.2 +
    marketEvolutionScore * 0.2 +
    salesCoherenceScore * 0.15 +
    riskScore * 0.15;

  const score = clamp(Math.round(base + dataVolumeBonus(sampleCount)));

  const result = {
    entityKey: cardId,
    entityType: "card",
    score,
    precisionScore: Math.round(precisionScore),
    recognitionScore: Math.round(recognitionScore),
    marketEvolutionScore: Math.round(marketEvolutionScore),
    salesCoherenceScore: Math.round(salesCoherenceScore),
    riskScore: Math.round(riskScore),
    sampleCount,
    computedAt: new Date().toISOString()
  };

  if (persist) {
    db.prepare(`
      INSERT INTO ai_enterprise_reliability (
        entity_key, entity_type, score, precision_score, recognition_score,
        market_evolution_score, sales_coherence_score, risk_score, sample_count, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_key) DO UPDATE SET
        score = excluded.score,
        precision_score = excluded.precision_score,
        recognition_score = excluded.recognition_score,
        market_evolution_score = excluded.market_evolution_score,
        sales_coherence_score = excluded.sales_coherence_score,
        risk_score = excluded.risk_score,
        sample_count = excluded.sample_count,
        computed_at = excluded.computed_at
    `).run(
      cardId, "card", result.score, result.precisionScore, result.recognitionScore,
      result.marketEvolutionScore, result.salesCoherenceScore, result.riskScore,
      sampleCount, result.computedAt
    );
  }

  return result;
}

export function computeReliabilityForLicense(licenseSlug) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT reliability_score, confidence_score FROM ai_enterprise_history
    WHERE license_slug = ? AND created_at >= datetime('now', '-90 days')
  `).all(licenseSlug || "");

  if (!rows.length) return defaultReliability(licenseSlug);

  const rel = rows.map((r) => r.reliability_score).filter(Boolean);
  const conf = rows.map((r) => r.confidence_score).filter(Boolean);
  const score = clamp(
    (rel.length ? rel.reduce((a, b) => a + b, 0) / rel.length : 50) * 0.6 +
    (conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : 50) * 0.4 +
    dataVolumeBonus(rows.length)
  );

  const result = {
    entityKey: `license:${licenseSlug}`,
    entityType: "license",
    score: Math.round(score),
    sampleCount: rows.length,
    computedAt: new Date().toISOString()
  };

  db.prepare(`
    INSERT INTO ai_enterprise_reliability (entity_key, entity_type, score, sample_count, computed_at)
    VALUES (?, 'license', ?, ?, ?)
    ON CONFLICT(entity_key) DO UPDATE SET score = excluded.score, sample_count = excluded.sample_count, computed_at = excluded.computed_at
  `).run(result.entityKey, result.score, rows.length, result.computedAt);

  return result;
}

function defaultReliability(key) {
  return {
    entityKey: key,
    entityType: "card",
    score: 42,
    precisionScore: 42,
    recognitionScore: 42,
    marketEvolutionScore: 50,
    salesCoherenceScore: 42,
    riskScore: 50,
    sampleCount: 0,
    computedAt: new Date().toISOString()
  };
}

export function getReliability(entityKey) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM ai_enterprise_reliability WHERE entity_key = ?").get(entityKey);
  if (!row) return null;
  return {
    entityKey: row.entity_key,
    entityType: row.entity_type,
    score: row.score,
    precisionScore: row.precision_score,
    recognitionScore: row.recognition_score,
    marketEvolutionScore: row.market_evolution_score,
    salesCoherenceScore: row.sales_coherence_score,
    riskScore: row.risk_score,
    sampleCount: row.sample_count,
    computedAt: row.computed_at
  };
}

export function refreshAllReliabilityScores(limit = 500) {
  const db = getDb();
  const cards = db.prepare(`
    SELECT DISTINCT card_id FROM ai_enterprise_history WHERE card_id IS NOT NULL LIMIT ?
  `).all(limit);
  cards.forEach(({ card_id }) => computeReliabilityForCard(card_id));

  const licenses = db.prepare(`
    SELECT DISTINCT license_slug FROM ai_enterprise_history WHERE license_slug != '' LIMIT 50
  `).all();
  licenses.forEach(({ license_slug }) => computeReliabilityForLicense(license_slug));
}
