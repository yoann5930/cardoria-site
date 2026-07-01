/**
 * Validations admin & réentraînement contextuel (few-shot) + apprentissage continu.
 */
import { getDb } from "../engine/database.js";
import {
  initLearningRecord,
  processAdminFeedback,
  getLearningRecord,
  getSimilarTrainingExamples,
  getFeedbackHistory,
  getTrainingPoolStats
} from "./learning.js";
import { cacheMonthlyPerformance } from "./performance.js";

export { initLearningRecord, getLearningRecord, getFeedbackHistory, getSimilarTrainingExamples, getTrainingPoolStats };

export function saveValidation({ analysisId, action, correctedDetection, correctedPrices, adminNote, reason = "",
  conditionValidated, priceActualBuy, priceActualSell, resaleDelayDays, isCounterfeit, authenticityResult }) {
  const db = getDb();
  const now = new Date().toISOString();

  const r = db.prepare(`
    INSERT INTO ai_validations (analysis_id, admin_action, corrected_detection, corrected_prices, admin_note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    analysisId,
    action,
    JSON.stringify(correctedDetection || {}),
    JSON.stringify(correctedPrices || {}),
    adminNote || "",
    now
  );

  db.prepare("UPDATE ai_analyses SET admin_status = ? WHERE id = ?").run(action, analysisId);

  const learning = processAdminFeedback(analysisId, {
    action,
    detection: correctedDetection,
    prices: correctedPrices,
    reason: reason || adminNote,
    adminNote,
    conditionValidated,
    priceActualBuy,
    priceActualSell,
    resaleDelayDays,
    isCounterfeit,
    authenticityResult
  });

  if (action === "approved" || action === "corrected") {
    let detection = correctedDetection;
    if (!detection || !Object.keys(detection).length) {
      const row = db.prepare("SELECT detection_json FROM ai_analyses WHERE id = ?").get(analysisId);
      try { detection = JSON.parse(row?.detection_json || "{}"); } catch { detection = {}; }
    }
    if (!learning?.training?.added) {
      db.prepare(`
        INSERT INTO ai_training_examples (license_slug, detection_json, source, weight, created_at)
        VALUES (?, ?, 'admin_validation', 1.2, ?)
      `).run(detection.license || "", JSON.stringify(detection), now);
    }
  }

  cacheMonthlyPerformance();
  return { id: r.lastInsertRowid, action, learning: learning?.record, training: learning?.training };
}

export function getTrainingExamples(limit = 20, context = {}) {
  if (context.license || context.fingerprint || context.extension || context.number) {
    const similar = getSimilarTrainingExamples({ ...context, limit });
    if (similar.length) return similar;
  }

  return getDb().prepare(`
    SELECT license_slug, extension, rarity, fingerprint, detection_json, condition_json, prices_json, weight, source
    FROM ai_training_examples ORDER BY weight DESC, created_at DESC LIMIT ?
  `).all(limit).map((r) => ({
    license: r.license_slug,
    extension: r.extension,
    rarity: r.rarity,
    fingerprint: r.fingerprint,
    detection: JSON.parse(r.detection_json || "{}"),
    condition: JSON.parse(r.condition_json || "{}"),
    prices: JSON.parse(r.prices_json || "{}"),
    weight: r.weight,
    source: r.source
  }));
}

export function retrainFromValidations() {
  const db = getDb();
  const pending = db.prepare(`
    SELECT v.id, v.corrected_detection, v.admin_note, a.detection_json, a.id AS analysis_id
    FROM ai_validations v
    JOIN ai_analyses a ON a.id = v.analysis_id
    WHERE v.used_for_training = 0 AND v.admin_action IN ('approved', 'corrected')
  `).all();

  let added = 0;
  pending.forEach((row) => {
    const det = row.corrected_detection && row.corrected_detection !== "{}"
      ? JSON.parse(row.corrected_detection)
      : JSON.parse(row.detection_json || "{}");

    processAdminFeedback(row.analysis_id, {
      action: "corrected",
      detection: det,
      reason: row.admin_note || "Réentraînement batch",
      adminNote: row.admin_note
    });

    db.prepare("UPDATE ai_validations SET used_for_training = 1 WHERE id = ?").run(row.id);
    added++;
  });

  cacheMonthlyPerformance();

  return {
    processed: pending.length,
    examplesAdded: added,
    totalExamples: db.prepare("SELECT COUNT(*) AS c FROM ai_training_examples").get()?.c ?? 0
  };
}

export function getAnalysis(id) {
  const row = getDb().prepare("SELECT * FROM ai_analyses WHERE id = ?").get(id);
  if (!row) return null;
  const analysis = mapAnalysis(row);
  analysis.learning = getLearningRecord(id);
  analysis.feedback = getFeedbackHistory(id, 20);
  return analysis;
}

export function listAnalyses({ status, limit = 50 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM ai_analyses";
  const params = [];
  if (status) { sql += " WHERE admin_status = ?"; params.push(status); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map(mapAnalysis);
}

export function updateAnalysisCorrection(id, { clientMessage, prices, detection, adminStatus, reason, adminNote, ...outcome }) {
  const db = getDb();
  const sets = [];
  const params = [];
  if (clientMessage != null) { sets.push("client_message = ?"); params.push(clientMessage); }
  if (prices != null) { sets.push("prices_json = ?"); params.push(JSON.stringify(prices)); }
  if (detection != null) { sets.push("detection_json = ?"); params.push(JSON.stringify(detection)); }
  if (adminStatus != null) { sets.push("admin_status = ?"); params.push(adminStatus); }
  if (sets.length) {
    params.push(id);
    db.prepare(`UPDATE ai_analyses SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  return getAnalysis(id);
}

export function saveAnalysis(record) {
  const db = getDb();
  db.prepare(`
    INSERT INTO ai_analyses (
      id, created_at, customer_name, customer_email, customer_notes, card_id, photos_count,
      confidence_score, suspicion_alert, suspicion_reasons, condition_grade, client_message,
      raw_response, status, admin_status, prices_json, detection_json, trends_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    record.id, record.createdAt, record.customerName, record.customerEmail, record.customerNotes,
    record.cardId, record.photosCount, record.confidenceScore, record.suspicionAlert ? 1 : 0,
    JSON.stringify(record.suspicionReasons || []), record.conditionGrade, record.clientMessage,
    record.rawResponse, record.status, JSON.stringify(record.prices || {}),
    JSON.stringify(record.detection || {}), JSON.stringify(record.trends || {})
  );

  initLearningRecord({
    analysisId: record.id,
    detection: record.detection,
    conditionEstimated: record.conditionGrade,
    prices: record.prices,
    confidenceScore: record.confidenceScore,
    suspicionAlert: record.suspicionAlert,
    imagesBase64: record.imagesBase64 || []
  });

  return getAnalysis(record.id);
}

function mapAnalysis(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    cardId: row.card_id,
    confidenceScore: row.confidence_score,
    suspicionAlert: !!row.suspicion_alert,
    suspicionReasons: JSON.parse(row.suspicion_reasons || "[]"),
    conditionGrade: row.condition_grade,
    clientMessage: row.client_message,
    adminStatus: row.admin_status,
    status: row.status,
    detection: JSON.parse(row.detection_json || "{}"),
    prices: JSON.parse(row.prices_json || "{}"),
    trends: JSON.parse(row.trends_json || "{}"),
    photosCount: row.photos_count
  };
}

export function recordOutcome(id, outcome = {}) {
  processAdminFeedback(id, { action: "corrected", ...outcome });
  cacheMonthlyPerformance();
  return getAnalysis(id);
}

export function submitAdminFeedback(id, payload = {}) {
  const result = processAdminFeedback(id, payload);
  cacheMonthlyPerformance();
  return getAnalysis(id);
}
