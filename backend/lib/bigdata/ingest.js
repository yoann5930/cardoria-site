/**
 * Data Engine — ingestion depuis estimations existantes (lecture seule).
 */
import { getDb } from "../engine/database.js";
import { makeBigDataRecordId } from "./migrate.js";
import { resolveRegion } from "./regions.js";

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseJson(s, fb = {}) {
  try { return JSON.parse(s || "{}"); } catch { return fb; }
}

function isGraded(text) {
  return /psa|bgs|cgc|graded|gradée|gem mint/i.test(String(text || ""));
}

function isPsa(text) {
  return /psa\s*\d/i.test(String(text || ""));
}

function authenticityFromAnalysis(confidence, suspicion) {
  if (suspicion) return "suspicious";
  if (confidence >= 95) return "verified";
  if (confidence >= 80) return "likely_authentic";
  return "review_needed";
}

function counterfeitScore(confidence, suspicion) {
  const c = confidence ?? 85;
  if (suspicion) return clamp(100 - c + 30, 55, 99);
  return clamp(Math.max(0, 35 - (c - 80)), 0, 40);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n) || 0));
}

export function ingestBigDataRecord(payload) {
  const db = getDb();
  const region = resolveRegion({ countryCode: payload.countryCode, email: payload.email });
  const id = payload.id || makeBigDataRecordId();
  const blob = `${payload.detectionText || ""} ${payload.rarity || ""}`;

  db.prepare(`
    INSERT INTO bigdata_records (
      id, source_type, source_id, card_id, license_slug, extension, card_number,
      language, condition_grade, authenticity, price_estimated, price_market,
      price_buy_advised, price_sell_advised, recorded_at, country_code, region_bucket,
      rarity, ai_score, counterfeit_score, is_graded, is_psa
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_type, source_id) DO UPDATE SET
      price_estimated = excluded.price_estimated,
      price_market = excluded.price_market,
      ai_score = excluded.ai_score,
      counterfeit_score = excluded.counterfeit_score
  `).run(
    id,
    payload.sourceType || "manual",
    payload.sourceId || id,
    payload.cardId || "",
    payload.license || "",
    payload.extension || "",
    payload.number || "",
    payload.language || "",
    payload.condition || "",
    payload.authenticity || "unknown",
    round2(payload.priceEstimated),
    round2(payload.priceMarket),
    round2(payload.priceBuyAdvised),
    round2(payload.priceSellAdvised),
    payload.recordedAt || new Date().toISOString(),
    region.countryCode,
    region.regionBucket,
    payload.rarity || "",
    payload.aiScore ?? null,
    payload.counterfeitScore ?? null,
    isGraded(blob) ? 1 : 0,
    isPsa(blob) ? 1 : 0
  );

  return { id, region: region.regionBucket };
}

export function syncFromAiAnalyses(limit = 500) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT a.* FROM ai_analyses a
    WHERE NOT EXISTS (
      SELECT 1 FROM bigdata_records b WHERE b.source_type = 'ai_analysis' AND b.source_id = a.id
    )
    ORDER BY a.created_at DESC LIMIT ?
  `).all(limit);

  let synced = 0;
  rows.forEach((row) => {
    const det = parseJson(row.detection_json);
    const prices = parseJson(row.prices_json);
    ingestBigDataRecord({
      sourceType: "ai_analysis",
      sourceId: row.id,
      cardId: row.card_id || "",
      license: det.license,
      extension: det.extension,
      number: det.number,
      language: det.language,
      condition: row.condition_grade,
      rarity: det.rarity,
      email: row.customer_email,
      authenticity: authenticityFromAnalysis(row.confidence_score, row.suspicion_alert),
      priceEstimated: prices.resell || prices.recommended,
      priceMarket: prices.avg || prices.market?.avg,
      priceBuyAdvised: prices.buyback,
      priceSellAdvised: prices.resell,
      aiScore: row.confidence_score,
      counterfeitScore: counterfeitScore(row.confidence_score, row.suspicion_alert),
      recordedAt: row.created_at,
      detectionText: JSON.stringify(det)
    });
    synced++;
  });
  return synced;
}

export function syncFromEnterpriseHistory(limit = 500) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT h.* FROM ai_enterprise_history h
    WHERE NOT EXISTS (
      SELECT 1 FROM bigdata_records b WHERE b.source_type = 'enterprise' AND b.source_id = h.id
    )
    ORDER BY h.created_at DESC LIMIT ?
  `).all(limit);

  let synced = 0;
  rows.forEach((row) => {
    const meta = parseJson(row.metadata_json);
    ingestBigDataRecord({
      sourceType: "enterprise",
      sourceId: row.id,
      cardId: row.card_id || "",
      license: row.license_slug,
      extension: row.extension,
      number: row.card_number,
      language: row.language,
      condition: row.condition_grade,
      rarity: meta.detection?.rarity || "",
      authenticity: row.confidence_score >= 95 ? "verified" : "likely_authentic",
      priceEstimated: row.price_sell_advised,
      priceMarket: row.price_market,
      priceBuyAdvised: row.price_buy_advised,
      priceSellAdvised: row.price_sell_advised,
      aiScore: row.confidence_score || row.reliability_score,
      counterfeitScore: row.confidence_score ? clamp(100 - row.confidence_score, 0, 60) : 30,
      recordedAt: row.created_at,
      detectionText: JSON.stringify(meta.detection || {})
    });
    synced++;
  });
  return synced;
}

export function syncFromScannerScans(limit = 300) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.* FROM scanner_scans s
    WHERE NOT EXISTS (
      SELECT 1 FROM bigdata_records b WHERE b.source_type = 'scanner' AND b.source_id = s.id
    )
    ORDER BY s.created_at DESC LIMIT ?
  `).all(limit);

  let synced = 0;
  rows.forEach((row) => {
    const det = parseJson(row.detection_json);
    const client = parseJson(row.client_json);
    ingestBigDataRecord({
      sourceType: "scanner",
      sourceId: row.id,
      cardId: row.card_id || "",
      license: det.license || row.license_slug,
      extension: det.extension,
      number: det.number,
      language: det.language,
      condition: row.condition_grade,
      rarity: det.rarity,
      email: row.customer_email,
      authenticity: authenticityFromAnalysis(row.confidence_score, row.suspicion_alert),
      priceEstimated: client.pricing?.resell,
      priceMarket: client.pricing?.avg,
      priceBuyAdvised: client.pricing?.buyback,
      priceSellAdvised: client.pricing?.resell,
      aiScore: row.confidence_score,
      counterfeitScore: counterfeitScore(row.confidence_score, row.suspicion_alert),
      recordedAt: row.created_at,
      detectionText: JSON.stringify(det)
    });
    synced++;
  });
  return synced;
}

export function runFullIngestSync() {
  return {
    aiAnalyses: syncFromAiAnalyses(800),
    enterprise: syncFromEnterpriseHistory(800),
    scanner: syncFromScannerScans(400),
    at: new Date().toISOString()
  };
}

export function getBigDataRecordCount() {
  return getDb().prepare("SELECT COUNT(*) AS c FROM bigdata_records").get()?.c ?? 0;
}
