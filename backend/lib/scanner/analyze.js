/**
 * Pipeline Scanner Intelligent Cardoria.
 */
import OpenAI from "openai";
import { CONFIDENCE_THRESHOLD, sendCounterfeitAlert, extractSuspicionReasons } from "../email.js";
import { logAudit } from "../audit.js";
import { normalizeCondition } from "../ai/condition.js";
import { buildSmartEstimate, flattenPricing } from "../ai/smart-estimate.js";
import { buildCardoriaIntelligence, toClientIntelligence } from "../ai/intelligence.js";
import { saveAnalysis, getTrainingExamples } from "../ai/training.js";
import { makeAnalysisId } from "../ai/migrate.js";
import { buildScannerPrompt, parseScannerResponse } from "./prompts.js";
import { resolveCatalogLink, createPendingCardProposal } from "./catalog.js";
import { saveScan } from "./store.js";
import { makeScannerId } from "./migrate.js";
import { ingestEstimationOutcome } from "../market/ingest.js";
import { getDb } from "../engine/database.js";
import { recordEnterpriseEstimation, buildEnterpriseClientView } from "../ai-enterprise/index.js";

function collectImages(data) {
  const images = [];
  const sides = [];
  if (data.rectoBase64) { images.push(data.rectoBase64); sides.push("recto"); }
  if (data.versoBase64) { images.push(data.versoBase64); sides.push("verso"); }
  (data.imagesBase64 || []).forEach((img, i) => {
    if (img && img.startsWith("data:image")) {
      images.push(img);
      sides.push("extra_" + (i + 1));
    }
  });
  (data.extraImages || []).forEach((img, i) => {
    if (img && img.startsWith("data:image")) {
      images.push(img);
      sides.push("batch_" + (i + 1));
    }
  });
  return { images: images.slice(0, 6), sides };
}

function buildClientPayload(ctx) {
  const {
    detection, condition, intelligence, catalogLink, suspicionAlert,
    fallback, clientMessage, canOfferBuyback
  } = ctx;

  const intel = intelligence ? toClientIntelligence(intelligence) : {};

  return {
    recognized: {
      license: detection.license,
      name: detection.name,
      extension: detection.extension,
      number: detection.number,
      rarity: detection.rarity,
      language: detection.language,
      version: detection.version
    },
    condition: condition.label,
    probableGrade: ctx.probableGrade || condition.label,
    visibleDefects: ctx.visibleDefects || [],
    generalEstimate: intel.recommendedPrice,
    recommendedPrice: intel.recommendedPrice,
    recommendation: intel.recommendation?.label || null,
    catalogUrl: catalogLink.cardId ? `/carte.html?id=${encodeURIComponent(catalogLink.cardId)}` : null,
    cardId: catalogLink.cardId,
    pendingCatalog: !!ctx.pendingProposal,
    canOfferBuyback: canOfferBuyback && !suspicionAlert,
    fallback,
    message: clientMessage,
    multiCardHint: ctx.multiCardCount > 1 ? `${ctx.multiCardCount} cartes détectées — résultat principal affiché` : null
  };
}

function buildAdminPayload(ctx) {
  const { pricing, intelligence, confidenceScore, suspicionAlert, suspicionReasons, pendingProposal, additionalCards, probableGrade } = ctx;
  const intel = intelligence || {};
  const idx = intel.scores || {};

  return {
    authenticityScore: confidenceScore,
    suspicionAlert,
    suspicionReasons,
    probableGrade,
    market: {
      low: pricing.market?.low ?? pricing.low,
      avg: pricing.market?.avg ?? pricing.avg,
      high: pricing.market?.high ?? pricing.high
    },
    buybackRecommended: pricing.buyback,
    resellRecommended: pricing.resell,
    margin: pricing.margin,
    marginPercent: pricing.marginPercent,
    confidenceLevel: pricing.confidenceLevel,
    cardoriaScore: idx.overall ?? intel.scores?.overall,
    scores: idx,
    adminRecommendation: pricing.adminRecommendation,
    intelligence: intel,
    pendingProposal,
    additionalCards: additionalCards || [],
    marketStats: intel.marketStats || null
  };
}

export async function scanCardIntelligent(data) {
  const start = Date.now();
  const scanId = makeScannerId();
  const analysisId = makeAnalysisId();
  const { images, sides } = collectImages(data);

  if (!images.length) {
    throw new Error("Au moins une photo est requise (recto, verso ou import).");
  }

  let parsed;
  let fallbackUsed = false;

  if (!process.env.OPENAI_API_KEY) {
    parsed = runCatalogFallback(data);
    fallbackUsed = true;
  } else {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const trainingExamples = getTrainingExamples(6, { license: data.cardGame });
      const content = [{ type: "input_text", text: buildScannerPrompt(data, trainingExamples) }];
      images.forEach((img) => content.push({ type: "input_image", image_url: img }));

      const response = await openai.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [{ role: "user", content }]
      });

      parsed = parseScannerResponse(response.output_text || "");
    } catch (e) {
      console.warn("[Scanner] IA indisponible, fallback catalogue:", e.message);
      parsed = runCatalogFallback(data);
      fallbackUsed = true;
    }
  }

  if (parsed.recognitionConfidence === "low" && !parsed.detection?.name && data.cardName) {
    parsed.detection.name = data.cardName;
    parsed.detection.license = parsed.detection.license || data.cardGame;
    fallbackUsed = true;
  }

  const condition = normalizeCondition(parsed.condition);
  const detection = parsed.detection || {};
  const confidenceScore = parsed.confidenceScore;
  const suspicionAlert = confidenceScore != null && confidenceScore < CONFIDENCE_THRESHOLD;
  const suspicionReasons = suspicionAlert
    ? (parsed.visibleDefects?.length ? parsed.visibleDefects : extractSuspicionReasons(parsed.rawResponse))
    : [];

  const catalogLink = resolveCatalogLink(detection, data.cardId);
  let pendingProposal = null;

  const estimate = buildSmartEstimate({
    detection,
    conditionGrade: condition.label,
    cardId: catalogLink.cardId,
    suspicionAlert,
    confidenceScore
  });

  const intelligence = buildCardoriaIntelligence(estimate, { suspicionAlert, confidenceScore });
  const pricing = flattenPricing(estimate, intelligence);

  const canOfferBuyback = pricing.buybackStatus !== "manual_verification_required" && pricing.buyback != null;

  const clientPayload = buildClientPayload({
    detection,
    condition,
    intelligence,
    catalogLink,
    suspicionAlert,
    fallback: fallbackUsed,
    clientMessage: parsed.clientMessage,
    canOfferBuyback,
    probableGrade: parsed.probableGrade,
    visibleDefects: parsed.visibleDefects,
    pendingProposal,
    multiCardCount: 1 + (parsed.additionalCards?.length || 0)
  });

  const adminPayload = buildAdminPayload({
    pricing,
    intelligence,
    confidenceScore,
    suspicionAlert,
    suspicionReasons,
    pendingProposal,
    additionalCards: parsed.additionalCards,
    probableGrade: parsed.probableGrade
  });

  const processingMs = Date.now() - start;

  saveAnalysis({
    id: analysisId,
    createdAt: new Date().toISOString(),
    customerName: data.customerName || "",
    customerEmail: data.customerEmail || "",
    customerNotes: data.notes || "",
    cardId: catalogLink.cardId,
    photosCount: images.length,
    confidenceScore,
    suspicionAlert,
    suspicionReasons,
    conditionGrade: condition.label,
    clientMessage: parsed.clientMessage,
    rawResponse: parsed.rawResponse,
    status: suspicionAlert ? "Alerte contrefaçon" : "Scan effectué",
    detection,
    prices: pricing,
    intelligence,
    trade: estimate.trade,
    trends: {},
    imagesBase64: images
  });

  saveScan({
    id: scanId,
    analysisId,
    createdAt: new Date().toISOString(),
    customerName: data.customerName || "",
    customerEmail: data.customerEmail || "",
    cardId: catalogLink.cardId,
    pendingCardId: pendingProposal?.id || null,
    licenseSlug: detection.license || "",
    photosCount: images.length,
    sides,
    confidenceScore,
    suspicionAlert,
    suspicionReasons,
    conditionGrade: condition.label,
    defects: parsed.visibleDefects,
    detection,
    client: clientPayload,
    admin: adminPayload,
    status: "completed",
    adminStatus: suspicionAlert ? "suspicious" : "pending",
    rawResponse: parsed.rawResponse,
    multiCardCount: 1 + (parsed.additionalCards?.length || 0),
    processingMs,
    deviceInfo: data.deviceInfo || "",
    fallbackUsed
  });

  if (!catalogLink.cardId && catalogLink.pendingProposal) {
    pendingProposal = createPendingCardProposal(scanId, catalogLink.pendingProposal);
    getDb().prepare("UPDATE scanner_scans SET pending_card_id = ? WHERE id = ?")
      .run(pendingProposal.id, scanId);
    clientPayload.pendingCatalog = true;
    adminPayload.pendingProposal = pendingProposal;
  }

  if (catalogLink.cardId && !suspicionAlert) {
    try {
      ingestEstimationOutcome({
        analysisId: scanId,
        cardId: catalogLink.cardId,
        detection,
        buybackPrice: pricing.buyback,
        salePrice: pricing.resell,
        condition: condition.label,
        language: detection.language
      });
    } catch { /* ignore */ }

    try {
      recordEnterpriseEstimation({
        analysisId,
        scanId,
        cardId: catalogLink.cardId,
        detection,
        conditionGrade: condition.label,
        pricing,
        intelligence,
        confidenceScore,
        source: "scanner"
      });
    } catch { /* ignore */ }
  }

  logAudit({
    type: "scanner",
    action: suspicionAlert ? "scan_suspicious" : "scan_ok",
    user: data.customerEmail || "scanner",
    detail: `${scanId} — ${detection.name || "?"} (${processingMs}ms)`
  });

  if (suspicionAlert) {
    await sendCounterfeitAlert(
      {
        id: scanId,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        cardGame: detection.license,
        cardName: detection.name,
        cardNotes: data.notes,
        detection,
        condition: condition.label,
        suspicionReasons
      },
      parsed.rawResponse,
      confidenceScore,
      images
    );
  }

  const enterprise = buildEnterpriseClientView({
    cardId: catalogLink.cardId,
    intelligence,
    pricing,
    detection
  });
  if (clientPayload) clientPayload.enterprise = enterprise;

  return {
    ok: true,
    scanId,
    analysisId,
    processingMs,
    client: clientPayload,
    enterprise,
    fallback: fallbackUsed
  };
}

function runCatalogFallback(data) {
  const detection = {
    license: data.cardGame || "autre",
    name: data.cardName || "",
    extension: "",
    number: "",
    rarity: "",
    language: "",
    version: ""
  };
  const link = resolveCatalogLink(detection, data.cardId);
  if (link.card) {
    detection.name = link.card.name;
    detection.extension = link.card.extension;
    detection.number = link.card.number;
    detection.rarity = link.card.rarity;
    detection.license = link.card.license;
  }

  return {
    clientMessage: link.cardId
      ? `Carte identifiée dans le catalogue Cardoria : ${detection.name}. Analyse visuelle complète indisponible — estimation basée sur le catalogue.`
      : "Carte non reconnue automatiquement. Notre équipe peut valider manuellement votre scan.",
    detection,
    condition: "Near Mint",
    confidenceScore: null,
    visibleDefects: [],
    probableGrade: "NM",
    additionalCards: [],
    recognitionConfidence: link.cardId ? "medium" : "low",
    rawResponse: ""
  };
}
