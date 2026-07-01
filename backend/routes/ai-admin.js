/**
 * Administration IA Premium — validations, corrections, apprentissage, performance.
 */
import { Router } from "express";
import fs from "fs";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  listAnalyses,
  getAnalysis,
  saveValidation,
  retrainFromValidations,
  updateAnalysisCorrection,
  getTrainingPoolStats
} from "../lib/ai/training.js";
import { getTrainingExamples } from "../lib/ai/training.js";
import { refreshAllTrends } from "../lib/ai/trends.js";
import { getPerformanceDashboard } from "../lib/ai/performance.js";
import { getImageAbsolutePath, getLearningRecord } from "../lib/ai/learning.js";

const router = Router();
router.use(requireAdmin);

router.get("/analyses", (req, res) => {
  res.json({ ok: true, analyses: listAnalyses({ status: req.query.status, limit: Number(req.query.limit) || 50 }) });
});

router.get("/analyses/:id", (req, res) => {
  const analysis = getAnalysis(req.params.id);
  if (!analysis) return res.status(404).json({ ok: false, error: "Analyse introuvable" });
  res.json({ ok: true, analysis });
});

router.get("/analyses/:id/images/:side", (req, res) => {
  const record = getLearningRecord(req.params.id);
  if (!record) return res.status(404).json({ ok: false, error: "Analyse introuvable" });
  const img = record.images.find((i) => i.side === req.params.side) || record.images[0];
  if (!img) return res.status(404).json({ ok: false, error: "Image introuvable" });
  const abs = getImageAbsolutePath(img.path);
  if (!fs.existsSync(abs)) return res.status(404).json({ ok: false, error: "Fichier image absent" });
  res.sendFile(abs);
});

router.put("/analyses/:id/validate", (req, res) => {
  const body = req.body || {};
  const { action, note, reason } = body;
  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ ok: false, error: "action: approved | rejected" });
  }

  const analysis = getAnalysis(req.params.id);
  if (!analysis) return res.status(404).json({ ok: false, error: "Analyse introuvable" });

  const validation = saveValidation({
    analysisId: req.params.id,
    action,
    correctedDetection: analysis.detection,
    correctedPrices: analysis.prices,
    adminNote: note,
    reason: reason || note,
    conditionValidated: body.conditionValidated || analysis.conditionGrade,
    priceActualBuy: body.priceActualBuy,
    priceActualSell: body.priceActualSell,
    resaleDelayDays: body.resaleDelayDays,
    isCounterfeit: body.isCounterfeit,
    authenticityResult: body.authenticityResult
  });

  logAudit({ type: "ai", action: "validation_" + action, user: "admin", detail: req.params.id });
  res.json({ ok: true, validation, analysis: getAnalysis(req.params.id) });
});

router.put("/analyses/:id/feedback", (req, res) => {
  const body = req.body || {};
  const analysis = getAnalysis(req.params.id);
  if (!analysis) return res.status(404).json({ ok: false, error: "Analyse introuvable" });

  updateAnalysisCorrection(req.params.id, {
    detection: body.detection,
    prices: body.prices,
    clientMessage: body.clientMessage,
    adminStatus: body.action || "corrected"
  });

  saveValidation({
    analysisId: req.params.id,
    action: body.action || "corrected",
    correctedDetection: body.detection || analysis.detection,
    correctedPrices: body.prices || analysis.prices,
    adminNote: body.adminNote || body.note,
    reason: body.reason,
    conditionValidated: body.conditionValidated,
    priceActualBuy: body.priceActualBuy,
    priceActualSell: body.priceActualSell,
    resaleDelayDays: body.resaleDelayDays,
    isCounterfeit: body.isCounterfeit,
    authenticityResult: body.authenticityResult
  });

  logAudit({ type: "ai", action: "feedback_learning", user: "admin", detail: req.params.id });
  res.json({ ok: true, analysis: getAnalysis(req.params.id) });
});

router.put("/analyses/:id/correct", (req, res) => {
  const body = req.body || {};

  updateAnalysisCorrection(req.params.id, {
    detection: body.detection,
    prices: body.prices,
    clientMessage: body.clientMessage,
    adminStatus: "corrected"
  });

  const validation = saveValidation({
    analysisId: req.params.id,
    action: "corrected",
    correctedDetection: body.detection,
    correctedPrices: body.prices,
    adminNote: body.note,
    reason: body.reason || body.note,
    conditionValidated: body.conditionValidated,
    priceActualBuy: body.priceActualBuy,
    priceActualSell: body.priceActualSell,
    resaleDelayDays: body.resaleDelayDays,
    isCounterfeit: body.isCounterfeit,
    authenticityResult: body.authenticityResult
  });

  logAudit({ type: "ai", action: "correction_estimation", user: "admin", detail: req.params.id });
  res.json({ ok: true, validation, analysis: getAnalysis(req.params.id) });
});

router.post("/retrain", (req, res) => {
  const result = retrainFromValidations();
  refreshAllTrends(50);
  logAudit({ type: "ai", action: "retrain", user: "admin", detail: `${result.examplesAdded} exemples` });
  res.json({ ok: true, ...result, trainingPool: getTrainingExamples(10).length });
});

router.get("/stats", (req, res) => {
  const analyses = listAnalyses({ limit: 500 });
  const pool = getTrainingPoolStats();
  res.json({
    ok: true,
    total: analyses.length,
    pending: analyses.filter((a) => a.adminStatus === "pending").length,
    approved: analyses.filter((a) => a.adminStatus === "approved").length,
    rejected: analyses.filter((a) => a.adminStatus === "rejected").length,
    corrected: analyses.filter((a) => a.adminStatus === "corrected").length,
    alerts: analyses.filter((a) => a.suspicionAlert).length,
    trainingExamples: pool.totalExamples,
    learning: pool
  });
});

router.get("/performance", (req, res) => {
  res.json({ ok: true, dashboard: getPerformanceDashboard() });
});

export default router;
