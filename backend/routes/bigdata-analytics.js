/**
 * API Analytics Big Data Cardoria — exploitable admin, SEO, IA, Marketplace.
 */
import { Router } from "express";
import {
  buildAnalyticsOverview,
  buildCardAnalytics,
  buildSeoAnalyticsPayload,
  buildMarketplaceAnalyticsPayload,
  buildIaAnalyticsPayload,
  getPriceEvolution,
  getHeatmap,
  getBigDataTrends,
  getGlobalIndicesSummary,
  getCardMetrics,
  getAiStats,
  getHeatmapRegionLabels,
  ingestBigDataRecord
} from "../lib/bigdata/index.js";
import { getCardById } from "../lib/engine/cards.js";

const router = Router();

router.get("/overview", (req, res) => {
  try {
    res.json({ ok: true, analytics: buildAnalyticsOverview() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/indices", (req, res) => {
  try {
    res.json({ ok: true, global: getGlobalIndicesSummary() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/evolution", (req, res) => {
  try {
    res.json({
      ok: true,
      evolution: getPriceEvolution({
        region: req.query.region || "world",
        limit: Number(req.query.limit) || 90
      })
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/heatmap", (req, res) => {
  try {
    res.json({ ok: true, labels: getHeatmapRegionLabels(), heatmap: getHeatmap() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/trends", (req, res) => {
  try {
    res.json({
      ok: true,
      trends: getBigDataTrends({ type: req.query.type, limit: Number(req.query.limit) || 40 })
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/ai-stats", (req, res) => {
  try {
    res.json({ ok: true, stats: getAiStats(req.query.refresh === "1") });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/card/:cardId", (req, res) => {
  try {
    if (!getCardById(req.params.cardId)) {
      return res.status(404).json({ ok: false, error: "Carte introuvable." });
    }
    res.json({ ok: true, analytics: buildCardAnalytics(req.params.cardId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/card/:cardId/metrics", (req, res) => {
  try {
    res.json({ ok: true, metrics: getCardMetrics(req.params.cardId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/feeds/seo", (req, res) => {
  try {
    res.json({ ok: true, feed: buildSeoAnalyticsPayload() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/feeds/marketplace", (req, res) => {
  try {
    res.json({ ok: true, feed: buildMarketplaceAnalyticsPayload() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/feeds/ia", (req, res) => {
  try {
    res.json({ ok: true, feed: buildIaAnalyticsPayload() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/ingest", (req, res) => {
  try {
    const body = req.body || {};
    const result = ingestBigDataRecord({
      sourceType: body.sourceType || "api",
      sourceId: body.sourceId || `API-${Date.now()}`,
      cardId: body.cardId,
      license: body.license,
      extension: body.extension,
      number: body.number,
      language: body.language,
      condition: body.condition,
      rarity: body.rarity,
      countryCode: body.countryCode,
      email: body.email,
      authenticity: body.authenticity,
      priceEstimated: body.priceEstimated,
      priceMarket: body.priceMarket,
      priceBuyAdvised: body.priceBuyAdvised,
      priceSellAdvised: body.priceSellAdvised,
      aiScore: body.aiScore,
      counterfeitScore: body.counterfeitScore
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
