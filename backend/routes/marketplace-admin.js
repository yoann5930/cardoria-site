/**
 * Admin marketplace + webhook SumUp.
 */
import { Router } from "express";
import express from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { getAllOrders, updateOrderStatus, getOrder } from "../lib/marketplace/orders.js";
import { searchListings } from "../lib/marketplace/listings.js";
import { listSellers, setSellerVerified } from "../lib/marketplace/sellers.js";
import { generateShippingLabel } from "../lib/marketplace/shipping.js";
import { isSumUpConfigured, handleSumUpWebhook } from "../lib/marketplace/payments.js";
import { processPriceAlerts } from "../lib/marketplace/social.js";
import { listAllListingsAdmin } from "../lib/marketplace/v1/listings.js";
import { getMarketplaceStats } from "../lib/marketplace/v1/index.js";
import { listDisputes, resolveDispute } from "../lib/marketplace/v1/disputes.js";
import { exportAccountingCsv } from "../lib/marketplace/v1/invoices.js";
import { getInvoiceHtmlByOrder } from "../lib/marketplace/v1/invoices.js";

export const webhookRouter = Router();
webhookRouter.post("/sumup", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const signature = req.headers["x-payload-signature"] || req.headers["x-sumup-signature"];
    const result = await handleSumUpWebhook(req.body, signature);
    res.json(result);
  } catch (e) {
    console.error("SumUp webhook:", e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

const router = Router();
router.use(requireAdmin);

router.get("/orders", (req, res) => {
  res.json({ ok: true, orders: getAllOrders() });
});

router.put("/orders/:id/status", (req, res) => {
  try {
    const order = updateOrderStatus(req.params.id, req.body.status, req.body);
    logAudit({ type: "marketplace", action: "order_status", user: "admin", detail: `${req.params.id} → ${req.body.status}` });
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/orders/:id/shipping-label", async (req, res) => {
  try {
    const label = await generateShippingLabel(req.params.id, req.body.carrier);
    res.json({ ok: true, ...label });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/listings", (req, res) => {
  res.json({ ok: true, listings: listAllListingsAdmin(req.query) });
});

router.get("/listings/search", (req, res) => {
  res.json({ ok: true, ...searchListings({ ...req.query, activeOnly: false }) });
});

router.get("/sellers", (req, res) => {
  res.json({ ok: true, sellers: listSellers() });
});

router.put("/sellers/:id/verified", (req, res) => {
  const seller = setSellerVerified(req.params.id, req.body.verified);
  logAudit({ type: "marketplace", action: "seller_verified", user: "admin", detail: req.params.id });
  res.json({ ok: true, seller });
});

router.post("/alerts/process", async (req, res) => {
  const result = await processPriceAlerts();
  res.json({ ok: true, ...result });
});

router.get("/config", (req, res) => {
  res.json({
    ok: true,
    sumup: isSumUpConfigured(),
    paymentProvider: "sumup",
    carriers: ["mondial_relay", "colissimo", "chronopost"],
    stats: getMarketplaceStats()
  });
});

router.get("/stats", (req, res) => {
  res.json({ ok: true, stats: getMarketplaceStats() });
});

router.put("/orders/:id/tracking", (req, res) => {
  try {
    const order = updateOrderStatus(req.params.id, req.body.status || "shipped", {
      tracking: req.body.tracking,
      labelUrl: req.body.labelUrl
    });
    logAudit({ type: "marketplace", action: "tracking", user: "admin", detail: req.params.id });
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/orders/:id/refund", (req, res) => {
  try {
    const order = updateOrderStatus(req.params.id, "refunded", { paymentStatus: "refunded" });
    logAudit({ type: "marketplace", action: "refund", user: "admin", detail: req.params.id });
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/orders/:id/invoice", (req, res) => {
  const html = getInvoiceHtmlByOrder(req.params.id);
  if (!html) return res.status(404).json({ ok: false, error: "Facture introuvable" });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

router.get("/disputes", (req, res) => {
  res.json({ ok: true, disputes: listDisputes(req.query) });
});

router.put("/disputes/:id", (req, res) => {
  const dispute = resolveDispute(req.params.id, req.body || {});
  logAudit({ type: "marketplace", action: "dispute_resolve", user: "admin", detail: req.params.id });
  res.json({ ok: true, dispute });
});

router.get("/export/accounting.csv", (req, res) => {
  const csv = exportAccountingCsv({ from: req.query.from, to: req.query.to });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=cardoria-marketplace-compta.csv");
  res.send("\uFEFF" + csv);
});

export default router;
