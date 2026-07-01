/**
 * Cardoria Ultimate Enterprise — point d'entrée.
 */
import { migrateUltimate } from "./migrate.js";
import { computePriceComparison, getPriceComparison } from "./comparator.js";
import { computeInvestmentAdvice, getInvestmentAdvice } from "./advisor.js";
import {
  detectExceptionalTraits, recordExceptionalAlerts, getExceptionalAlertsForCard,
  getRecentExceptionalAlerts, buildClientExceptionalAlert
} from "./exceptional.js";
import { getUltimateHistory, getAllUltimateHistories, PERIODS } from "./history.js";
import { parseNaturalLanguageQuery, searchNaturalLanguage, getTopNaturalSearches } from "./search.js";
import { buildUltimateDashboard, getUltimateDashboard, getUltimateStatsSummary, getScaleMeta } from "./dashboard.js";
import { buildUltimateClientView, getUltimateClientByCardId } from "./client.js";
import { startUltimateWorker, runUltimateWorker, getUltimateWorkerStatus } from "./worker.js";

export function initUltimate() {
  migrateUltimate();
  startUltimateWorker();
}

export {
  computePriceComparison,
  getPriceComparison,
  computeInvestmentAdvice,
  getInvestmentAdvice,
  detectExceptionalTraits,
  recordExceptionalAlerts,
  getExceptionalAlertsForCard,
  getRecentExceptionalAlerts,
  buildClientExceptionalAlert,
  getUltimateHistory,
  getAllUltimateHistories,
  PERIODS,
  parseNaturalLanguageQuery,
  searchNaturalLanguage,
  getTopNaturalSearches,
  buildUltimateDashboard,
  getUltimateDashboard,
  getUltimateStatsSummary,
  getScaleMeta,
  buildUltimateClientView,
  getUltimateClientByCardId,
  runUltimateWorker,
  getUltimateWorkerStatus
};
