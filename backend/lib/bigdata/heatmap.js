/**
 * HeatMap mondiale Cardoria Big Data.
 */
import { getDb } from "../engine/database.js";
import { REGION_BUCKETS, getHeatmapRegionLabels, COUNTRY_TO_REGION } from "./regions.js";

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

export function computeHeatmap() {
  const db = getDb();
  const now = new Date().toISOString();
  const labels = getHeatmapRegionLabels();

  REGION_BUCKETS.forEach((bucket) => {
    let row;
    if (bucket === "world") {
      row = db.prepare(`
        SELECT COUNT(*) AS c, AVG(COALESCE(price_market, price_estimated)) AS avg_p,
          AVG(ai_score) AS avg_ai FROM bigdata_records
      `).get();
    } else {
      row = db.prepare(`
        SELECT COUNT(*) AS c, AVG(COALESCE(price_market, price_estimated)) AS avg_p,
          AVG(ai_score) AS avg_ai FROM bigdata_records WHERE region_bucket = ?
      `).get(bucket);
    }

    const count = row?.c ?? 0;
    const maxCount = db.prepare("SELECT COUNT(*) AS c FROM bigdata_records").get()?.c ?? 1;
    const intensity = round1(Math.min(100, (count / Math.max(maxCount / 8, 1)) * 100));

    const countryCodes = Object.entries(COUNTRY_TO_REGION)
      .filter(([, r]) => r === bucket)
      .map(([cc]) => cc);

    db.prepare(`
      INSERT INTO bigdata_heatmap (region_bucket, estimation_count, avg_price, avg_ai_score, intensity, country_codes_json, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(region_bucket) DO UPDATE SET
        estimation_count = excluded.estimation_count, avg_price = excluded.avg_price,
        avg_ai_score = excluded.avg_ai_score, intensity = excluded.intensity,
        country_codes_json = excluded.country_codes_json, computed_at = excluded.computed_at
    `).run(
      bucket, count, round1(row?.avg_p ?? 0), round1(row?.avg_ai ?? 50),
      intensity, JSON.stringify(bucket === "world" ? ["*"] : countryCodes), now
    );
  });

  return { regions: REGION_BUCKETS.map((b) => ({ bucket: b, label: labels[b] })), computedAt: now };
}

export function getHeatmap() {
  const labels = getHeatmapRegionLabels();
  const rows = getDb().prepare("SELECT * FROM bigdata_heatmap ORDER BY estimation_count DESC").all();

  if (!rows.length) computeHeatmap();

  return getDb().prepare("SELECT * FROM bigdata_heatmap").all().map((r) => ({
    region: r.region_bucket,
    label: labels[r.region_bucket] || r.region_bucket,
    estimationCount: r.estimation_count,
    avgPrice: r.avg_price,
    avgAiScore: r.avg_ai_score,
    intensity: r.intensity,
    countryCodes: JSON.parse(r.country_codes_json || "[]")
  }));
}

export function getHeatmapForRegion(regionBucket) {
  return getHeatmap().find((h) => h.region === regionBucket) || null;
}
