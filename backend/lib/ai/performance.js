/**
 * Historique et métriques de performance IA Cardoria — admin uniquement.
 */
import { getDb } from "../engine/database.js";
import { listLearningRecords, getFeedbackHistory } from "./learning.js";

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function parseJson(str, fallback = {}) {
  try { return JSON.parse(str || JSON.stringify(fallback)); } catch { return fallback; }
}

function priceAccuracy(ai, actual) {
  if (ai == null || actual == null || !actual) return null;
  const err = Math.abs(ai - actual) / actual;
  return Math.max(0, round1(100 - err * 100));
}

function evaluateRecord(r) {
  const detAi = parseJson(r.detection_ai_json);
  const detVal = parseJson(r.detection_validated_json);
  const hasValidated = Object.keys(detVal).length > 0;
  const decision = r.admin_decision;

  let detectionOk = null;
  if (decision === "approved" && !hasValidated) detectionOk = true;
  else if (decision === "rejected") detectionOk = false;
  else if (hasValidated) {
    const keys = ["name", "extension", "number"];
    detectionOk = keys.every((k) => {
      const a = String(detAi[k] || "").toLowerCase().trim();
      const b = String(detVal[k] || detAi[k] || "").toLowerCase().trim();
      return !b || a === b;
    });
  }

  let conditionOk = null;
  if (r.condition_validated && r.condition_estimated) {
    conditionOk = String(r.condition_estimated).toLowerCase() === String(r.condition_validated).toLowerCase();
  } else if (decision === "approved") conditionOk = true;

  const priceAcc = priceAccuracy(r.price_ai_resell, r.price_actual_sell)
    ?? priceAccuracy(r.price_ai_avg, r.price_actual_sell);

  let counterfeitOk = null;
  if (decision !== "pending") {
    const aiSuspicious = r.authenticity_result === "suspicious" || r.is_counterfeit === 1;
    const adminFake = r.is_counterfeit === 1 || r.authenticity_result === "counterfeit";
    counterfeitOk = aiSuspicious === adminFake || (decision === "approved" && !adminFake);
  }

  const overallOk = decision === "approved" || (decision === "corrected" && detectionOk !== false);

  return {
    id: r.analysis_id,
    license: r.license_slug,
    extension: r.extension,
    rarity: r.rarity,
    decision,
    detectionOk,
    conditionOk,
    priceAcc,
    counterfeitOk,
    overallOk,
    month: (r.updated_at || r.created_at || "").slice(0, 7)
  };
}

function aggregateAccuracy(records, key) {
  const vals = records.map((e) => e[key]).filter((v) => v != null);
  if (!vals.length) return null;
  const pct = (vals.filter(Boolean).length / vals.length) * 100;
  return key === "priceAcc"
    ? round1(vals.reduce((s, v) => s + v, 0) / vals.length)
    : round1(pct);
}

function groupBy(records, field) {
  const map = {};
  records.forEach((r) => {
    const k = r[field] || "autre";
    if (!map[k]) map[k] = [];
    map[k].push(r);
  });
  return map;
}

export function computePerformanceMetrics() {
  const rows = getDb().prepare(`
    SELECT * FROM ai_learning_records WHERE admin_decision != 'pending' ORDER BY updated_at DESC
  `).all();

  const evaluated = rows.map(evaluateRecord);
  const successRate = aggregateAccuracy(evaluated, "overallOk");

  const byLicense = {};
  Object.entries(groupBy(evaluated, "license")).forEach(([k, list]) => {
    byLicense[k] = {
      count: list.length,
      detection: aggregateAccuracy(list, "detectionOk"),
      price: aggregateAccuracy(list, "priceAcc"),
      counterfeit: aggregateAccuracy(list, "counterfeitOk"),
      success: aggregateAccuracy(list, "overallOk")
    };
  });

  const byExtension = {};
  Object.entries(groupBy(evaluated, "extension")).forEach(([k, list]) => {
    if (!k || list.length < 2) return;
    byExtension[k] = {
      count: list.length,
      detection: aggregateAccuracy(list, "detectionOk"),
      price: aggregateAccuracy(list, "priceAcc"),
      success: aggregateAccuracy(list, "overallOk")
    };
  });

  const byRarity = {};
  Object.entries(groupBy(evaluated, "rarity")).forEach(([k, list]) => {
    if (!k) return;
    byRarity[k] = {
      count: list.length,
      detection: aggregateAccuracy(list, "detectionOk"),
      price: aggregateAccuracy(list, "priceAcc"),
      success: aggregateAccuracy(list, "overallOk")
    };
  });

  return {
    global: {
      totalRecords: rows.length + getDb().prepare("SELECT COUNT(*) AS c FROM ai_learning_records WHERE admin_decision = 'pending'").get()?.c,
      evaluated: evaluated.length,
      successRate,
      detectionAccuracy: aggregateAccuracy(evaluated, "detectionOk"),
      priceAccuracy: aggregateAccuracy(evaluated, "priceAcc"),
      counterfeitAccuracy: aggregateAccuracy(evaluated, "counterfeitOk"),
      conditionAccuracy: aggregateAccuracy(evaluated, "conditionOk")
    },
    byLicense,
    byExtension,
    byRarity
  };
}

export function computeMonthlyEvolution(months = 12) {
  const rows = getDb().prepare(`
    SELECT * FROM ai_learning_records WHERE admin_decision != 'pending' ORDER BY updated_at ASC
  `).all();

  const evaluated = rows.map(evaluateRecord);
  const byMonth = groupBy(evaluated, "month");
  const sorted = Object.keys(byMonth).sort().slice(-months);

  return sorted.map((month) => {
    const list = byMonth[month];
    return {
      month,
      total: list.length,
      successRate: aggregateAccuracy(list, "overallOk"),
      detectionAccuracy: aggregateAccuracy(list, "detectionOk"),
      priceAccuracy: aggregateAccuracy(list, "priceAcc"),
      counterfeitAccuracy: aggregateAccuracy(list, "counterfeitOk")
    };
  });
}

export function getFrequentErrors(limit = 10) {
  const db = getDb();
  const fieldErrors = db.prepare(`
    SELECT field_name AS field, COUNT(*) AS count,
      GROUP_CONCAT(DISTINCT reason) AS reasons
    FROM ai_feedback_log
    WHERE feedback_type IN ('correction', 'rejection') AND field_name != '' AND field_name != 'admin_decision'
    GROUP BY field_name ORDER BY count DESC LIMIT ?
  `).all(limit);

  const reasonErrors = db.prepare(`
    SELECT reason, COUNT(*) AS count
    FROM ai_feedback_log
    WHERE reason != '' AND feedback_type != 'training_applied'
    GROUP BY reason ORDER BY count DESC LIMIT ?
  `).all(limit);

  const rejected = db.prepare(`
    SELECT license_slug AS license, extension, card_name AS name, COUNT(*) AS count
    FROM ai_learning_records WHERE admin_decision = 'rejected'
    GROUP BY license_slug, extension, card_name ORDER BY count DESC LIMIT ?
  `).all(5);

  return { fieldErrors, reasonErrors, frequentRejections: rejected };
}

export function getImprovementSuggestions(metrics) {
  const m = metrics || computePerformanceMetrics();
  const suggestions = [];

  if ((m.global.evaluated || 0) < 10) {
    suggestions.push({
      priority: "high",
      title: "Enrichir le jeu de données",
      detail: "Moins de 10 estimations validées. Validez ou corrigez davantage d'analyses pour activer l'apprentissage fiable."
    });
  }

  if (m.global.detectionAccuracy != null && m.global.detectionAccuracy < 85) {
    suggestions.push({
      priority: "high",
      title: "Améliorer la reconnaissance visuelle",
      detail: "Précision détection sous 85 %. Ajoutez des corrections avec photos recto/verso et raison détaillée."
    });
  }

  if (m.global.priceAccuracy != null && m.global.priceAccuracy < 80) {
    suggestions.push({
      priority: "medium",
      title: "Calibrer les prix réels",
      detail: "Renseignez les prix réellement achetés et revendus pour affiner le moteur achat/revente."
    });
  }

  if (m.global.counterfeitAccuracy != null && m.global.counterfeitAccuracy < 90) {
    suggestions.push({
      priority: "high",
      title: "Renforcer la détection contrefaçon",
      detail: "Indiquez systématiquement contrefaçon oui/non après examen manuel."
    });
  }

  Object.entries(m.byLicense || {}).forEach(([lic, data]) => {
    if (data.count >= 3 && data.success != null && data.success < 75) {
      suggestions.push({
        priority: "medium",
        title: `Licence ${lic}`,
        detail: `Taux de réussite ${data.success} % sur ${data.count} cas — prioriser les corrections sur cette licence.`
      });
    }
  });

  const errors = getFrequentErrors(5);
  errors.fieldErrors.slice(0, 3).forEach((e) => {
    suggestions.push({
      priority: "low",
      title: `Erreur fréquente : ${e.field}`,
      detail: `${e.count} correction(s). Vérifier le prompt et les exemples few-shot pour ce champ.`
    });
  });

  if (!suggestions.length) {
    suggestions.push({
      priority: "low",
      title: "Performance satisfaisante",
      detail: "Continuez à valider les estimations et enregistrer les prix réels pour consolider le modèle."
    });
  }

  return suggestions;
}

export function cacheMonthlyPerformance() {
  const db = getDb();
  const monthly = computeMonthlyEvolution(24);
  const now = new Date().toISOString();

  const ins = db.prepare(`
    INSERT INTO ai_performance_monthly (month, total_evaluated, success_rate, detection_accuracy, price_accuracy, counterfeit_accuracy, metrics_json, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(month) DO UPDATE SET
      total_evaluated = excluded.total_evaluated,
      success_rate = excluded.success_rate,
      detection_accuracy = excluded.detection_accuracy,
      price_accuracy = excluded.price_accuracy,
      counterfeit_accuracy = excluded.counterfeit_accuracy,
      metrics_json = excluded.metrics_json,
      computed_at = excluded.computed_at
  `);

  monthly.forEach((m) => {
    ins.run(m.month, m.total, m.successRate, m.detectionAccuracy, m.priceAccuracy, m.counterfeitAccuracy, JSON.stringify(m), now);
  });

  return { cached: monthly.length };
}

export function getPerformanceDashboard() {
  const metrics = computePerformanceMetrics();
  return {
    metrics,
    monthly: computeMonthlyEvolution(12),
    errors: getFrequentErrors(8),
    suggestions: getImprovementSuggestions(metrics),
    pool: {
      pending: getDb().prepare("SELECT COUNT(*) AS c FROM ai_learning_records WHERE admin_decision = 'pending'").get()?.c ?? 0
    },
    recentFeedback: getDb().prepare(`
      SELECT f.analysis_id AS analysisId, f.field_name AS field, f.reason, f.created_at AS createdAt,
        r.license_slug AS license, r.card_name AS cardName
      FROM ai_feedback_log f
      LEFT JOIN ai_learning_records r ON r.analysis_id = f.analysis_id
      ORDER BY f.created_at DESC LIMIT 15
    `).all()
  };
}

export { listLearningRecords, getFeedbackHistory };
