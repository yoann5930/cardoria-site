/**
 * Évolution mondiale des prix — agrégation par région et date.
 */
import { getDb } from "../engine/database.js";
import { REGION_BUCKETS } from "./regions.js";

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function computePriceEvolution({ days = 365 } = {}) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const now = new Date().toISOString();

  REGION_BUCKETS.forEach((region) => {
    const whereRegion = region === "world"
      ? "recorded_at >= ?"
      : "region_bucket = ? AND recorded_at >= ?";

    const params = region === "world" ? [since] : [region, since];

    const rows = db.prepare(`
      SELECT date(recorded_at) AS period_date,
        AVG(price_market) AS avg_market,
        AVG(COALESCE(price_estimated, price_sell_advised)) AS avg_estimated,
        COUNT(*) AS volume
      FROM bigdata_records WHERE ${whereRegion}
      GROUP BY date(recorded_at) ORDER BY period_date ASC
    `).all(...params);

    rows.forEach((r) => {
      db.prepare(`
        INSERT INTO bigdata_price_evolution (period_date, region_bucket, avg_market, avg_estimated, volume, computed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(period_date, region_bucket) DO UPDATE SET
          avg_market = excluded.avg_market, avg_estimated = excluded.avg_estimated,
          volume = excluded.volume, computed_at = excluded.computed_at
      `).run(
        r.period_date, region, round2(r.avg_market), round2(r.avg_estimated),
        r.volume, now
      );
    });
  });

  return { regions: REGION_BUCKETS.length, computedAt: now };
}

export function getPriceEvolution({ region = "world", limit = 90 } = {}) {
  const rows = getDb().prepare(`
    SELECT period_date AS date, avg_market AS avgMarket, avg_estimated AS avgEstimated, volume
    FROM bigdata_price_evolution WHERE region_bucket = ?
    ORDER BY period_date DESC LIMIT ?
  `).all(region, limit);

  return {
    region,
    points: rows.reverse().map((r) => ({
      date: r.date,
      avgMarket: r.avgMarket,
      avgEstimated: r.avgEstimated,
      volume: r.volume
    }))
  };
}

export function getGlobalPriceEvolutionSummary() {
  const world = getPriceEvolution({ region: "world", limit: 30 });
  const pts = world.points || [];
  if (pts.length < 2) return { trendPercent: 0, avgMarket: 0, volume: 0 };

  const first = pts[0].avgMarket || pts[0].avgEstimated || 0;
  const last = pts[pts.length - 1].avgMarket || pts[pts.length - 1].avgEstimated || 0;
  const trendPercent = first > 0 ? round2(((last - first) / first) * 100) : 0;
  const volume = pts.reduce((s, p) => s + (p.volume || 0), 0);

  return {
    trendPercent,
    avgMarket: round2(last),
    volume,
    points: pts
  };
}
