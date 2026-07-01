import { analyzeCardPremium } from "../lib/ai/analyze.js";
import { getAnalysis } from "../lib/ai/training.js";
import { readJson, writeJson } from "../lib/storage.js";
import { recordWitnotEstimation, resolveTrafficSource } from "../lib/attribution/witnot.js";

export async function handleEstimation(req, res) {
  try {
    const result = await analyzeCardPremium(req.body || {});
    const stored = getAnalysis(result.id);
    const trafficSource = resolveTrafficSource(req, req.body || {}) || req.body?.trafficSource;

    const list = readJson("estimations", []);
    list.unshift({
      id: result.id,
      createdAt: new Date().toISOString(),
      status: stored?.suspicionAlert ? "Alerte contrefaçon" : "Analyse effectuée",
      customerName: req.body?.customerName || "",
      customerEmail: req.body?.customerEmail || "",
      cardName: result.detection?.name || req.body?.cardName || "",
      cardGame: result.detection?.license || req.body?.cardGame || "",
      cardNotes: req.body?.cardNotes || "",
      cardId: result.cardId,
      photosCount: (req.body?.imagesBase64 || []).length,
      confidenceScore: stored?.confidenceScore,
      suspicionAlert: stored?.suspicionAlert,
      detection: result.detection,
      condition: result.condition,
      prices: stored?.prices || {},
      result: result.clientResult,
      trafficSource: trafficSource === "witnot" ? "witnot" : undefined
    });
    writeJson("estimations", list.slice(0, 500));

    if (trafficSource === "witnot") {
      recordWitnotEstimation({
        visitorId: req.body?.visitorId,
        trafficSource: "witnot",
        email: req.body?.customerEmail,
        estimationId: result.id
      });
    }

    res.json({
      ok: true,
      id: result.id,
      clientResult: result.clientResult,
      detection: result.detection,
      condition: result.condition,
      estimate: result.estimate,
      intelligence: result.intelligence,
      trend: result.trend,
      history: result.history,
      cardId: result.cardId
    });
  } catch (error) {
    console.error(error);
    const isProd = process.env.NODE_ENV === "production";
    res.status(500).json({
      ok: false,
      error: "Erreur pendant l'analyse Cardoria.",
      details: isProd ? undefined : String(error?.message || error)
    });
  }
}

export function getEstimations() {
  return readJson("estimations", []);
}
