/** Admin Marketplace Cardoria + webhook SumUp Boutique. */
import { Router } from "express";
import express from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { getAllOrders, updateOrderStatus } from "../lib/marketplace/orders.js";
import { searchListings } from "../lib/marketplace/listings.js";
import { listSellers, setSellerVerified } from "../lib/marketplace/sellers.js";
import { generateShippingLabel } from "../lib/marketplace/shipping.js";
import { isSumUpConfigured, handleSumUpWebhook } from "../lib/marketplace/payments.js";
import { getPayPalMarketplaceConfig } from "../lib/marketplace/paypal.js";
import { refundPayPalOrder, paypalWebhookConfigured } from "../lib/marketplace/paypal-events.js";
import { processPriceAlerts } from "../lib/marketplace/social.js";
import { listAllListingsAdmin } from "../lib/marketplace/v1/listings.js";
import { getMarketplaceStats } from "../lib/marketplace/v1/index.js";
import { listDisputes, resolveDispute } from "../lib/marketplace/v1/disputes.js";
import { exportAccountingCsv, getInvoiceHtmlByOrder } from "../lib/marketplace/v1/invoices.js";

export const webhookRouter = Router();
webhookRouter.post("/sumup", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const signature = req.headers["x-payload-signature"] || req.headers["x-sumup-signature"];
    res.json(await handleSumUpWebhook(req.body, signature));
  } catch (e) { console.error("SumUp webhook:", e.message); res.status(400).json({ ok: false, error: e.message }); }
});

const router = Router();
router.use(requireAdmin);
router.get("/orders", (req, res) => res.json({ ok: true, orders: getAllOrders() }));
router.put("/orders/:id/status", (req, res) => {
  try { const order = updateOrderStatus(req.params.id, req.body.status, req.body); logAudit({ type: "marketplace", action: "order_status", user: req.authUser?.email || "admin", detail: `${req.params.id} → ${req.body.status}` }); res.json({ ok: true, order }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.post("/orders/:id/shipping-label", async (req, res) => {
  try { res.json({ ok: true, ...(await generateShippingLabel(req.params.id, req.body.carrier)) }); }
  catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});
router.get("/listings", (req, res) => res.json({ ok: true, listings: listAllListingsAdmin(req.query) }));
router.get("/listings/search", (req, res) => res.json({ ok: true, ...searchListings({ ...req.query, activeOnly: false }) }));
router.get("/sellers", (req, res) => res.json({ ok: true, sellers: listSellers() }));
router.put("/sellers/:id/verified", (req, res) => { const seller = setSellerVerified(req.params.id, req.body.verified); logAudit({ type: "marketplace", action: "seller_verified", user: req.authUser?.email || "admin", detail: req.params.id }); res.json({ ok: true, seller }); });
router.post("/alerts/process", async (req, res) => res.json({ ok: true, ...(await processPriceAlerts()) }));
router.get("/config", (req, res) => {
  const paypal = getPayPalMarketplaceConfig();
  res.json({ ok: true, boutique: { provider: "sumup", configured: isSumUpConfigured() }, marketplace: { provider: "paypal", configured: paypal.configured, webhookConfigured: paypalWebhookConfigured(), environment: paypal.environment, commissionPercent: paypal.commissionPercent, delayedDisbursement: paypal.delayedDisbursement }, carriers: ["mondial_relay", "colissimo", "chronopost"], carrierLabelsReady: false, stats: getMarketplaceStats() });
});
router.get("/stats", (req, res) => res.json({ ok: true, stats: getMarketplaceStats() }));
router.put("/orders/:id/tracking", (req, res) => {
  try { const order = updateOrderStatus(req.params.id, req.body.status || "shipped", { tracking: String(req.body.tracking || "").slice(0, 120), labelUrl: String(req.body.labelUrl || "").slice(0, 1000) }); logAudit({ type: "marketplace", action: "tracking", user: req.authUser?.email || "admin", detail: req.params.id }); res.json({ ok: true, order }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.post("/orders/:id/refund", async (req, res) => {
  try {
    const result = await refundPayPalOrder(req.params.id, req.body?.amount);
    logAudit({ type: "payment", action: "paypal_refund", user: req.authUser?.email || "admin", detail: `${req.params.id} — ${result.amount || "full"}` });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});
router.get("/orders/:id/invoice", (req, res) => {
  const html = getInvoiceHtmlByOrder(req.params.id);
  if (!html) return res.status(404).json({ ok: false, error: "Facture introuvable" });
  res.type("text/html; charset=utf-8").send(html);
});
router.get("/disputes", (req, res) => res.json({ ok: true, disputes: listDisputes(req.query) }));
router.put("/disputes/:id", (req, res) => { const dispute = resolveDispute(req.params.id, req.body || {}); logAudit({ type: "marketplace", action: "dispute_resolve", user: req.authUser?.email || "admin", detail: req.params.id }); res.json({ ok: true, dispute }); });
router.get("/export/accounting.csv", (req, res) => { const csv = exportAccountingCsv({ from: req.query.from, to: req.query.to }); res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=cardoria-marketplace-compta.csv"); res.send("\uFEFF" + csv); });
export default router;
