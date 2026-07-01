/**
 * API publique paiements SumUp Cardoria.
 */
import { Router } from "express";
import {
  isSumUpConfigured,
  createBoutiqueCheckout,
  syncPaymentFromCheckout,
  handleSumUpReturnCallback
} from "../lib/payments/sumup.js";

const router = Router();

router.get("/status", (req, res) => {
  res.json({ ok: true, provider: "sumup", configured: isSumUpConfigured() });
});

router.post("/boutique/checkout", async (req, res) => {
  try {
    if (!isSumUpConfigured()) {
      return res.status(503).json({ ok: false, error: "Paiement SumUp non configuré. Définir SUMUP_API_KEY et SUMUP_MERCHANT_CODE." });
    }
    const body = req.body || {};
    const result = await createBoutiqueCheckout({
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      items: body.items,
      shippingCost: body.shippingCost,
      shipping: body.shipping,
      successUrl: body.successUrl,
      trafficSource: body.trafficSource,
      visitorId: body.visitorId
    });
    res.json({
      ok: true,
      orderId: result.order.id,
      checkoutId: result.checkoutId,
      url: result.url,
      paymentId: result.paymentId
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/sumup/confirm/:checkoutId", async (req, res) => {
  try {
    const result = await syncPaymentFromCheckout(req.params.checkoutId);
    res.json({ ok: true, status: result.status, payment: result.payment });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/sumup/callback", async (req, res) => {
  try {
    const result = await handleSumUpReturnCallback(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
