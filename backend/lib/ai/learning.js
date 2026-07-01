/**
 * Système d'apprentissage continu Cardoria — enregistrement, feedback, few-shot.
 * Architecture normalisée compatible montée en charge (PostgreSQL / object storage).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../engine/database.js";
import { ingestAdminFeedbackOutcome } from "../market/ingest.js";
import { getAnalysis } from "./training.js";

const AI_IMAGES_DIR = path.join(process.cwd(), "data", "ai-images");

export function makeFingerprint(detection = {}) {
  return [detection.license, detection.extension, detection.number, detection.rarity]
    .map((s) => String(s || "").toLowerCase().trim())
    .filter(Boolean)
    .join("|");
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseJson(str, fallback = {}) {
  try { return JSON.parse(str || JSON.stringify(fallback)); } catch { return fallback; }
}

export function saveAnalysisImages(analysisId, imagesBase64 = []) {
  if (!analysisId || !imagesBase64?.length) return [];
  const dir = path.join(AI_IMAGES_DIR, analysisId);
  fs.mkdirSync(dir, { recursive: true });

  const db = getDb();
  db.prepare("DELETE FROM ai_learning_images WHERE analysis_id = ?").run(analysisId);

  const ins = db.prepare(`
    INSERT INTO ai_learning_images (analysis_id, side, storage_path, content_hash, byte_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const saved = [];
  imagesBase64.slice(0, 6).forEach((img, i) => {
    if (typeof img !== "string" || !img.startsWith("data:image")) return;
    const side = i === 0 ? "front" : i === 1 ? "back" : "other";
    const ext = img.includes("png") ? "png" : "jpg";
    const base64 = img.split(",")[1] || "";
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) return;

    const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 24);
    const filename = `${side}_${i}.${ext}`;
    const relPath = path.join("ai-images", analysisId, filename).replace(/\\/g, "/");
    fs.writeFileSync(path.join(dir, filename), buffer);

    ins.run(analysisId, side, relPath, hash, buffer.length, new Date().toISOString());
    saved.push({ side, path: relPath, hash, byteSize: buffer.length });
  });

  return saved;
}

export function getLearningImages(analysisId) {
  return getDb().prepare(`
    SELECT side, storage_path AS path, content_hash AS hash, byte_size AS byteSize, created_at AS createdAt
    FROM ai_learning_images WHERE analysis_id = ? ORDER BY id ASC
  `).all(analysisId);
}

export function getImageAbsolutePath(relPath) {
  return path.join(process.cwd(), "data", relPath.replace(/^ai-images\//, "ai-images/"));
}

export function initLearningRecord({
  analysisId,
  detection = {},
  conditionEstimated = "",
  prices = {},
  confidenceScore = null,
  suspicionAlert = false,
  imagesBase64 = []
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const fp = makeFingerprint(detection);

  saveAnalysisImages(analysisId, imagesBase64);

  db.prepare(`
    INSERT INTO ai_learning_records (
      analysis_id, created_at, updated_at, license_slug, extension, card_number, rarity, card_name,
      fingerprint, condition_estimated, price_ai_buyback, price_ai_resell, price_ai_avg,
      confidence_score, authenticity_result, is_counterfeit, admin_decision,
      detection_ai_json, prices_ai_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(analysis_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      license_slug = excluded.license_slug,
      extension = excluded.extension,
      card_number = excluded.card_number,
      rarity = excluded.rarity,
      card_name = excluded.card_name,
      fingerprint = excluded.fingerprint,
      condition_estimated = excluded.condition_estimated,
      price_ai_buyback = excluded.price_ai_buyback,
      price_ai_resell = excluded.price_ai_resell,
      price_ai_avg = excluded.price_ai_avg,
      confidence_score = excluded.confidence_score,
      authenticity_result = excluded.authenticity_result,
      is_counterfeit = excluded.is_counterfeit,
      detection_ai_json = excluded.detection_ai_json,
      prices_ai_json = excluded.prices_ai_json
  `).run(
    analysisId, now, now,
    detection.license || "",
    detection.extension || "",
    detection.number || "",
    detection.rarity || "",
    detection.name || "",
    fp,
    conditionEstimated,
    prices.buyback ?? null,
    prices.resell ?? prices.recommended ?? null,
    prices.avg ?? null,
    confidenceScore,
    suspicionAlert ? "suspicious" : "authentic",
    suspicionAlert ? 1 : 0,
    JSON.stringify(detection),
    JSON.stringify(prices)
  );

  return getLearningRecord(analysisId);
}

export function getLearningRecord(analysisId) {
  const row = getDb().prepare("SELECT * FROM ai_learning_records WHERE analysis_id = ?").get(analysisId);
  if (!row) return null;
  return mapLearningRecord(row);
}

function mapLearningRecord(row) {
  return {
    analysisId: row.analysis_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    license: row.license_slug,
    extension: row.extension,
    number: row.card_number,
    rarity: row.rarity,
    cardName: row.card_name,
    fingerprint: row.fingerprint,
    conditionEstimated: row.condition_estimated,
    conditionValidated: row.condition_validated,
    priceAi: {
      buyback: row.price_ai_buyback,
      resell: row.price_ai_resell,
      avg: row.price_ai_avg
    },
    priceActual: {
      buy: row.price_actual_buy,
      sell: row.price_actual_sell
    },
    resaleDelayDays: row.resale_delay_days,
    authenticityResult: row.authenticity_result,
    isCounterfeit: !!row.is_counterfeit,
    confidenceScore: row.confidence_score,
    adminDecision: row.admin_decision,
    detectionAi: parseJson(row.detection_ai_json),
    detectionValidated: parseJson(row.detection_validated_json),
    pricesAi: parseJson(row.prices_ai_json),
    outcomeRecorded: !!row.outcome_recorded,
    trainingWeight: row.training_weight,
    images: getLearningImages(row.analysis_id)
  };
}

export function logFeedbackEntry({
  analysisId,
  feedbackType,
  fieldName = "",
  aiValue = "",
  correctedValue = "",
  reason = "",
  adminNote = ""
}) {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO ai_feedback_log (analysis_id, feedback_type, field_name, ai_value, corrected_value, reason, admin_note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    analysisId, feedbackType, fieldName,
    String(aiValue ?? ""), String(correctedValue ?? ""),
    reason || "", adminNote || "",
    new Date().toISOString()
  );
  return r.lastInsertRowid;
}

function diffAndLogFeedback(analysisId, aiObj, correctedObj, prefix, reason) {
  const fields = ["name", "license", "extension", "number", "rarity", "language", "version"];
  fields.forEach((f) => {
    const aiVal = aiObj?.[f] ?? "";
    const corVal = correctedObj?.[f] ?? "";
    if (corVal && String(aiVal).toLowerCase() !== String(corVal).toLowerCase()) {
      logFeedbackEntry({
        analysisId,
        feedbackType: "correction",
        fieldName: prefix ? `${prefix}.${f}` : f,
        aiValue: aiVal,
        correctedValue: corVal,
        reason
      });
    }
  });
}

export function applyFeedbackToTraining(analysisId, { detection, conditionValidated, prices, reason = "", adminNote = "" } = {}) {
  const db = getDb();
  const record = getLearningRecord(analysisId);
  if (!record) return { added: 0 };

  const existing = db.prepare("SELECT id FROM ai_training_examples WHERE analysis_id = ? LIMIT 1").get(analysisId);
  if (existing) return { added: 0, fingerprint: record.fingerprint, skipped: true };

  const validatedDetection = detection || record.detectionValidated || record.detectionAi;
  const fp = makeFingerprint(validatedDetection);
  const now = new Date().toISOString();
  const weight = record.trainingWeight || 1.2;

  const feedbackId = logFeedbackEntry({
    analysisId,
    feedbackType: "training_applied",
    fieldName: "bundle",
    aiValue: JSON.stringify(record.detectionAi),
    correctedValue: JSON.stringify(validatedDetection),
    reason: reason || "Correction admin intégrée à l'entraînement",
    adminNote
  });

  db.prepare(`
    INSERT INTO ai_training_examples (
      license_slug, extension, rarity, fingerprint, detection_json, condition_json, prices_json,
      source, weight, analysis_id, feedback_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'admin_feedback', ?, ?, ?, ?)
  `).run(
    validatedDetection.license || record.license || "",
    validatedDetection.extension || record.extension || "",
    validatedDetection.rarity || record.rarity || "",
    fp,
    JSON.stringify(validatedDetection),
    JSON.stringify({ estimated: record.conditionEstimated, validated: conditionValidated || record.conditionValidated }),
    JSON.stringify(prices || record.pricesAi),
    weight,
    analysisId,
    feedbackId,
    now
  );

  db.prepare(`
    UPDATE ai_feedback_log SET applied_to_training = 1
    WHERE analysis_id = ? AND applied_to_training = 0
  `).run(analysisId);

  return { added: 1, fingerprint: fp, feedbackId };
}

export function processAdminFeedback(analysisId, payload = {}) {
  const db = getDb();
  const record = getLearningRecord(analysisId);
  if (!record) return null;

  const now = new Date().toISOString();
  const {
    action,
    reason = "",
    adminNote = "",
    detection,
    conditionValidated,
    prices,
    priceActualBuy,
    priceActualSell,
    resaleDelayDays,
    isCounterfeit,
    authenticityResult
  } = payload;

  const validatedDetection = detection || record.detectionValidated || record.detectionAi;
  const decision = action || record.adminDecision;

  if (detection && record.detectionAi) {
    diffAndLogFeedback(analysisId, record.detectionAi, detection, "detection", reason);
  }

  if (conditionValidated && conditionValidated !== record.conditionEstimated) {
    logFeedbackEntry({
      analysisId,
      feedbackType: "correction",
      fieldName: "condition",
      aiValue: record.conditionEstimated,
      correctedValue: conditionValidated,
      reason,
      adminNote
    });
  }

  if (prices?.buyback != null && record.priceAi?.buyback != null && prices.buyback !== record.priceAi.buyback) {
    logFeedbackEntry({
      analysisId,
      feedbackType: "correction",
      fieldName: "price_buyback",
      aiValue: record.priceAi.buyback,
      correctedValue: prices.buyback,
      reason,
      adminNote
    });
  }

  const authResult = authenticityResult || (isCounterfeit ? "counterfeit" : isCounterfeit === false ? "authentic" : record.authenticityResult);

  db.prepare(`
    UPDATE ai_learning_records SET
      updated_at = ?,
      admin_decision = ?,
      condition_validated = COALESCE(?, condition_validated),
      detection_validated_json = ?,
      price_actual_buy = COALESCE(?, price_actual_buy),
      price_actual_sell = COALESCE(?, price_actual_sell),
      resale_delay_days = COALESCE(?, resale_delay_days),
      is_counterfeit = COALESCE(?, is_counterfeit),
      authenticity_result = COALESCE(?, authenticity_result),
      outcome_recorded = CASE WHEN ? IS NOT NULL OR ? IS NOT NULL OR ? IS NOT NULL THEN 1 ELSE outcome_recorded END
    WHERE analysis_id = ?
  `).run(
    now,
    decision,
    conditionValidated || null,
    JSON.stringify(validatedDetection),
    priceActualBuy ?? null,
    priceActualSell ?? null,
    resaleDelayDays ?? null,
    isCounterfeit != null ? (isCounterfeit ? 1 : 0) : null,
    authResult || null,
    priceActualBuy ?? null,
    priceActualSell ?? null,
    resaleDelayDays ?? null,
    analysisId
  );

  logFeedbackEntry({
    analysisId,
    feedbackType: decision === "approved" ? "validation" : decision === "rejected" ? "rejection" : "correction",
    fieldName: "admin_decision",
    aiValue: record.adminDecision,
    correctedValue: decision,
    reason,
    adminNote
  });

  let training = { added: 0 };
  if (["approved", "corrected"].includes(decision)) {
    training = applyFeedbackToTraining(analysisId, {
      detection: validatedDetection,
      conditionValidated,
      prices,
      reason,
      adminNote
    });
  }

  if (priceActualBuy > 0 || priceActualSell > 0) {
    const analysis = getAnalysis(analysisId);
    try {
      ingestAdminFeedbackOutcome({
        analysisId,
        cardId: analysis?.cardId,
        detection: validatedDetection,
        priceActualBuy,
        priceActualSell,
        resaleDelayDays,
        condition: conditionValidated
      });
    } catch (e) { console.warn("[Market] ingest feedback:", e.message); }
  }

  return { record: getLearningRecord(analysisId), training };
}

export function getSimilarTrainingExamples({ license, extension, number, rarity, fingerprint, limit = 8 }) {
  const db = getDb();
  const fp = fingerprint || makeFingerprint({ license, extension, number, rarity });
  const params = [];
  let sql = `
    SELECT license_slug, extension, rarity, fingerprint, detection_json, condition_json, prices_json, weight, source
    FROM ai_training_examples WHERE 1=1
  `;

  if (fp) {
    sql += " AND (fingerprint = ? OR fingerprint LIKE ?)";
    params.push(fp, `%${String(number || "").toLowerCase()}%`);
  } else if (license) {
    sql += " AND license_slug = ?";
    params.push(license);
  }

  sql += " ORDER BY weight DESC, created_at DESC LIMIT ?";
  params.push(Math.min(limit, 30));

  return db.prepare(sql).all(...params).map((r) => ({
    license: r.license_slug,
    extension: r.extension,
    rarity: r.rarity,
    fingerprint: r.fingerprint,
    detection: parseJson(r.detection_json),
    condition: parseJson(r.condition_json),
    prices: parseJson(r.prices_json),
    weight: r.weight,
    source: r.source
  }));
}

export function getFeedbackHistory(analysisId, limit = 30) {
  return getDb().prepare(`
    SELECT id, feedback_type AS type, field_name AS field, ai_value AS aiValue,
      corrected_value AS correctedValue, reason, admin_note AS adminNote, created_at AS createdAt
    FROM ai_feedback_log WHERE analysis_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(analysisId, limit);
}

export function listLearningRecords({ limit = 100, decision } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM ai_learning_records";
  const params = [];
  if (decision) { sql += " WHERE admin_decision = ?"; params.push(decision); }
  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map(mapLearningRecord);
}

export function getTrainingPoolStats() {
  const db = getDb();
  return {
    totalExamples: db.prepare("SELECT COUNT(*) AS c FROM ai_training_examples").get()?.c ?? 0,
    totalRecords: db.prepare("SELECT COUNT(*) AS c FROM ai_learning_records").get()?.c ?? 0,
    evaluated: db.prepare("SELECT COUNT(*) AS c FROM ai_learning_records WHERE admin_decision != 'pending'").get()?.c ?? 0,
    withOutcomes: db.prepare("SELECT COUNT(*) AS c FROM ai_learning_records WHERE outcome_recorded = 1").get()?.c ?? 0,
    feedbackEntries: db.prepare("SELECT COUNT(*) AS c FROM ai_feedback_log").get()?.c ?? 0
  };
}
