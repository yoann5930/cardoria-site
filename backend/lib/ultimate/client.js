/**
 * Vue client Ultimate — données publiques uniquement.
 */
import { getCardById } from "../engine/cards.js";
import { getPriceComparison } from "./comparator.js";
import { getInvestmentAdvice } from "./advisor.js";
import { getUltimateHistory, PERIODS } from "./history.js";
import { detectExceptionalTraits, buildClientExceptionalAlert } from "./exceptional.js";
import { getPredictions } from "../ai-enterprise/predict.js";

export function buildUltimateClientView(cardId, { detection = null, cardNotes = "" } = {}) {
  const card = getCardById(cardId);
  if (!card) return null;

  const comparison = getPriceComparison(cardId);
  const advice = getInvestmentAdvice(cardId);
  const predictions = getPredictions(cardId);
  const exceptional = buildClientExceptionalAlert(
    detectExceptionalTraits({ cardId, detection, cardNotes })
  );

  const historyPeriods = ["7", "30", "90", "180", "365", "1095", "1825", "max"];
  const history = {};
  historyPeriods.forEach((p) => {
    const h = getUltimateHistory(cardId, p);
    history[p] = {
      label: periodLabel(p),
      points: (h.points || []).map((pt) => ({ date: pt.date, price: pt.price }))
    };
  });

  return {
    card: {
      id: card.id,
      name: card.name,
      license: card.license,
      extension: card.extension,
      number: card.number,
      rarity: card.rarity
    },
    priceComparison: comparison ? {
      cardmarket: comparison.prices.cardmarket,
      ebay: comparison.prices.ebay,
      pricecharting: comparison.prices.pricecharting,
      tcgplayer: comparison.prices.tcgplayer,
      psa: comparison.prices.psa,
      worldAverage: comparison.prices.worldAverage,
      globalIndex: comparison.globalIndex,
      currency: comparison.currency
    } : null,
    investment: advice ? {
      action: advice.primaryAction,
      tags: advice.tags,
      confidence: advice.confidence
    } : null,
    exceptionalAlert: exceptional,
    history,
    defaultHistoryPeriod: "30",
    forecast: predictions ? {
      horizons: (predictions.forecasts || []).map((f) => ({
        label: f.horizon,
        price: f.price,
        confidence: f.confidencePercent
      }))
    } : null
  };
}

function periodLabel(key) {
  const map = {
    "7": "7 jours", "30": "30 jours", "90": "90 jours", "180": "6 mois",
    "365": "1 an", "1095": "3 ans", "1825": "5 ans", max: "Maximum"
  };
  return map[key] || key;
}

export function getUltimateClientByCardId(cardId) {
  return buildUltimateClientView(cardId);
}

export { PERIODS };
