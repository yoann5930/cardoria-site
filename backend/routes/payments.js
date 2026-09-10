/** API publique paiements SumUp CardoriaShop. */
import { Router } from "express";
import { isSumUpConfigured, syncPaymentFromCheckout, handleSumUpWebhook } from "../lib/payments/sumup.js";
import { listBoutiqueProducts } from "../lib/boutique/catalog.js";
import { createLiveBoutiqueCheckout } from "../lib/boutique/checkout.js";
import { assertSaleProvider } from "../lib/payments/routing.js";

const router = Router();

router.get("/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, provider: "sumup", configured: isSumUpConfigured(), webhookConfigured: Boolean(process.env.SUMUP_WEBHOOK_SECRET) });
});

router.get("/boutique/products", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, products: listBoutiqueProducts({ includeDisabled: false }) });
});

router.post("/boutique/checkout", async (req, res) => {
  try {
    const body = req.body || {};
    assertSaleProvider({ channel: "boutique", requestedProvider: body.provider });
    if (!isSumUpConfigured()) return res.status(503).json({ ok: false, provider: "sumup", error: "Paiement SumUp non configuré." });
    const result = await createLiveBoutiqueCheckout({ ...body, requestedProvider: body.provider, requestedAmount: body.amount ?? body.total });
    res.json({ ok: true, provider: "sumup", orderId: result.order.id, checkoutId: result.checkoutId, providerOrderId: result.checkoutId, url: result.url, paymentId: result.paymentId });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, provider: e.provider || "sumup", expectedProvider: e.expectedProvider || "sumup", requestedProvider: e.requestedProvider, error: e.message });
  }
});

router.get("/sumup/confirm/:checkoutId", async (req, res) => {
  try {
    const result = await syncPaymentFromCheckout(req.params.checkoutId);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, provider: "sumup", status: result.status, payment: result.payment });
  } catch (e) { res.status(e.status || 500).json({ ok: false, provider: "sumup", error: e.message }); }
});

router.post("/sumup/webhook", async (req, res) => {
  try {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.get("X-SumUp-Signature") || req.get("SumUp-Signature") || "";
    res.json(await handleSumUpWebhook(rawBody, signature));
  } catch (e) { res.status(e.status || 500).json({ ok: false, provider: "sumup", error: e.message }); }
});

router.all("/revolut/*", (req, res) => res.status(410).json({ ok: false, provider: "sumup", error: "Revolut n'est plus utilisé sur CardoriaShop." }));

export default router;
