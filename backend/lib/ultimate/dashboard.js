/**
 * Tableau de bord Premium Ultimate — agrégation cross-modules (lecture seule).
 */
import { getDb } from "../engine/database.js";
import { readJson } from "../storage.js";
import { getTrendSignals } from "../ai-enterprise/trends.js";

const DEFAULT_ANALYTICS = { days: [], sources: {}, sales: [] };

function safeJson(s, fb = {}) {
  try { return JSON.parse(s || "{}"); } catch { return fb; }
}

export function buildUltimateDashboard() {
  const db = getDb();
  const analytics = readJson("analytics", DEFAULT_ANALYTICS);
  const today = new Date().toISOString().slice(0, 10);

  const dayRow = (analytics.days || []).find((d) => d.date === today) || {};
  const monthDays = (analytics.days || []).filter((d) => d.date?.slice(0, 7) === today.slice(0, 7));

  const visitors = dayRow.visitors || 0;
  const visitorsMonth = monthDays.reduce((s, d) => s + (d.visitors || 0), 0);

  const salesToday = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(sale_price), 0) AS revenue
    FROM market_transactions WHERE date(created_at) = date('now') AND sale_price > 0
  `).get();

  const mkRevenue = db.prepare(`
    SELECT COALESCE(SUM(unit_price * qty), 0) AS revenue, COUNT(*) AS orders
    FROM mk_orders WHERE status = 'paid' AND date(updated_at) = date('now')
  `).get();

  const estimationsToday = db.prepare(`
    SELECT COUNT(*) AS c FROM ai_analyses WHERE date(created_at) = date('now')
  `).get()?.c ?? 0;

  const scansToday = db.prepare(`
    SELECT COUNT(*) AS c FROM scanner_scans WHERE date(created_at) = date('now')
  `).get()?.c ?? 0;

  const counterfeits = db.prepare(`
    SELECT COUNT(*) AS c FROM ai_analyses
    WHERE date(created_at) = date('now') AND (confidence_score < 95 OR suspicion_alert = 1)
  `).get()?.c ?? 0;

  let avgEstimationMs = 0;
  try {
    avgEstimationMs = db.prepare(`
      SELECT AVG(processing_ms) AS avg FROM scanner_scans WHERE date(created_at) = date('now')
    `).get()?.avg ?? 0;
  } catch { /* ignore */ }

  const conversions = db.prepare(`
    SELECT COUNT(DISTINCT analysis_id) AS estimates,
      SUM(CASE WHEN price_actual_sell > 0 THEN 1 ELSE 0 END) AS sold
    FROM ai_enterprise_history WHERE date(created_at) >= date('now', '-30 days')
  `).get();

  const conversionRate = conversions?.estimates > 0
    ? Math.round((conversions.sold / conversions.estimates) * 1000) / 10
    : 0;

  const marginRows = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS period,
      AVG(CASE WHEN price_sell_advised > 0 AND price_buy_advised > 0
        THEN (price_sell_advised - price_buy_advised) / price_sell_advised * 100 END) AS margin
    FROM ai_enterprise_history GROUP BY period ORDER BY period DESC LIMIT 12
  `).all();

  const profitEstimate = db.prepare(`
    SELECT COALESCE(SUM(price_actual_sell - COALESCE(price_buy_advised, price_actual_sell * 0.75)), 0) AS profit
    FROM ai_enterprise_history WHERE price_actual_sell > 0 AND date(created_at) >= date('now', '-30 days')
  `).get()?.profit ?? 0;

  const topLicenses = db.prepare(`
    SELECT license_slug AS license, COUNT(*) AS volume
    FROM ai_enterprise_history WHERE license_slug != '' GROUP BY license_slug ORDER BY volume DESC LIMIT 8
  `).all();

  const trendingCards = getTrendSignals({ limit: 10 });

  const revenueChart = (analytics.days || []).slice(0, 30).reverse().map((d) => ({
    period: d.date,
    revenue: d.revenue || 0,
    visitors: d.visitors || 0,
    sales: d.sales || 0
  }));

  const payload = {
    computedAt: new Date().toISOString(),
    kpis: {
      visitorsToday: visitors,
      visitorsMonth,
      salesToday: salesToday?.c ?? 0,
      revenueToday: Math.round((salesToday?.revenue || 0) * 100) / 100,
      marketplaceRevenueToday: Math.round((mkRevenue?.revenue || 0) * 100) / 100,
      marketplaceOrdersToday: mkRevenue?.orders ?? 0,
      profitMonthEstimate: Math.round(profitEstimate * 100) / 100,
      marginPercent: marginRows[0]?.margin ? Math.round(marginRows[0].margin * 10) / 10 : 0,
      estimationsToday,
      scansToday,
      counterfeitsDetected: counterfeits,
      avgEstimationMs: Math.round(avgEstimationMs || 0),
      conversionRate
    },
    charts: {
      revenueVisitors: revenueChart,
      margins: marginRows.reverse().map((r) => ({ period: r.period, value: Math.round((r.margin || 0) * 10) / 10 }))
    },
    tops: {
      licenses: topLicenses,
      trendingCards
    }
  };

  db.prepare(`
    INSERT INTO ultimate_dashboard_cache (cache_key, payload_json, computed_at)
    VALUES ('latest', ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, computed_at = excluded.computed_at
  `).run(JSON.stringify(payload), payload.computedAt);

  return payload;
}

export function getUltimateDashboard({ refresh = false } = {}) {
  if (!refresh) {
    const cached = getDb().prepare("SELECT payload_json, computed_at FROM ultimate_dashboard_cache WHERE cache_key = 'latest'").get();
    if (cached) {
      const age = Date.now() - new Date(cached.computed_at).getTime();
      if (age < 1800000) {
        return { ...safeJson(cached.payload_json), cachedAt: cached.computed_at, cached: true };
      }
    }
  }
  return buildUltimateDashboard();
}

export function getUltimateStatsSummary() {
  const db = getDb();
  return {
    totalCards: db.prepare("SELECT COUNT(*) AS c FROM cards").get()?.c ?? 0,
    totalEstimations: db.prepare("SELECT COUNT(*) AS c FROM ai_analyses").get()?.c ?? 0,
    totalSearches: db.prepare("SELECT COUNT(*) AS c FROM ultimate_search_log").get()?.c ?? 0,
    exceptionalAlerts: db.prepare("SELECT COUNT(*) AS c FROM ultimate_exceptional_alerts").get()?.c ?? 0,
    scale: getScaleMeta()
  };
}

export function getScaleMeta() {
  const rows = getDb().prepare("SELECT meta_key, meta_value FROM ultimate_scale_meta").all();
  return Object.fromEntries(rows.map((r) => [r.meta_key, r.meta_value]));
}
