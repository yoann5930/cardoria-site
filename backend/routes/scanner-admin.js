/**
 * Administration Scanner Intelligent Cardoria.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  getScan,
  listScans,
  updateScanAdmin,
  getStatsByLicense,
  exportScansCsv
} from "../lib/scanner/store.js";
import { listPendingCards, updatePendingCard } from "../lib/scanner/catalog.js";
import { saveValidation } from "../lib/ai/training.js";

const router = Router();
router.use(requireAdmin);

router.get("/scans", (req, res) => {
  res.json({
    ok: true,
    scans: listScans({
      suspicious: req.query.suspicious,
      license: req.query.license,
      adminStatus: req.query.status,
      limit: Number(req.query.limit) || 50
    })
  });
});

router.get("/scans/:id", (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) return res.status(404).json({ ok: false, error: "Scan introuvable" });
  res.json({ ok: true, scan });
});

router.get("/suspicious", (req, res) => {
  res.json({ ok: true, scans: listScans({ suspicious: true, limit: Number(req.query.limit) || 30 }) });
});

router.get("/stats", (req, res) => {
  res.json({ ok: true, byLicense: getStatsByLicense() });
});

router.get("/export.csv", (req, res) => {
  const csv = exportScansCsv(Number(req.query.limit) || 2000);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=cardoria-scans.csv");
  res.send("\uFEFF" + csv);
});

router.get("/pending-cards", (req, res) => {
  res.json({ ok: true, pending: listPendingCards({ status: req.query.status || "pending" }) });
});

router.put("/scans/:id/validate", (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) return res.status(404).json({ ok: false, error: "Scan introuvable" });

  const { action, note, detection, adminPayload } = req.body || {};
  if (!["approved", "rejected", "corrected"].includes(action)) {
    return res.status(400).json({ ok: false, error: "action: approved | rejected | corrected" });
  }

  const updated = updateScanAdmin(scan.id, {
    adminStatus: action,
    detection: detection || scan.detection,
    adminPayload: adminPayload || scan.admin
  });

  if (scan.analysisId) {
    saveValidation({
      analysisId: scan.analysisId,
      action: action === "corrected" ? "corrected" : action,
      correctedDetection: detection || scan.detection,
      correctedPrices: scan.admin?.intelligence ? scan.admin : scan.admin,
      adminNote: note,
      reason: note
    });
  }

  logAudit({ type: "scanner", action: "validate_" + action, user: "admin", detail: scan.id });
  res.json({ ok: true, scan: updated });
});

router.put("/pending-cards/:id", (req, res) => {
  const { status, adminNote } = req.body || {};
  if (!["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ ok: false, error: "status invalide" });
  }
  const row = updatePendingCard(req.params.id, { status, adminNote });
  if (!row) return res.status(404).json({ ok: false, error: "Proposition introuvable" });
  logAudit({ type: "scanner", action: "pending_" + status, user: "admin", detail: req.params.id });
  res.json({ ok: true, pending: row });
});

export default router;
