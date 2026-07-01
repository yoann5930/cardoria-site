/**
 * API Analytics unifiée — payload pour admin, SEO, IA, Marketplace.
 */
import { getBigDataRecordCount, runFullIngestSync } from "./ingest.js";
import { getGlobalIndicesSummary, getCardMetrics } from "./indices.js";
import { getGlobalPriceEvolutionSummary, getPriceEvolution } from "./evolution.js";
import { getBigDataTrends } from "./trends.js";
import { getHeatmap } from "./heatmap.js";
import { getAiStats } from "./aiStats.js";
import { getOrCompute } from "./cache.js";

export function buildAnalyticsOverview() {
  return getOrCompute("analytics:overview", () => ({
    computedAt: new Date().toISOString(),
    records: getBigDataRecordCount(),
    globalIndices: getGlobalIndicesSummary(),
    priceEvolution: getGlobalPriceEvolutionSummary(),
    aiStats: getAiStats(),
    heatmap: getHeatmap(),
    trends: getBigDataTrends({ limit: 20 })
  }), 1800);
}

export function buildCardAnalytics(cardId) {
  return getOrCompute(`analytics:card:${cardId}`, () => ({
    cardId,
    metrics: getCardMetrics(cardId),
    priceEvolution: getPriceEvolution({ region: "world", limit: 60 }),
    trends: getBigDataTrends({ limit: 50 }).filter((t) => t.entityId === cardId)
  }), 3600);
}

export function buildSeoAnalyticsPayload() {
  return getOrCompute("analytics:seo", () => {
    const stats = getAiStats();
    const evolution = getGlobalPriceEvolutionSummary();
    const trends = getBigDataTrends({ limit: 10 });
    return {
      totalEstimations: stats.estimations,
      marketTrendPercent: evolution.trendPercent,
      topLicenses: stats.topLicenses?.slice(0, 5) || [],
      trendingCards: trends.filter((t) => t.entityType === "card").slice(0, 5)
    };
  }, 7200);
}

export function buildMarketplaceAnalyticsPayload() {
  return getOrCompute("analytics:marketplace", () => ({
    globalIndices: getGlobalIndicesSummary(),
    heatmap: getHeatmap(),
    hotExtensions: getBigDataTrends({ type: "extension_hot", limit: 15 })
  }), 1800);
}

export function buildIaAnalyticsPayload() {
  return getOrCompute("analytics:ia", () => ({
    aiStats: getAiStats(),
    errorRatePercent: getAiStats().errorRatePercent,
    counterfeitRatePercent: getAiStats().counterfeitRatePercent,
    globalIndices: getGlobalIndicesSummary()
  }), 1800);
}

export function buildAdminDashboardPayload({ refresh = false } = {}) {
  if (refresh) {
    runFullIngestSync();
    invalidateCache("analytics:");
  }
  return buildAnalyticsOverview();
}
