import { migrateAi } from "./migrate.js";

export function initAi() {
  migrateAi();
  return { ok: true, module: "cardoria-ai-premium", learning: "continuous" };
}

export { analyzeCardPremium, getPriceHistory, getTrends, refreshAllTrends, buildIntelligenceForCard, buildCardoriaIntelligence, toClientIntelligence } from "./analyze.js";
export {
  listAnalyses,
  getAnalysis,
  saveValidation,
  retrainFromValidations,
  updateAnalysisCorrection,
  submitAdminFeedback,
  getTrainingPoolStats
} from "./training.js";
export { getPerformanceDashboard } from "./performance.js";
