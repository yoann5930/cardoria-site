/**
 * IA Enterprise auto-apprenante — point d'entrée.
 */
import { migrateAiEnterprise } from "./migrate.js";
import { recordEnterpriseEstimation, recordActualSaleOutcomeSync, listEnterpriseHistory } from "./record.js";
import { computeReliabilityForCard, getReliability, refreshAllReliabilityScores } from "./reliability.js";
import { applyAutoAdjustmentFromSale, processPendingSaleAdjustments } from "./autoadjust.js";
import { computePredictionsForCard, getPredictions, refreshAllPredictions } from "./predict.js";
import { detectTrendSignals, getTrendSignals, getCardoriaTrendIndex, computeCardoriaTrendIndex } from "./trends.js";
import { buildEnterpriseDashboard, getEnterpriseDashboard, getEnterpriseStatsSummary } from "./dashboard.js";
import { buildEnterpriseClientView, getEnterpriseClientByCardId } from "./client.js";
import { startEnterpriseWorker, runEnterpriseWorker, scheduleEnterpriseWorker, getWorkerStatus } from "./worker.js";

export function initAiEnterprise() {
  migrateAiEnterprise();
  startEnterpriseWorker();
}

export {
  recordEnterpriseEstimation,
  recordActualSaleOutcomeSync,
  listEnterpriseHistory,
  computeReliabilityForCard,
  getReliability,
  refreshAllReliabilityScores,
  applyAutoAdjustmentFromSale,
  processPendingSaleAdjustments,
  computePredictionsForCard,
  getPredictions,
  refreshAllPredictions,
  detectTrendSignals,
  getTrendSignals,
  getCardoriaTrendIndex,
  computeCardoriaTrendIndex,
  buildEnterpriseDashboard,
  getEnterpriseDashboard,
  getEnterpriseStatsSummary,
  buildEnterpriseClientView,
  getEnterpriseClientByCardId,
  runEnterpriseWorker,
  scheduleEnterpriseWorker,
  getWorkerStatus
};
