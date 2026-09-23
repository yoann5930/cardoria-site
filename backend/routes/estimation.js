import { Router } from "express";
import QRCode from "qrcode";
import { analyzeCardPremium } from "../lib/ai/analyze.js";
import { getAnalysis } from "../lib/ai/training.js";
import { readJson, writeJson } from "../lib/storage.js";
import { recordWitnotEstimation, resolveTrafficSource } from "../lib/attribution/witnot.js";
import {
  addCapturePhotos,
  createCaptureSession,
  deleteCaptureSession,
  getCapturePhotos,
  getCaptureStatus,
  isValidEstimationImageDataUrl
} from "../lib/estimation/capture-sessions.js";

const router = Router();
const PUBLIC_ORIGIN = String(process.env.SITE_URL || "https://www.cardoriashop.fr").replace(/\/$/, "");

export function validateEstimationPayload(body = {}) {
  const images = Array.isArray(body.imagesBase64)
    ? body.imagesBase64.filter(isValidEstimationImageDataUrl).slice(0, 6)
    : [];

  if (!images.length) {
    return {
      ok: false,
      status: 400,
      error: "Ajoutez au moins une photo de la carte avant de lancer l'estimation."
    };
  }

  return { ok: true, body: { ...body, imagesBase64: images } };
}

export async function handleEstimation(req, res) {
  const validation = validateEstimationPayload(req.body || {});
  if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });

  try {
    const payload = validation.body;
    const result = await analyzeCardPremium(payload);
    const stored = getAnalysis(result.id);
    const trafficSource = resolveTrafficSource(req, payload) || payload?.trafficSource;

    const list = readJson("estimations", []);
    list.unshift({
      id: result.id,
      createdAt: new Date().toISOString(),
      status: stored?.suspicionAlert ? "Alerte contrefaçon" : "Analyse effectuée",
      customerName: payload?.customerName || "",
      customerEmail: payload?.customerEmail || "",
      cardName: result.detection?.name || payload?.cardName || "",
      cardGame: result.detection?.license || payload?.cardGame || "",
      cardNotes: payload?.cardNotes || "",
      cardId: result.cardId,
      photosCount: payload.imagesBase64.length,
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
        visitorId: payload?.visitorId,
        trafficSource: "witnot",
        email: payload?.customerEmail,
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

router.get("/", (req, res) => res.json({ ok: true, message: "Route estimation active." }));

router.post("/capture/session", (req, res) => {
  const session = createCaptureSession({ origin: PUBLIC_ORIGIN });
  res.status(201).json({
    ok: true,
    ...session,
    qrUrl: `/api/estimation-carte/capture/session/${encodeURIComponent(session.sessionId)}/qr.svg`
  });
});

router.get("/capture/session/:sessionId", (req, res) => {
  const status = getCaptureStatus(req.params.sessionId);
  if (!status) return res.status(404).json({ ok: false, error: "Session photo expirée ou introuvable." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...status });
});

router.get("/capture/session/:sessionId/photos", (req, res) => {
  const photos = getCapturePhotos(req.params.sessionId);
  if (!photos) return res.status(404).json({ ok: false, error: "Session photo expirée ou introuvable." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...photos });
});

router.post("/capture/session/:sessionId/photos", (req, res) => {
  const result = addCapturePhotos(req.params.sessionId, req.body?.imagesBase64 || []);
  if (!result.ok) return res.status(result.status || 400).json(result);
  res.json(result);
});

router.delete("/capture/session/:sessionId", (req, res) => {
  deleteCaptureSession(req.params.sessionId);
  res.json({ ok: true });
});

router.get("/capture/session/:sessionId/qr.svg", async (req, res) => {
  const status = getCaptureStatus(req.params.sessionId);
  if (!status) return res.status(404).type("text/plain").send("Session photo expirée.");
  const captureUrl = `${PUBLIC_ORIGIN}/estimation-photo.html?session=${encodeURIComponent(status.sessionId)}`;
  const svg = await QRCode.toString(captureUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 280
  });
  res.setHeader("Cache-Control", "no-store");
  res.type("image/svg+xml").send(svg);
});

router.post("/", handleEstimation);

export default router;
