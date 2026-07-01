/**
 * Cardoria Big Data Engine — point d'entrée.
 */
import { migrateBigData } from "./migrate.js";
import {
  ingestBigDataRecord, runFullIngestSync, syncFromAiAnalyses,
  syncFromEnterpriseHistory, syncFromScannerScans, getBigDataRecordCount
} from "./ingest.js";
import { computeCardMetrics, getCardMetrics, refreshAllCardMetrics, getGlobalIndicesSummary } from "./indices.js";
import { computePriceEvolution, getPriceEvolution, getGlobalPriceEvolutionSummary } from "./evolution.js";
import { computeBigDataTrends, getBigDataTrends, SIGNAL_TYPES } from "./trends.js";
import { computeHeatmap, getHeatmap, getHeatmapForRegion } from "./heatmap.js";
import { computeAiStats, getAiStats } from "./aiStats.js";
import { setCache, getCache, getOrCompute, invalidateCache } from "./cache.js";
import {
  buildAnalyticsOverview, buildCardAnalytics, buildSeoAnalyticsPayload,
  buildMarketplaceAnalyticsPayload, buildIaAnalyticsPayload, buildAdminDashboardPayload
} from "./analytics.js";
import { startBigDataWorker, runBigDataWorker, getBigDataWorkerStatus } from "./worker.js";
import { getHeatmapRegionLabels, REGION_BUCKETS } from "./regions.js";

export function initBigData() {
  migrateBigData();
  startBigDataWorker();
}

export {
  ingestBigDataRecord,
  runFullIngestSync,
  syncFromAiAnalyses,
  syncFromEnterpriseHistory,
  syncFromScannerScans,
  getBigDataRecordCount,
  computeCardMetrics,
  getCardMetrics,
  refreshAllCardMetrics,
  getGlobalIndicesSummary,
  computePriceEvolution,
  getPriceEvolution,
  getGlobalPriceEvolutionSummary,
  computeBigDataTrends,
  getBigDataTrends,
  SIGNAL_TYPES,
  computeHeatmap,
  getHeatmap,
  getHeatmapForRegion,
  computeAiStats,
  getAiStats,
  setCache,
  getCache,
  getOrCompute,
  invalidateCache,
  buildAnalyticsOverview,
  buildCardAnalytics,
  buildSeoAnalyticsPayload,
  buildMarketplaceAnalyticsPayload,
  buildIaAnalyticsPayload,
  buildAdminDashboardPayload,
  runBigDataWorker,
  getBigDataWorkerStatus,
  getHeatmapRegionLabels,
  REGION_BUCKETS
};
