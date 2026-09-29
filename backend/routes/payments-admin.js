/** Admin paiements SumUp et commandes Boutique. */
import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { listPayments, getPayment, PAYMENT_STATUSES } from "../lib/payments/ledger.js";
import { isSumUpConfigured, syncPaymentFromCheckout } from "../lib/payments/sumup.js";
import { refundSumUpTransaction } from "../lib/payments/sumup-refund.js";
import { boutiqueStockImpact, listBoutiqueInventory, summarizeBoutiqueInventory, LOW_STOCK_THRESHOLD, MAX_STOCK_BASE } from "../lib/boutique/stock.js";
import { withBoutiqueOrderLock } from "../lib/boutique/order-lock.js";
import { getOrder as getMarketplaceOrder } from "../lib/marketplace/orders.js";
import { readJson, writeJson } from "../lib/storage.js";
import { downloadColissimoLabel, getColissimoStatus } from "../lib/colissimo.js";
import {
  downloadSendcloudLabel,
  getServicePoint as getSendcloudServicePoint,
  searchMondialRelayServicePoints as searchSendcloudMondialRelayServicePoints
} from "../lib/sendcloud.js";
import { createBoutiqueShipmentForPreparation } from "../lib/boutique/shipment-creation.js";
import { getBoutiqueEmailConfiguration, sendBoutiquePurchaseEmail, sendBoutiqueTrackingEmail } from "../lib/boutique/customer-emails.js";
import {
  colissimoAdminMessage,
  normalizePickupPoint,
  parseWeightGrams,
  shipmentStatusOf
} from "../lib/boutique/shipping.js";

const router = Router();
const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });
const FINANCE_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "finance" });
const BOUTIQUE_STATUSES = ["À préparer", "En préparation", "Prête à expédier", "Expédiée", "Livrée", "Annulée"];
const BOUTIQUE_CARRIERS = ["Colissimo (La Poste)", "La Poste", "Mondial Relay", "Relais Colis"];
function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function pickupFromSendcloudPoint(point) {
  if (!point || point.carrierCode !== "mondial_relay" || point.active === false) return null;
  const carrierServicePointId = clean(point.carrierServicePointId || point.id, 20);
  const sendcloudServicePointId = clean(point.id, 40);
  return normalizePickupPoint({
    id: carrierServicePointId,
    carrierServicePointId,
    sendcloudServicePointId,
    name: point.name,
    street: point.street,
    houseNumber: point.houseNumber,
    postalCode: point.postalCode,
    city: point.city,
    countryCode: point.countryCode || "FR"
  });
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function findBoutiqueOrder(id) {
  const order = readJson("orders", []).find((row) => String(row.id) === String(id)) || null;
  if (!order) return null;
  return { ...order, stockImpact: boutiqueStockImpact(order) };
}

function paymentOrder(payment) {
  if (!payment) return null;
  if (payment.source === "boutique" || String(payment.orderId || "").startsWith("CMD-")) return findBoutiqueOrder(payment.orderId);
  try { return getMarketplaceOrder(payment.orderId); } catch { return null; }
}

function orderPaymentStatus(order) {
  return String(order?.paymentStatus || "").toLowerCase();
}

function paymentReconciliation(payment) {
  const order = paymentOrder(payment);
  if (!order) return { state: "orphan", label: "Commande introuvable", order: null };
  const ledgerStatus = String(payment.status || "").toLowerCase();
  const currentOrderStatus = orderPaymentStatus(order);
  if (!currentOrderStatus) return { state: "unknown", label: "Statut commande absent", order };
  if (ledgerStatus === currentOrderStatus) return { state: "ok", label: "Rapproché", order };
  return { state: "mismatch", label: `${ledgerStatus || "—"} / ${currentOrderStatus || "—"}`, order };
}

function canProcessPaidOrder(order, nextStatus) {
  if (!["À préparer", "En préparation", "Prête à expédier", "Expédiée", "Livrée"].includes(nextStatus)) return true;
  return order.paymentStatus === "paid";
}

function paymentsSummary(payments) {
  const summary = {
    total: payments.length,
    pending: 0,
    paid: 0,
    failed: 0,
    refunded: 0,
    paidAmount: 0,
    refundedAmount: 0,
    pendingAmount: 0,
    mismatches: 0,
    orphans: 0
  };
  for (const payment of payments) {
    const status = String(payment.status || "pending").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, status)) summary[status] += 1;
    if (status === "paid") summary.paidAmount += Number(payment.amount || 0);
    if (status === "refunded") summary.refundedAmount += Number(payment.amount || 0);
    if (status === "pending") summary.pendingAmount += Number(payment.amount || 0);
    const reconciliation = paymentReconciliation(payment);
    if (reconciliation.state === "mismatch") summary.mismatches += 1;
    if (reconciliation.state === "orphan") summary.orphans += 1;
  }
  summary.paidAmount = money(summary.paidAmount);
  summary.refundedAmount = money(summary.refundedAmount);
  summary.pendingAmount = money(summary.pendingAmount);
  return summary;
}

router.use(requireAdmin);
router.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

router.get("/", (req, res) => {
  const payments = listPayments({ status: req.query.status, source: req.query.source, limit: req.query.limit || 500 });
  const enriched = payments.map((payment) => {
    const reconciliation = paymentReconciliation(payment);
    return {
      ...payment,
      reconciliation: { state: reconciliation.state, label: reconciliation.label },
      orderStatus: reconciliation.order?.status || "",
      orderPaymentStatus: reconciliation.order?.paymentStatus || "",
      canSync: !!payment.sumupCheckoutId,
      canRefund: payment.status === "paid" && !!(payment.sumupTransactionId || payment.sumupCheckoutId)
    };
  });
  res.json({
    ok: true,
    provider: "sumup",
    configured: isSumUpConfigured(),
    statuses: PAYMENT_STATUSES,
    summary: paymentsSummary(payments),
    payments: enriched
  });
});

router.get("/summary", (req, res) => {
  const payments = listPayments({ limit: 5000 });
  res.json({ ok: true, configured: isSumUpConfigured(), summary: paymentsSummary(payments) });
});

router.post("/:id/sync", WRITE_ADMIN, async (req, res) => {
  const payment = getPayment(req.params.id);
  if (!payment) return res.status(404).json({ ok: false, error: "Paiement introuvable." });
  if (!payment.sumupCheckoutId) return res.status(409).json({ ok: false, error: "Checkout SumUp introuvable pour ce paiement." });
  try {
    const result = await syncPaymentFromCheckout(payment.sumupCheckoutId);
    const refreshed = getPayment(payment.id);
    const reconciliation = paymentReconciliation(refreshed);
    logAudit({ type: "payment", action: "sumup_admin_sync", user: req.authUser?.email || "admin", detail: `${payment.id} — ${payment.sumupCheckoutId} → ${result.status}` });
    res.json({ ok: true, status: result.status, payment: refreshed, reconciliation: { state: reconciliation.state, label: reconciliation.label }, order: reconciliation.order });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.message });
  }
});

router.post("/:id/refund", FINANCE_ADMIN, async (req, res) => {
  let payment = getPayment(req.params.id);
  if (!payment) return res.status(404).json({ ok: false, error: "Paiement introuvable." });
  if (payment.status !== "paid") return res.status(409).json({ ok: false, error: "Seul un paiement SumUp payé peut être remboursé." });
  if (!isSumUpConfigured()) return res.status(503).json({ ok: false, error: "SumUp n'est pas configuré." });

  try {
    if (!payment.sumupTransactionId && payment.sumupCheckoutId) {
      await syncPaymentFromCheckout(payment.sumupCheckoutId);
      payment = getPayment(payment.id);
    }
    if (!payment?.sumupTransactionId) return res.status(409).json({ ok: false, error: "Transaction SumUp introuvable après synchronisation." });

    const requestedAmount = req.body?.amount == null || req.body?.amount === "" ? null : Number(req.body.amount);
    if (requestedAmount != null && (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > Number(payment.amount || 0))) {
      return res.status(400).json({ ok: false, error: "Montant de remboursement invalide." });
    }

    await refundSumUpTransaction(payment.sumupTransactionId, { amount: requestedAmount, orderId: payment.orderId, user: req.authUser?.email || "admin" });
    let sync = null;
    if (payment.sumupCheckoutId) {
      try { sync = await syncPaymentFromCheckout(payment.sumupCheckoutId); } catch {}
    }
    const refreshed = getPayment(payment.id);
    const reconciliation = paymentReconciliation(refreshed);
    logAudit({ type: "payment", action: "sumup_admin_refund", user: req.authUser?.email || "admin", detail: `${payment.id} — ${requestedAmount == null ? "total" : `${requestedAmount} EUR`}` });
    res.json({ ok: true, refundRequested: true, status: sync?.status || refreshed?.status || "pending", payment: refreshed, reconciliation: { state: reconciliation.state, label: reconciliation.label }, order: reconciliation.order });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.message });
  }
});

router.get("/boutique-orders", (req, res) => {
  const colissimo = getColissimoStatus();
  res.json({
    ok: true,
    carriers: BOUTIQUE_CARRIERS,
    statuses: BOUTIQUE_STATUSES,
    colissimo,
    colissimoMessage: colissimoAdminMessage(colissimo),
    email: getBoutiqueEmailConfiguration(),
    orders: readJson("orders", []).map((order) => ({
      ...order,
      stockImpact: boutiqueStockImpact(order)
    }))
  });
});

router.get("/boutique-orders/:id", (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  res.json({ ok: true, order });
});

router.get("/boutique-orders/:id/relay-options", async (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  const shipping = order.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {};
  const postalCode = clean(shipping.postalCode, 12);
  const city = clean(shipping.city, 80);
  if (!postalCode && !city) {
    return res.status(400).json({ ok: false, code: "RELAY_SEARCH_ADDRESS_REQUIRED", error: "Code postal ou ville de livraison requis pour rechercher un Point Relais." });
  }
  try {
    const result = await searchSendcloudMondialRelayServicePoints({
      countryCode: clean(shipping.countryCode || shipping.country || "FR", 2) || "FR",
      postalCode,
      city,
      radius: 15000,
      limit: 15
    });
    const points = (result.points || []).map(pickupFromSendcloudPoint).filter(Boolean);
    res.json({ ok: true, provider: "sendcloud", points, count: points.length });
  } catch (error) {
    res.status(error?.status || 502).json({ ok: false, code: error?.code || "MONDIAL_RELAY_SEARCH_FAILED", error: error?.message || "Recherche Point Relais indisponible." });
  }
});

router.put("/boutique-orders/:id/pickup-point", WRITE_ADMIN, async (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  if (order.status === "Expédiée" || order.status === "Livrée" || order.tracking) {
    return res.status(409).json({ ok: false, code: "ORDER_ALREADY_SHIPPED", error: "Le Point Relais ne peut plus être modifié après création de l'expédition." });
  }
  const servicePointId = clean(req.body?.servicePointId, 40);
  if (!/^\d+$/.test(servicePointId) || !Number.isSafeInteger(Number(servicePointId)) || Number(servicePointId) <= 0) {
    return res.status(400).json({ ok: false, code: "SERVICE_POINT_INVALID", error: "Point Relais Sendcloud invalide." });
  }
  try {
    const remote = await getSendcloudServicePoint(Number(servicePointId));
    if (!remote?.active || remote.carrierCode !== "mondial_relay" || remote.countryCode !== "FR") {
      return res.status(404).json({ ok: false, code: "SERVICE_POINT_NOT_FOUND", error: "Point Relais Mondial Relay indisponible chez Sendcloud." });
    }
    const point = pickupFromSendcloudPoint(remote);
    if (!point) {
      return res.status(404).json({ ok: false, code: "SERVICE_POINT_NOT_FOUND", error: "Point Relais Mondial Relay indisponible chez Sendcloud." });
    }
    const updated = await withBoutiqueOrderLock(() => {
      const orders = readJson("orders", []);
      const index = orders.findIndex((row) => String(row.id) === String(order.id));
      if (index < 0) return null;
      const current = orders[index];
      current.pickupPoint = point;
      current.carrier = "Mondial Relay";
      current.shippingMethod = "mondial_relay";
      current.shipping = "Mondial Relay Point Relais";
      current.updatedAt = new Date().toISOString();
      orders[index] = current;
      writeJson("orders", orders);
      return current;
    });
    if (!updated) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
    logAudit({ type: "shipping", action: "pickup_point_repaired", user: req.authUser?.email || "admin", detail: `${order.id} — ${point.id} — ${point.name}` });
    res.json({ ok: true, order: findBoutiqueOrder(order.id) || updated, pickupPoint: point });
  } catch (error) {
    res.status(error?.status || 502).json({ ok: false, code: error?.code || "MONDIAL_RELAY_SEARCH_FAILED", error: error?.message || "Sélection du Point Relais impossible." });
  }
});

router.get("/boutique-inventory", (req, res) => {
  const inventory = listBoutiqueInventory({ includeDisabled: true });
  const totals = summarizeBoutiqueInventory(inventory);
  res.json({
    ok: true,
    inventory,
    totals,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    maxStockBase: MAX_STOCK_BASE
  });
});

router.put("/boutique-orders/:id", WRITE_ADMIN, async (req, res) => {
  const updated = await withBoutiqueOrderLock(() => {
    const orders = readJson("orders", []);
    const index = orders.findIndex((order) => String(order.id) === String(req.params.id));
    if (index < 0) return { missing: true };

    const current = orders[index];
    const body = req.body || {};
    const nextStatus = clean(body.status, 80) || current.status;
    const nextCarrier = clean(body.carrier, 120);

    if (!BOUTIQUE_STATUSES.includes(nextStatus) && nextStatus !== current.status) {
      return { error: "Statut de commande non autorisé.", status: 400 };
    }
    if (!canProcessPaidOrder(current, nextStatus)) {
      return { error: "Le paiement SumUp doit être confirmé avant de préparer ou expédier la commande.", status: 409 };
    }
    if (nextCarrier && !BOUTIQUE_CARRIERS.includes(nextCarrier) && nextCarrier !== clean(current.carrier, 120)) {
      return { error: "Transporteur non autorisé. Choisissez Colissimo (La Poste), La Poste, Mondial Relay ou Relais Colis.", status: 400 };
    }
    const requestedShippingMethod = clean(body.shippingMethod || current.shippingMethod || current.shipping, 80);
    const wantsRelay = /mondial/i.test(nextCarrier || current.carrier || "") || /mondial/i.test(requestedShippingMethod);
    if (nextStatus === "En préparation" && wantsRelay && !normalizePickupPoint(current.pickupPoint)) {
      return { error: "Choisissez un Point Relais Mondial Relay avant de passer la commande en préparation.", status: 409, code: "MONDIAL_RELAY_PICKUP_REQUIRED" };
    }
    if (nextStatus === "Expédiée" && (!nextCarrier || !clean(current.tracking, 180))) {
      return { error: "Une étiquette et un numéro de suivi doivent exister avant de marquer la commande comme expédiée.", status: 400 };
    }

    const now = new Date().toISOString();
    const previousStatus = current.status;
    current.carrier = nextCarrier || current.carrier;
    current.address = clean(body.address, 600);
    current.phone = clean(body.phone, 40) || current.phone || "";
    current.internalNote = clean(body.internalNote, 2000);
    current.updatedAt = now;

    const nextShipping = clean(body.shipping, 120);
    if (nextShipping) current.shipping = nextShipping;
    else current.shipping = current.shipping || "Standard";
    const nextMethod = clean(body.shippingMethod, 80);
    if (nextMethod) current.shippingMethod = nextMethod;
    const nextWeight = parseWeightGrams(body.shippingWeightGrams);
    if (nextWeight) {
      current.shippingWeightGrams = nextWeight;
      current.weightSource = "admin";
    }
    if (current.pickupPoint && !current.pickupPoint.id) current.pickupPoint = null;

    // "En préparation" is the single shipping trigger. Persist the latest
    // address/phone/weight first, but let the shipping orchestrator create
    // exactly one real label and only then finalize the status.
    const prepareShipment = nextStatus === "En préparation";

    if (!prepareShipment) {
      current.status = nextStatus;
      if (previousStatus !== nextStatus) {
        current.statusChangedAt = now;
        if (nextStatus === "Prête à expédier" && !current.readyToShipAt) current.readyToShipAt = now;
        if (nextStatus === "Expédiée" && !current.shippedAt) current.shippedAt = now;
        if (nextStatus === "Livrée" && !current.deliveredAt) current.deliveredAt = now;
        if (nextStatus === "Annulée" && !current.cancelledAt) current.cancelledAt = now;
      }
      if (nextStatus === "Annulée" && current.paymentStatus === "pending") current.paymentStatus = "cancelled";
      current.shipmentStatus = shipmentStatusOf(current);
      current.paymentReviewRequired = nextStatus === "Annulée" && current.paymentStatus === "paid";
    }

    orders[index] = current;
    writeJson("orders", orders);
    return { previousStatus, current: { ...current }, prepareShipment };
  });

  if (updated?.missing) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  if (updated?.error) return res.status(updated.status || 400).json({ ok: false, error: updated.error });

  let current = updated.current;
  let shipmentCreated = false;
  if (updated.prepareShipment) {
    try {
      const beforeTracking = clean(current.tracking, 180);
      current = await createBoutiqueShipmentForPreparation(current.id, { actor: req.authUser?.email || "admin" });
      shipmentCreated = !beforeTracking && Boolean(clean(current.tracking, 180));
      logAudit({
        type: "shipping",
        action: shipmentCreated ? "label_created_on_preparing" : "label_reused_on_preparing",
        user: req.authUser?.email || "admin",
        detail: `${current.id} — ${current.shippingLabelProvider || current.carrier || "shipping"} — ${current.tracking || "tracking_pending"}`
      });
    } catch (error) {
      return res.status(error?.status || 502).json({
        ok: false,
        code: error?.code || "SHIPMENT_CREATION_FAILED",
        error: error?.message || "Création de l'étiquette impossible.",
        order: findBoutiqueOrder(req.params.id)
      });
    }
  }

  logAudit({
    type: "boutique_order",
    action: "update",
    user: req.authUser?.email || "admin",
    detail: `${current.id} — ${updated.previousStatus || "—"} -> ${current.status}`
  });

  let emailNotification = null;
  if (current.status === "Expédiée" && current.carrier && current.tracking) {
    try {
      emailNotification = await sendBoutiqueTrackingEmail(current.id);
    } catch (error) {
      emailNotification = { ok: false, sent: false, error: clean(error?.message || "Envoi e-mail de suivi impossible.", 240) };
    }
  }

  res.json({
    ok: true,
    order: findBoutiqueOrder(current.id) || current,
    shipmentCreated,
    emailNotification
  });
});

router.post("/boutique-orders/:id/emails/purchase", WRITE_ADMIN, async (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  if (order.paymentStatus !== "paid") return res.status(409).json({ ok: false, error: "Le paiement doit être confirmé avant l'envoi du mail d'achat." });
  try {
    const result = await sendBoutiquePurchaseEmail(order.id, { force: true });
    if (!result.sent) return res.status(result.reason === "smtp_not_configured" ? 503 : 502).json({ ok: false, ...result });
    logAudit({ type: "boutique_order", action: "purchase_email_resent", user: req.authUser?.email || "admin", detail: order.id });
    res.json({ ok: true, sent: true, order: result.order });
  } catch (error) {
    res.status(502).json({ ok: false, sent: false, error: clean(error?.message || "Envoi du mail d'achat impossible.", 240) });
  }
});

router.post("/boutique-orders/:id/emails/tracking", WRITE_ADMIN, async (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  if (order.status !== "Expédiée" || !order.carrier || !order.tracking) {
    return res.status(409).json({ ok: false, error: "La commande doit être expédiée avec transporteur et numéro de suivi." });
  }
  try {
    const result = await sendBoutiqueTrackingEmail(order.id, { force: true });
    if (!result.sent) return res.status(result.reason === "smtp_not_configured" ? 503 : 502).json({ ok: false, ...result });
    logAudit({ type: "boutique_order", action: "tracking_email_resent", user: req.authUser?.email || "admin", detail: order.id });
    res.json({ ok: true, sent: true, order: result.order });
  } catch (error) {
    res.status(502).json({ ok: false, sent: false, error: clean(error?.message || "Envoi du mail de suivi impossible.", 240) });
  }
});

router.post("/boutique-orders/:id/colissimo-label", WRITE_ADMIN, (req, res) => {
  res.status(410).json({
    ok: false,
    code: "ADMIN_SHIPPING_READ_ONLY",
    error: "La création d’étiquette est désactivée dans l’Admin Cardoria. L’expédition doit être créée par le parcours de commande prévu."
  });
});

router.get("/boutique-orders/:id/shipping-label", WRITE_ADMIN, async (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  try {
    let bytes;
    let filename;
    if (order.sendcloudParcelId) {
      bytes = await downloadSendcloudLabel(order.sendcloudParcelId);
      filename = "mondial-relay-" + String(order.id).replace(/[^A-Za-z0-9_-]/g, "") + ".pdf";
    } else if (order.colissimoParcelNumber) {
      bytes = await downloadColissimoLabel(order.colissimoParcelNumber, order.colissimoPdfUrl || "");
      filename = "colissimo-" + String(order.colissimoParcelNumber).replace(/[^A-Za-z0-9_-]/g, "") + ".pdf";
    } else {
      return res.status(404).json({ ok: false, error: "Aucune étiquette existante pour cette commande." });
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  } catch (error) {
    const status = Number(error?.status);
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502).json({
      ok: false,
      code: error?.code || "SHIPPING_LABEL_UNAVAILABLE",
      error: error?.message || "Téléchargement de l'étiquette impossible."
    });
  }
});

router.get("/boutique-orders/:id/colissimo-label", WRITE_ADMIN, async (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  if (!order.colissimoParcelNumber) return res.status(404).json({ ok: false, error: "Aucune étiquette Colissimo pour cette commande." });
  try {
    const bytes = await downloadColissimoLabel(order.colissimoParcelNumber, order.colissimoPdfUrl || "");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="colissimo-' + String(order.colissimoParcelNumber).replace(/[^A-Za-z0-9_-]/g, "") + '.pdf"');
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  } catch (error) {
    const status = Number(error?.status);
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502).json({ ok: false, code: error?.code || "COLISSIMO_LABEL_UNAVAILABLE", error: error?.message || "Téléchargement de l'étiquette Colissimo impossible." });
  }
});

router.post("/boutique-orders/:id/sync-sumup", WRITE_ADMIN, async (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  if (!order.sumupCheckoutId) return res.status(409).json({ ok: false, error: "Cette commande n'a pas de checkout SumUp associé." });

  try {
    const result = await syncPaymentFromCheckout(order.sumupCheckoutId);
    const refreshed = findBoutiqueOrder(order.id);
    if (refreshed && refreshed.paymentStatus === "refunded" && refreshed.paymentReviewRequired) {
      await withBoutiqueOrderLock(() => {
        const orders = readJson("orders", []);
        const index = orders.findIndex((item) => String(item.id) === String(refreshed.id));
        if (index >= 0) {
          orders[index].paymentReviewRequired = false;
          orders[index].updatedAt = new Date().toISOString();
          writeJson("orders", orders);
        }
      });
    }
    logAudit({ type: "boutique_order", action: "sumup_sync", user: req.authUser?.email || "admin", detail: `${order.id} — ${result.status}` });
    res.json({ ok: true, status: result.status, payment: result.payment, order: findBoutiqueOrder(order.id) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/boutique-orders/:id/refund", FINANCE_ADMIN, async (req, res) => {
  let order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  if (order.paymentStatus !== "paid") return res.status(409).json({ ok: false, error: "Seule une commande SumUp payée peut être remboursée." });

  try {
    if (!order.sumupTransactionId && order.sumupCheckoutId) {
      await syncPaymentFromCheckout(order.sumupCheckoutId);
      order = findBoutiqueOrder(order.id);
    }
    if (!order?.sumupTransactionId) return res.status(409).json({ ok: false, error: "Transaction SumUp introuvable après synchronisation." });

    await refundSumUpTransaction(order.sumupTransactionId, { orderId: order.id, user: req.authUser?.email || "admin" });

    await withBoutiqueOrderLock(() => {
      const orders = readJson("orders", []);
      const index = orders.findIndex((item) => String(item.id) === String(order.id));
      if (index >= 0) {
        orders[index].status = "Annulée";
        orders[index].paymentReviewRequired = true;
        orders[index].refundRequestedAt = new Date().toISOString();
        orders[index].updatedAt = new Date().toISOString();
        writeJson("orders", orders);
      }
    });

    let sync = null;
    try { sync = await syncPaymentFromCheckout(order.sumupCheckoutId); } catch {}
    const refreshed = findBoutiqueOrder(order.id);
    res.json({ ok: true, refundRequested: true, status: sync?.status || refreshed?.paymentStatus || "pending", order: refreshed });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/:id", (req, res) => {
  const payment = getPayment(req.params.id);
  if (!payment) return res.status(404).json({ ok: false, error: "Paiement introuvable" });
  const reconciliation = paymentReconciliation(payment);
  res.json({ ok: true, payment: { ...payment, reconciliation: { state: reconciliation.state, label: reconciliation.label }, orderStatus: reconciliation.order?.status || "", orderPaymentStatus: reconciliation.order?.paymentStatus || "" } });
});

router.post("/sync/:checkoutId", WRITE_ADMIN, async (req, res) => {
  try {
    res.json({ ok: true, ...(await syncPaymentFromCheckout(req.params.checkoutId)) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

export default router;
