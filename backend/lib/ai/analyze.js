/**
 * Pipeline IA Premium Cardoria — analyse complète.
 */
import OpenAI from "openai";
import { CONFIDENCE_THRESHOLD, sendEmail, sendCounterfeitAlert, extractSuspicionReasons } from "../email.js";
import { logAudit } from "../audit.js";
import { buildPremiumPrompt, parseAiResponse, normalizeLicense } from "./prompts.js";
import { normalizeCondition } from "./condition.js";
import { buildSmartEstimate, formatClientEstimateBlock, flattenPricing, toClientEstimate } from "./smart-estimate.js";
import { buildCardoriaIntelligence, toClientIntelligence } from "./intelligence.js";
import { ingestEstimationOutcome } from "../market/ingest.js";
import { recordPriceSnapshot, seedPriceHistoryIfEmpty, getPriceHistory } from "./history.js";
import { computeTrendForCard } from "./trends.js";
import { saveAnalysis, getTrainingExamples } from "./training.js";
import { makeAnalysisId } from "./migrate.js";
import { recordEnterpriseEstimation, buildEnterpriseClientView } from "../ai-enterprise/index.js";

export async function analyzeCardPremium(data) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY manquante sur Render.");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const trainingExamples = getTrainingExamples(8, {
    license: normalizeLicense(data.cardGame),
    extension: data.cardExtension,
    number: data.cardNumber
  });
  const content = [{ type: "input_text", text: buildPremiumPrompt(data, trainingExamples) }];

  for (const img of (data.imagesBase64 || []).slice(0, 6)) {
    if (typeof img === "string" && img.startsWith("data:image")) {
      content.push({ type: "input_image", image_url: img });
    }
  }

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [{ role: "user", content }]
  });

  const rawResult = response.output_text || "";
  const parsed = parseAiResponse(rawResult);
  const condition = normalizeCondition(parsed.condition);
  const detection = {
    ...parsed.detection,
    license: normalizeLicense(parsed.detection.license || data.cardGame)
  };

  const confidenceScore = parsed.confidenceScore;
  const suspicionAlert = confidenceScore != null && confidenceScore < CONFIDENCE_THRESHOLD;
  const suspicionReasons = suspicionAlert ? extractSuspicionReasons(rawResult) : [];

  const estimate = buildSmartEstimate({
    detection,
    conditionGrade: condition.label,
    cardId: data.cardId,
    suspicionAlert,
    confidenceScore
  });

  const intelligence = buildCardoriaIntelligence(estimate, { suspicionAlert, confidenceScore });
  const pricing = flattenPricing(estimate, intelligence);
  let clientResult = parsed.clientMessage + formatClientEstimateBlock(estimate, intelligence);

  let trend = null;
  let historyPreview = null;
  if (estimate.cardId) {
    seedPriceHistoryIfEmpty(estimate.cardId, pricing.resell || pricing.avg);
    recordPriceSnapshot(estimate.cardId, {
      low: pricing.market?.low ?? pricing.low,
      avg: pricing.market?.avg ?? pricing.avg,
      high: pricing.market?.high ?? pricing.high,
      recommended: pricing.resell || pricing.avg
    });
    trend = computeTrendForCard(estimate.cardId, estimate.card?.name, detection.license);
    historyPreview = getPriceHistory(estimate.cardId, "30");
  }

  const id = makeAnalysisId();
  const record = {
    id,
    createdAt: new Date().toISOString(),
    customerName: data.customerName || "",
    customerEmail: data.customerEmail || "",
    customerNotes: data.cardNotes || "",
    cardId: estimate.cardId,
    photosCount: (data.imagesBase64 || []).length,
    confidenceScore,
    suspicionAlert,
    suspicionReasons,
    conditionGrade: condition.label,
    clientMessage: clientResult,
    rawResponse: rawResult,
    status: suspicionAlert ? "Alerte contrefaçon" : "Analyse effectuée",
    detection,
    prices: pricing,
    intelligence,
    trade: estimate.trade,
    trends: trend || {},
    imagesBase64: (data.imagesBase64 || []).slice(0, 6)
  };

  saveAnalysis(record);

  if (estimate.cardId && !suspicionAlert) {
    try {
      ingestEstimationOutcome({
        analysisId: id,
        cardId: estimate.cardId,
        detection,
        buybackPrice: pricing.buyback,
        salePrice: pricing.resell,
        condition: condition.label,
        language: detection.language
      });
    } catch (e) { console.warn("[Market] ingest estimation:", e.message); }

    try {
      recordEnterpriseEstimation({
        analysisId: id,
        cardId: estimate.cardId,
        detection,
        conditionGrade: condition.label,
        pricing,
        intelligence,
        confidenceScore,
        source: "estimation"
      });
    } catch (e) { console.warn("[AI Enterprise] record:", e.message); }
  }

  logAudit({
    type: "ai",
    action: suspicionAlert ? "alerte_contrefacon" : "analyse_premium",
    user: data.customerEmail || "client",
    detail: `${id} — ${detection.name || data.cardName}`
  });

  await sendEmail({
    subject: `Cardoria IA — Analyse ${id}`,
    text: `${record.customerName}\n${record.customerEmail}\n${JSON.stringify(detection, null, 2)}\n\n${clientResult}`
  });

  if (suspicionAlert) {
    await sendCounterfeitAlert(
      {
        id,
        customerName: record.customerName,
        customerEmail: record.customerEmail,
        cardGame: detection.license,
        cardName: detection.name || data.cardName,
        cardNotes: data.cardNotes,
        detection,
        condition: condition.label,
        suspicionReasons
      },
      rawResult,
      confidenceScore,
      data.imagesBase64
    );
    logAudit({ type: "security", action: "email_alerte_contrefacon", user: "system", detail: `${id} — ${confidenceScore}%` });
  }

  const enterprise = buildEnterpriseClientView({
    cardId: estimate.cardId,
    intelligence,
    pricing,
    detection
  });

  return {
    ok: true,
    id,
    clientResult,
    detection: {
      license: detection.license,
      name: detection.name,
      extension: detection.extension,
      number: detection.number,
      rarity: detection.rarity,
      language: detection.language,
      version: detection.version
    },
    condition: condition.label,
    estimate: toClientEstimate(estimate, intelligence),
    intelligence: toClientIntelligence(intelligence),
    enterprise,
    cardId: estimate.cardId,
    trend: trend ? { direction: trend.direction, changePercent: trend.changePercent } : null,
    history: historyPreview ? { period: "30", points: historyPreview.points.slice(-14) } : null
  };
}

export { getPriceHistory } from "./history.js";
export { getTrends, refreshAllTrends } from "./trends.js";
export { buildCardoriaIntelligence, buildIntelligenceForCard, toClientIntelligence } from "./intelligence.js";
