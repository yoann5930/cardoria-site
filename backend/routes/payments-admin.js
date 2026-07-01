/**
 * Admin paiements SumUp — historique unifié.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { listPayments, getPayment, PAYMENT_STATUSES } from "../lib/payments/ledger.js";
import { isSumUpConfigured, syncPaymentFromCheckout } from "../lib/payments/sumup.js";

const router = Router();
router.use(requireAdmin);

router.get("/", (req, res) => {
  res.json({
    ok: true,
    provider: "sumup",
    configured: isSumUpConfigured(),
    statuses: PAYMENT_STATUSES,
    payments: listPayments({
      status: req.query.status,
      source: req.query.source,
      limit: req.query.limit
    })
  });
});

router.get("/:id", (req, res) => {
  const payment = getPayment(req.params.id);
  if (!payment) return res.status(404).json({ ok: false, error: "Paiement introuvable" });
  res.json({ ok: true, payment });
});

router.post("/sync/:checkoutId", async (req, res) => {
  try {
    const result = await syncPaymentFromCheckout(req.params.checkoutId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
