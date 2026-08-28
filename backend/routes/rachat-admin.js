import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import {
  RACHAT_STATUSES,
  getRachatProposal,
  listRachatProposals,
  getRachatSummary,
  startRachatReview,
  sendRachatOffer,
  adminDecideRachatOffer,
  markRachatCardReceived,
  markRachatPaid,
  migrateLegacyRachatProposals
} from "../lib/rachat/workflow.js";

const router = Router();
const WRITE_ADMIN = requireAuth({ action: "write" });

router.use(requireAdmin);

router.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  migrateLegacyRachatProposals();
  res.json({
    ok: true,
    statuses: RACHAT_STATUSES,
    summary: getRachatSummary(),
    proposals: listRachatProposals({ status: req.query.status, q: req.query.q, limit: req.query.limit })
  });
});

router.get("/:id", (req, res) => {
  const proposal = getRachatProposal(req.params.id);
  if (!proposal) return res.status(404).json({ ok: false, error: "Proposition introuvable." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, proposal });
});

router.post("/:id/review", WRITE_ADMIN, (req, res) => {
  try {
    const proposal = startRachatReview(req.params.id, { user: req.authUser?.email || "admin", note: req.body?.note });
    res.json({ ok: true, proposal });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

router.post("/:id/offer", WRITE_ADMIN, async (req, res) => {
  try {
    const result = await sendRachatOffer(req.params.id, {
      amount: req.body?.amount,
      note: req.body?.note,
      expiresDays: req.body?.expiresDays,
      user: req.authUser?.email || "admin"
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

router.post("/:id/decision", WRITE_ADMIN, (req, res) => {
  try {
    const proposal = adminDecideRachatOffer(req.params.id, {
      decision: req.body?.decision,
      note: req.body?.note,
      user: req.authUser?.email || "admin"
    });
    res.json({ ok: true, proposal });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

router.post("/:id/received", WRITE_ADMIN, (req, res) => {
  try {
    const proposal = markRachatCardReceived(req.params.id, {
      receivedCondition: req.body?.receivedCondition,
      authenticityConfirmed: req.body?.authenticityConfirmed === true,
      note: req.body?.note,
      user: req.authUser?.email || "admin"
    });
    res.json({ ok: true, proposal });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

router.post("/:id/paid", WRITE_ADMIN, async (req, res) => {
  try {
    const result = await markRachatPaid(req.params.id, {
      amount: req.body?.amount,
      method: req.body?.method,
      reference: req.body?.reference,
      buyer: req.body?.buyer,
      boutiquePrice: req.body?.boutiquePrice,
      boutiqueEnabled: req.body?.boutiqueEnabled !== false,
      user: req.authUser?.email || "admin"
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

export default router;
