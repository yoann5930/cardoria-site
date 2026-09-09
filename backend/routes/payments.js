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
import { listBoutiqueProducts } from "../lib/boutique/catalog.js";
import { createLiveBoutiqueCheckout } from "../lib/boutique/checkout.js";
import { assertSaleProvider } from "../lib/payments/routing.js";

const router = Router();

router.get("/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    provider: "revolut",
    configured: isRevolutConfigured(),
    webhookConfigured: Boolean(String(process.env.REVOLUT_WEBHOOK_SECRET || "").trim()),
    environment: getRevolutEnvironment(),
    presence: {
      REVOLUT_SECRET_KEY: isRevolutConfigured(),
      REVOLUT_WEBHOOK_SECRET: Boolean(String(process.env.REVOLUT_WEBHOOK_SECRET || "").trim())
    },
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
    const body = req.body || {};
    assertSaleProvider({ channel: "boutique", requestedProvider: body.provider });
    if (!isRevolutConfigured()) {
      return res.status(503).json({
        ok: false,
        provider: "revolut",
        environment: getRevolutEnvironment(),
        error: "Paiement Revolut non configuré. Définir REVOLUT_SECRET_KEY dans /etc/cardoria/cardoria.env sur OVH."
      });
    }
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
      visitorId: body.visitorId,
      requestedProvider: body.provider,
      requestedAmount: body.amount ?? body.total
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
    res.status(e.status || 500).json({
      ok: false,
      provider: e.provider || "revolut",
      expectedProvider: e.expectedProvider || "revolut",
      requestedProvider: e.requestedProvider,
      error: e.message
    });
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

// Anciens endpoints volontairement retirés du parcours actif Boutique.
router.all("/sumup/*", (req, res) => {
  res.status(410).json({ ok: false, provider: "revolut", error: "SumUp a été remplacé par Revolut sur la Boutique CardoriaShop." });
});

export default router;
