/** Admin Marketplace Cardoria + webhook SumUp Boutique. */
import { Router } from "express";
import express from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { readJson } from "../lib/storage.js";
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
import { listCardoriaStock, setCardoriaStockLive, syncExistingPurchasesToCardoriaStock } from "../lib/marketplace/cardoria-stock.js";

export const webhookRouter = Router();
webhookRouter.post("/sumup", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const signature = req.headers["x-payload-signature"] || req.headers["x-sumup-signature"];
    res.json(await handleSumUpWebhook(req.body, signature));
  } catch (e) { console.error("SumUp webhook:", e.message); res.status(400).json({ ok: false, error: e.message }); }
});

const MANUAL_ORDER_STATUSES = new Set(["preparing", "shipped", "delivered", "cancelled"]);
function assertManualStatus(status) {
  const next = String(status || "").trim().toLowerCase();
  if (!MANUAL_ORDER_STATUSES.has(next)) {
    const error = new Error("Ce statut ne peut pas être défini manuellement");
    error.status = 400;
    throw error;
  }
  return next;
}

const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });
const FINANCE_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "finance" });
const EXPORT_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "export" });
const router = Router();
router.use(requireAdmin);

router.get("/orders", (req, res) => res.json({ ok: true, orders: getAllOrders() }));
router.put("/orders/:id/status", WRITE_ADMIN, (req, res) => {
  try {
    const status = assertManualStatus(req.body.status);
    const order = updateOrderStatus(req.params.id, status, req.body);
    logAudit({ type: "marketplace", action: "order_status", user: req.authUser?.email || "admin", detail: `${req.params.id} → ${status}` });
    res.json({ ok: true, order });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});
router.post("/orders/:id/shipping-label", WRITE_ADMIN, async (req, res) => {
  try { res.json({ ok: true, ...(await generateShippingLabel(req.params.id, req.body.carrier)) }); }
  catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});

router.get("/cardoria-stock", (req, res) => {
  try { res.json({ ok: true, stock: listCardoriaStock({ q: req.query.q || "" }) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || "Stock Cardoria indisponible" }); }
});
router.post("/cardoria-stock/sync", WRITE_ADMIN, (req, res) => {
  try {
    const purchases = readJson("purchases", []);
    const result = syncExistingPurchasesToCardoriaStock(purchases);
    logAudit({ type: "stock", action: "purchase_stock_sync", user: req.authUser?.email || "admin", detail: `${result.purchasesSynced || 0} achats · ${result.linkedCards || 0} cartes liees` });
    res.json({ ok: true, ...result, stock: listCardoriaStock({ q: req.query.q || "" }) });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message || "Synchronisation du stock impossible" }); }
});
router.put("/cardoria-stock/:id/live", WRITE_ADMIN, (req, res) => {
  try {
    const live = req.body?.live === true;
    const item = setCardoriaStockLive(req.params.id, live);
    logAudit({ type: "stock", action: live ? "stock_live" : "stock_hide", user: req.authUser?.email || "admin", detail: `${req.params.id} → ${live ? "LIVE" : "CACHE"}` });
    res.json({ ok: true, item });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message || "Modification de visibilité impossible" }); }
});

router.get("/listings", (req, res) => res.json({ ok: true, listings: listAllListingsAdmin(req.query) }));
router.get("/listings/search", (req, res) => res.json({ ok: true, ...searchListings({ ...req.query, activeOnly: false }) }));
router.get("/sellers", (req, res) => res.json({ ok: true, sellers: listSellers() }));
router.put("/sellers/:id/verified", WRITE_ADMIN, (req, res) => {
  const seller = setSellerVerified(req.params.id, req.body.verified);
  logAudit({ type: "marketplace", action: "seller_verified", user: req.authUser?.email || "admin", detail: req.params.id });
  res.json({ ok: true, seller });
});
router.post("/alerts/process", WRITE_ADMIN, async (req, res) => res.json({ ok: true, ...(await processPriceAlerts()) }));
router.get("/config", (req, res) => {
  const paypal = getPayPalMarketplaceConfig();
  res.json({ ok: true, boutique: { provider: "sumup", configured: isSumUpConfigured() }, marketplace: { provider: "paypal", configured: paypal.configured, webhookConfigured: paypalWebhookConfigured(), environment: paypal.environment, commissionPercent: paypal.commissionPercent, delayedDisbursement: paypal.delayedDisbursement }, carriers: ["mondial_relay", "colissimo", "chronopost"], carrierLabelsReady: false, stats: getMarketplaceStats() });
});
router.get("/stats", (req, res) => res.json({ ok: true, stats: getMarketplaceStats() }));
router.put("/orders/:id/tracking", WRITE_ADMIN, (req, res) => {
  try {
    const status = assertManualStatus(req.body.status || "shipped");
    const order = updateOrderStatus(req.params.id, status, { tracking: String(req.body.tracking || "").slice(0, 120), labelUrl: String(req.body.labelUrl || "").slice(0, 1000) });
    logAudit({ type: "marketplace", action: "tracking", user: req.authUser?.email || "admin", detail: req.params.id });
    res.json({ ok: true, order });
  } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});
router.post("/orders/:id/refund", FINANCE_ADMIN, async (req, res) => {
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
router.put("/disputes/:id", WRITE_ADMIN, (req, res) => {
  const dispute = resolveDispute(req.params.id, req.body || {});
  logAudit({ type: "marketplace", action: "dispute_resolve", user: req.authUser?.email || "admin", detail: req.params.id });
  res.json({ ok: true, dispute });
});
router.get("/export/accounting.csv", EXPORT_ADMIN, (req, res) => {
  const csv = exportAccountingCsv({ from: req.query.from, to: req.query.to });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=cardoria-marketplace-compta.csv");
  res.send("\uFEFF" + csv);
});
export default router;