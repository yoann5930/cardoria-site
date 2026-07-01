/**
 * IA Conseiller d'investissement Cardoria Ultimate.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";
import { getPredictions } from "../ai-enterprise/predict.js";
import { getPriceComparison } from "./comparator.js";

const TAGS = {
  BUY_NOW: { code: "ACHETER_MAINTENANT", label: "Acheter maintenant" },
  WAIT: { code: "ATTENDRE", label: "Attendre" },
  RESELL: { code: "REVENDRE", label: "Revendre" },
  GREAT: { code: "TRES_BON_INVESTISSEMENT", label: "Très bon investissement" },
  RISKY: { code: "INVESTISSEMENT_RISQUE", label: "Investissement risqué" },
  GROWTH: { code: "FORTE_CROISSANCE", label: "Forte croissance prévue" },
  LOW: { code: "FAIBLE_POTENTIEL", label: "Faible potentiel" }
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function computeInvestmentAdvice(cardId, { persist = true } = {}) {
  const card = getCardById(cardId);
  if (!card) return null;

  const comparison = getPriceComparison(cardId);
  const predictions = getPredictions(cardId);
  const stats = getDb().prepare("SELECT * FROM market_card_stats WHERE card_id = ?").get(cardId);

  const trend30 = stats?.trend_percent ?? card.trendPercent ?? 0;
  const globalIdx = comparison?.globalIndex?.score ?? 50;
  const forecast90 = predictions?.forecasts?.find((f) => f.days === 90);
  const change90 = forecast90 && predictions.currentPrice
    ? ((forecast90.price - predictions.currentPrice) / predictions.currentPrice) * 100
    : trend30;

  const tags = [];
  let primary = TAGS.WAIT;
  let confidence = 52;

  if (trend30 >= 8 && globalIdx >= 60 && change90 >= 5) {
    primary = TAGS.BUY_NOW;
    tags.push(TAGS.GREAT, TAGS.GROWTH);
    confidence += 18;
  } else if (trend30 <= -10 || globalIdx < 35) {
    primary = TAGS.RESELL;
    tags.push(TAGS.LOW);
    confidence += 12;
  } else if (change90 >= 12) {
    primary = TAGS.BUY_NOW;
    tags.push(TAGS.GROWTH);
    confidence += 14;
  } else if (Math.abs(trend30) < 4 && globalIdx >= 45 && globalIdx <= 65) {
    primary = TAGS.WAIT;
    tags.push(TAGS.LOW);
  }

  if (globalIdx < 40 && trend30 > 0) tags.push(TAGS.RISKY);
  if (stats?.volume != null && stats.volume < 2) {
    tags.push(TAGS.RISKY);
    confidence -= 8;
  }
  if (change90 >= 20) tags.push(TAGS.GREAT);

  const uniqueTags = dedupeTags([primary, ...tags]);
  confidence = clamp(Math.round(confidence + (stats?.volume || 0) * 0.5 + (predictions?.forecasts?.[0]?.confidencePercent || 0) * 0.15), 28, 96);

  const rationale = buildRationale({ trend30, globalIdx, change90, primary });

  const result = {
    cardId,
    primaryAction: { code: primary.code, label: primary.label },
    tags: uniqueTags.filter((t) => t.code !== primary.code).map((t) => ({ code: t.code, label: t.label })),
    confidence,
    rationale,
    computedAt: new Date().toISOString()
  };

  if (persist) {
    getDb().prepare(`
      INSERT INTO ultimate_investment_advice (card_id, primary_action, tags_json, confidence, rationale, computed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(card_id) DO UPDATE SET
        primary_action = excluded.primary_action, tags_json = excluded.tags_json,
        confidence = excluded.confidence, rationale = excluded.rationale, computed_at = excluded.computed_at
    `).run(
      cardId, primary.code, JSON.stringify(result.tags), confidence, rationale, result.computedAt
    );
  }

  return result;
}

function dedupeTags(list) {
  const seen = new Set();
  return list.filter((t) => {
    if (seen.has(t.code)) return false;
    seen.add(t.code);
    return true;
  });
}

function buildRationale({ trend30, globalIdx, change90, primary }) {
  return `Tendance 30j ${trend30.toFixed(1)} % · Indice global ${globalIdx}/100 · Projection 90j ${change90.toFixed(1)} % → ${primary.label}.`;
}

export function getInvestmentAdvice(cardId) {
  const row = getDb().prepare("SELECT * FROM ultimate_investment_advice WHERE card_id = ?").get(cardId);
  if (row) {
    const age = Date.now() - new Date(row.computed_at).getTime();
    if (age < 3600000) {
      return {
        cardId,
        primaryAction: { code: row.primary_action, label: tagLabel(row.primary_action) },
        tags: JSON.parse(row.tags_json || "[]"),
        confidence: row.confidence,
        rationale: row.rationale,
        computedAt: row.computed_at,
        cached: true
      };
    }
  }
  return computeInvestmentAdvice(cardId);
}

function tagLabel(code) {
  return Object.values(TAGS).find((t) => t.code === code)?.label || code;
}
