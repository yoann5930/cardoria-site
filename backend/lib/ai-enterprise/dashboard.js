/**
 * Tableau de bord Premium admin — tops & évolutions (cache).
 */
import { getDb } from "../engine/database.js";
import { getCardoriaTrendIndex, getTrendSignals } from "./trends.js";

function safeJsonParse(s, fallback = {}) {
  try { return JSON.parse(s || "{}"); } catch { return fallback; }
}

export function buildEnterpriseDashboard() {
  const db = getDb();

  const topLicenses = db.prepare(`
    SELECT license_slug AS license, COUNT(*) AS estimations, AVG(reliability_score) AS avgReliability,
           SUM(COALESCE(price_actual_sell, 0)) AS revenue
    FROM ai_enterprise_history WHERE license_slug != ''
    GROUP BY license_slug ORDER BY estimations DESC LIMIT 10
  `).all().map((r) => ({
    license: r.license,
    estimations: r.estimations,
    avgReliability: Math.round(r.avgReliability || 0),
    revenue: Math.round((r.revenue || 0) * 100) / 100
  }));

  const topExtensions = db.prepare(`
    SELECT extension, license_slug AS license, COUNT(*) AS estimations
    FROM ai_enterprise_history WHERE extension != ''
    GROUP BY extension, license_slug ORDER BY estimations DESC LIMIT 10
  `).all();

  const topCards = db.prepare(`
    SELECT h.card_id, c.name AS card_name, COUNT(*) AS scans,
           AVG(h.reliability_score) AS reliability, SUM(h.views_count) AS views
    FROM ai_enterprise_history h
    LEFT JOIN cards c ON c.id = h.card_id
    WHERE h.card_id IS NOT NULL
    GROUP BY h.card_id ORDER BY scans DESC LIMIT 10
  `).all().map((r) => ({
    cardId: r.card_id,
    cardName: r.card_name || r.card_id,
    estimations: r.scans,
    reliability: Math.round(r.reliability || 0),
    views: r.views
  }));

  const topSales = db.prepare(`
    SELECT card_id, price_actual_sell AS amount, sale_delay_days AS delayDays, created_at AS soldAt
    FROM ai_enterprise_history WHERE price_actual_sell > 0
    ORDER BY price_actual_sell DESC LIMIT 10
  `).all();

  const topSearches = db.prepare(`
    SELECT license_slug AS license, extension, COUNT(*) AS searches
    FROM ai_enterprise_history
    GROUP BY license_slug, extension ORDER BY searches DESC LIMIT 10
  `).all();

  const topTrends = getTrendSignals({ limit: 15 });
  const trendIndex = getCardoriaTrendIndex();

  const marginEvolution = buildMonthlySeries(db, `
    SELECT strftime('%Y-%m', created_at) AS period,
           AVG(CASE WHEN price_sell_advised > 0 AND price_buy_advised > 0
               THEN (price_sell_advised - price_buy_advised) / price_sell_advised * 100 END) AS value
    FROM ai_enterprise_history GROUP BY period ORDER BY period DESC LIMIT 12
  `);

  const priceEvolution = buildMonthlySeries(db, `
    SELECT strftime('%Y-%m', created_at) AS period, AVG(price_market) AS value
    FROM ai_enterprise_history WHERE price_market > 0 GROUP BY period ORDER BY period DESC LIMIT 12
  `);

  const scanEvolution = buildMonthlySeries(db, `
    SELECT strftime('%Y-%m', created_at) AS period, COUNT(*) AS value
    FROM ai_enterprise_history WHERE source IN ('scanner','estimation') GROUP BY period ORDER BY period DESC LIMIT 12
  `);

  const visitorEvolution = buildMonthlySeries(db, `
    SELECT strftime('%Y-%m', created_at) AS period, SUM(views_count) AS value
    FROM ai_enterprise_history GROUP BY period ORDER BY period DESC LIMIT 12
  `);

  const salesEvolution = buildMonthlySeries(db, `
    SELECT strftime('%Y-%m', created_at) AS period, COUNT(*) AS value
    FROM ai_enterprise_history WHERE price_actual_sell > 0 GROUP BY period ORDER BY period DESC LIMIT 12
  `);

  const reliabilityGlobal = db.prepare(`
    SELECT AVG(score) AS avg FROM ai_enterprise_reliability
  `).get();

  const payload = {
    computedAt: new Date().toISOString(),
    cardoriaTrendIndex: trendIndex.cardoriaTrendIndex,
    globalReliability: Math.round(reliabilityGlobal?.avg || 42),
    tops: {
      licenses: topLicenses,
      extensions: topExtensions,
      cards: topCards,
      sales: topSales,
      searches: topSearches,
      trends: topTrends
    },
    evolution: {
      margins: marginEvolution.reverse(),
      prices: priceEvolution.reverse(),
      scans: scanEvolution.reverse(),
      visitors: visitorEvolution.reverse(),
      sales: salesEvolution.reverse()
    }
  };

  db.prepare(`
    INSERT INTO ai_enterprise_dashboard_cache (cache_key, payload_json, computed_at)
    VALUES ('latest', ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, computed_at = excluded.computed_at
  `).run(JSON.stringify(payload), payload.computedAt);

  return payload;
}

function buildMonthlySeries(db, sql) {
  return db.prepare(sql).all().map((r) => ({
    period: r.period,
    value: Math.round((r.value || 0) * 100) / 100
  }));
}

export function getEnterpriseDashboard({ refresh = false } = {}) {
  const db = getDb();
  if (refresh) return buildEnterpriseDashboard();

  const cached = db.prepare("SELECT payload_json, computed_at FROM ai_enterprise_dashboard_cache WHERE cache_key = 'latest'").get();
  if (cached) {
    const payload = safeJsonParse(cached.payload_json);
    payload.cachedAt = cached.computed_at;
    return payload;
  }
  return buildEnterpriseDashboard();
}

export function getEnterpriseStatsSummary() {
  const db = getDb();
  return {
    totalEstimations: db.prepare("SELECT COUNT(*) AS c FROM ai_enterprise_history").get()?.c ?? 0,
    totalSalesRecorded: db.prepare("SELECT COUNT(*) AS c FROM ai_enterprise_history WHERE price_actual_sell > 0").get()?.c ?? 0,
    totalAdjustments: db.prepare("SELECT COUNT(*) AS c FROM ai_enterprise_adjustments").get()?.c ?? 0,
    cardsWithPredictions: db.prepare("SELECT COUNT(*) AS c FROM ai_enterprise_predictions").get()?.c ?? 0,
    activeTrendSignals: db.prepare("SELECT COUNT(*) AS c FROM ai_enterprise_trend_signals WHERE computed_at >= datetime('now', '-1 day')").get()?.c ?? 0
  };
}
