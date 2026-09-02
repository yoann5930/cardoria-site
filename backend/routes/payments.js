/**
 * API publique paiements Revolut CardoriaShop.
 */
import { Router } from "express";
import {
  isRevolutConfigured,
  getRevolutEnvironment,
  syncRevolutOrder,
  syncRevolutOrderByCardoriaOrder,
  handleRevolutWebhook
} from "../lib/payments/revolut.js";
import { listBoutiqueProducts } from "../lib/boutique/stock.js";
import { createLiveBoutiqueCheckout } from "../lib/boutique/checkout.js";

const router = Router();

router.get("/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    provider: "revolut",
    configured: isRevolutConfigured(),
    environment: getRevolutEnvironment(),
    safeForTest: getRevolutEnvironment() === "sandbox"
  });
});

router.get("/boutique/products", (req, res) => {
  const products = listBoutiqueProducts({ includeDisabled: false });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, products });
});

router.post("/boutique/checkout", async (req, res) => {
  try {
    if (!isRevolutConfigured()) {
      return res.status(503).json({
        ok: false,
        provider: "revolut",
        environment: getRevolutEnvironment(),
        error: "Paiement Revolut non configuré. Définir REVOLUT_SECRET_KEY dans Render."
      });
    }
    const body = req.body || {};
    const result = await createLiveBoutiqueCheckout({
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      customerPhone: body.customerPhone,
      address: body.address,
      postalCode: body.postalCode,
      city: body.city,
      country: body.country,
      items: body.items,
      shipping: body.shipping,
      successUrl: body.successUrl,
      trafficSource: body.trafficSource,
      visitorId: body.visitorId
    });
    res.json({
      ok: true,
      provider: "revolut",
      environment: result.environment,
      orderId: result.order.id,
      checkoutId: result.providerOrderId,
      providerOrderId: result.providerOrderId,
      url: result.url,
      paymentId: result.paymentId
    });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, provider: "revolut", error: e.message });
  }
});

router.get("/revolut/confirm/:providerOrderId", async (req, res) => {
  try {
    const result = await syncRevolutOrder(req.params.providerOrderId);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, provider: "revolut", status: result.status, payment: result.payment });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, provider: "revolut", error: e.message });
  }
});

router.get("/revolut/confirm-order/:orderId", async (req, res) => {
  try {
    const result = await syncRevolutOrderByCardoriaOrder(req.params.orderId);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, provider: "revolut", status: result.status, payment: result.payment });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, provider: "revolut", error: e.message });
  }
});

router.post("/revolut/webhook", async (req, res) => {
  try {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const result = await handleRevolutWebhook(
      rawBody,
      req.get("Revolut-Request-Timestamp"),
      req.get("Revolut-Signature")
    );
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, provider: "revolut", error: e.message });
  }
});

// Anciens endpoints volontairement retirés du parcours actif.
router.all("/sumup/*", (req, res) => {
  res.status(410).json({ ok: false, provider: "revolut", error: "SumUp a été remplacé par Revolut sur CardoriaShop." });
});

export default router;
