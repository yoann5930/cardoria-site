/**
 * Moteur de données de marché Cardoria — init & exports.
 */
import { migrateMarketData, purgeEstimatedMarketPollution } from "./migrate.js";
import { importLegacySalesHistory } from "./record.js";
import { recomputeAllCardStats } from "./stats.js";

let initialized = false;

export function initMarketData() {
  migrateMarketData();
  if (!initialized) {
    const cleanup = purgeEstimatedMarketPollution();
    cleanup.affectedCardIds.forEach((cardId) => recomputeCardStats(cardId));

    const { imported } = importLegacySalesHistory();
    if (imported > 0) {
      recomputeAllCardStats();
    }

    if (cleanup.removedTransactions > 0 || cleanup.removedLegacySales > 0) {
      console.log("[market-data] estimation pollution removed", {
        transactions: cleanup.removedTransactions,
        legacySales: cleanup.removedLegacySales,
        cards: cleanup.affectedCardIds.length
      });
    }
    initialized = true;
  }
  return { ok: true, module: "cardoria-market-data" };
}

export { recordMarketTransaction, importLegacySalesHistory } from "./record.js";
export {
  getCardMarketStats,
  recomputeCardStats,
  recomputeAllCardStats,
  getMarketDashboard,
  listRecentTransactions
} from "./stats.js";
export { computeIndicesFromStats } from "./indices.js";
export {
  ingestMarketplaceOrder,
  ingestEstimationOutcome,
  ingestAdminFeedbackOutcome,
  ingestAdminManualSale
} from "./ingest.js";
