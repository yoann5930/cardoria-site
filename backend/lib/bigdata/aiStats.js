/**
 * Statistiques IA Cardoria Big Data.
 */
import { getDb } from "../engine/database.js";

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function pct(num, den) {
  if (!den) return 0;
  return round1((num / den) * 100);
}

export function computeAiStats() {
  const db = getDb();
  const total = db.prepare("SELECT COUNT(*) AS c FROM bigdata_records").get()?.c ?? 0;

  const suspicious = db.prepare(`
    SELECT COUNT(*) AS c FROM bigdata_records WHERE authenticity = 'suspicious' OR counterfeit_score >= 60
  `).get()?.c ?? 0;

  const psa = db.prepare("SELECT COUNT(*) AS c FROM bigdata_records WHERE is_psa = 1").get()?.c ?? 0;
  const graded = db.prepare("SELECT COUNT(*) AS c FROM bigdata_records WHERE is_graded = 1").get()?.c ?? 0;

  const withActual = db.prepare(`
    SELECT COUNT(*) AS c FROM ai_enterprise_history
    WHERE price_actual_sell > 0 AND price_sell_advised > 0
  `).get()?.c ?? 0;

  const errors = db.prepare(`
    SELECT COUNT(*) AS c FROM ai_enterprise_history
    WHERE price_actual_sell > 0 AND price_sell_advised > 0
      AND ABS(price_actual_sell - price_sell_advised) / price_sell_advised > 0.15
  `).get()?.c ?? 0;

  const topLicenses = db.prepare(`
    SELECT license_slug AS license, COUNT(*) AS count, AVG(ai_score) AS avgAi
    FROM bigdata_records WHERE license_slug != '' GROUP BY license_slug ORDER BY count DESC LIMIT 10
  `).all().map((r) => ({ license: r.license, count: r.count, avgAiScore: round1(r.avgAi) }));

  const topExtensions = db.prepare(`
    SELECT extension, license_slug AS license, COUNT(*) AS count
    FROM bigdata_records WHERE extension != '' GROUP BY extension, license_slug ORDER BY count DESC LIMIT 10
  `).all();

  const topCards = db.prepare(`
    SELECT card_id, COUNT(*) AS count, AVG(price_market) AS avgPrice
    FROM bigdata_records WHERE card_id != '' GROUP BY card_id ORDER BY count DESC LIMIT 10
  `).all().map((r) => ({
    cardId: r.card_id,
    count: r.count,
    avgPrice: round1(r.avgPrice)
  }));

  const payload = {
    computedAt: new Date().toISOString(),
    estimations: total,
    errorRatePercent: pct(errors, withActual || total),
    counterfeitRatePercent: pct(suspicious, total),
    psaRatePercent: pct(psa, total),
    gradedRatePercent: pct(graded, total),
    avgAiScore: round1(db.prepare("SELECT AVG(ai_score) AS a FROM bigdata_records WHERE ai_score IS NOT NULL").get()?.a ?? 0),
    topLicenses,
    topExtensions,
    topCards
  };

  db.prepare(`
    INSERT INTO bigdata_ai_stats (cache_key, payload_json, computed_at)
    VALUES ('latest', ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, computed_at = excluded.computed_at
  `).run(JSON.stringify(payload), payload.computedAt);

  return payload;
}

export function getAiStats(force = false) {
  if (!force) {
    const cached = getDb().prepare("SELECT payload_json, computed_at FROM bigdata_ai_stats WHERE cache_key = 'latest'").get();
    if (cached) {
      const age = Date.now() - new Date(cached.computed_at).getTime();
      if (age < 1800000) {
        return { ...JSON.parse(cached.payload_json), cachedAt: cached.computed_at };
      }
    }
  }
  return computeAiStats();
}
