/** Admin paiements SumUp et commandes Boutique. */
import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { listPayments, getPayment, PAYMENT_STATUSES } from "../lib/payments/ledger.js";
import { isSumUpConfigured, syncPaymentFromCheckout } from "../lib/payments/sumup.js";
import { refundSumUpTransaction } from "../lib/payments/sumup-refund.js";
import { listBoutiqueInventory } from "../lib/boutique/stock.js";
import { getOrder as getMarketplaceOrder } from "../lib/marketplace/orders.js";
import { readJson, writeJson } from "../lib/storage.js";
import { createColissimoLabel, downloadColissimoLabel, getColissimoStatus } from "../lib/colissimo.js";
import { getBoutiqueEmailConfiguration, sendBoutiquePurchaseEmail, sendBoutiqueTrackingEmail } from "../lib/boutique/customer-emails.js";
import {
  colissimoAdminMessage,
  colissimoLabelBlock,
  parseWeightGrams,
  resolveBoutiqueOrderWeight,
  shipmentStatusOf
} from "../lib/boutique/shipping.js";
import crypto from "crypto";

const router = Router();
const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });
const FINANCE_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "finance" });
const BOUTIQUE_STATUSES = ["À préparer", "En préparation", "Prête à expédier", "Expédiée", "Livrée", "Annulée"];
const BOUTIQUE_CARRIERS = ["Colissimo (La Poste)", "La Poste", "Mondial Relay", "Relais Colis"];

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function findBoutiqueOrder(id) {
  return readJson("orders", []).find((order) => String(order.id) === String(id)) || null;
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
    orders: readJson("orders", [])
  });
});

router.get("/boutique-orders/:id", (req, res) => {
  const order = findBoutiqueOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  res.json({ ok: true, order });
});

router.get("/boutique-inventory", (req, res) => {
  const inventory = listBoutiqueInventory({ includeDisabled: true });
  const totals = inventory.reduce((acc, item) => {
    acc.baseStock += Number(item.baseStock || 0);
    acc.availableStock += Number(item.stock || 0);
    acc.pendingStock += Number(item.pendingStock || 0);
    acc.soldStock += Number(item.soldStock || 0);
    acc.refundHoldStock += Number(item.refundHoldStock || 0);
    acc.oversoldStock += Number(item.oversoldStock || 0);
    return acc;
  }, { baseStock: 0, availableStock: 0, pendingStock: 0, soldStock: 0, refundHoldStock: 0, oversoldStock: 0 });
  res.json({ ok: true, inventory, totals });
});

router.put("/boutique-orders/:id", WRITE_ADMIN, async (req, res) => {
  const orders = readJson("orders", []);
  const index = orders.findIndex((order) => String(order.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });

  const current = orders[index];
  const body = req.body || {};
  const nextStatus = clean(body.status, 80) || current.status;
  const nextCarrier = clean(body.carrier, 120);

  if (!BOUTIQUE_STATUSES.includes(nextStatus) && nextStatus !== current.status) {
    return res.status(400).json({ ok: false, error: "Statut de commande non autorisé." });
  }
  if (!canProcessPaidOrder(current, nextStatus)) {
    return res.status(409).json({ ok: false, error: "Le paiement SumUp doit être confirmé avant de préparer ou expédier la commande." });
  }
  if (nextCarrier && !BOUTIQUE_CARRIERS.includes(nextCarrier) && nextCarrier !== clean(current.carrier, 120)) {
    return res.status(400).json({ ok: false, error: "Transporteur non autorisé. Choisissez Colissimo (La Poste), La Poste, Mondial Relay ou Relais Colis." });
  }
  if (nextStatus === "Expédiée" && (!nextCarrier || !clean(body.tracking, 180))) {
    return res.status(400).json({ ok: false, error: "Transporteur et numéro de suivi obligatoires pour expédier la commande." });
  }

  const now = new Date().toISOString();
  const previousStatus = current.status;
  current.status = nextStatus;
  current.carrier = nextCarrier;
  current.tracking = clean(body.tracking, 180);
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

  if (previousStatus !== nextStatus) {
    current.statusChangedAt = now;
    if (nextStatus === "En préparation" && !current.preparingAt) current.preparingAt = now;
    if (nextStatus === "Prête à expédier" && !current.readyToShipAt) current.readyToShipAt = now;
    if (nextStatus === "Expédiée" && !current.shippedAt) current.shippedAt = now;
    if (nextStatus === "Livrée" && !current.deliveredAt) current.deliveredAt = now;
    if (nextStatus === "Annulée" && !current.cancelledAt) current.cancelledAt = now;
  }
  current.shipmentStatus = shipmentStatusOf(current);

  current.paymentReviewRequired = nextStatus === "Annulée" && current.paymentStatus === "paid";
  orders[index] = current;
  writeJson("orders", orders);

  logAudit({ type: "boutique_order", action: "update", user: req.authUser?.email || "admin", detail: `${current.id} — ${previousStatus || "—"} -> ${current.status}` });

  let emailNotification = null;
  if (current.status === "Expédiée" && current.carrier && current.tracking) {
    try {
      emailNotification = await sendBoutiqueTrackingEmail(current.id);
    } catch (error) {
      emailNotification = { ok: false, sent: false, error: clean(error?.message || "Envoi e-mail de suivi impossible.", 240) };
    }
  }

  res.json({ ok: true, order: findBoutiqueOrder(current.id) || current, emailNotification });
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

router.post("/boutique-orders/:id/colissimo-label", WRITE_ADMIN, async (req, res) => {
  const orders = readJson("orders", []);
  const index = orders.findIndex((order) => String(order.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ ok: false, error: "Commande Boutique introuvable." });
  const current = orders[index];
  if (current.paymentStatus !== "paid") return res.status(409).json({ ok: false, error: "Le paiement SumUp doit être confirmé avant de créer une étiquette Colissimo." });
  if (current.colissimoParcelNumber) {
    return res.status(409).json({ ok: false, code: "COLISSIMO_LABEL_ALREADY_CREATED", error: "Une étiquette Colissimo existe déjà pour cette commande.", parcelNumber: current.colissimoParcelNumber });
  }
  if (current.colissimoLabelAttempt?.status === "creation_pending") {
    const pendingBlock = colissimoLabelBlock(current);
    if (pendingBlock?.code === "COLISSIMO_LABEL_IN_PROGRESS") {
      return res.status(409).json({ ok: false, code: "COLISSIMO_LABEL_IN_PROGRESS", error: pendingBlock.error });
    }
  }
  const hasBodyWeight = req.body?.weightGrams != null && req.body?.weightGrams !== "";
  const overrideWeight = hasBodyWeight ? parseWeightGrams(req.body.weightGrams) : null;
  if (hasBodyWeight && !overrideWeight) {
    return res.status(400).json({ ok: false, error: "Poids Colissimo requis entre 1 g et 30 kg." });
  }
  const preview = overrideWeight
    ? { ...current, shippingWeightGrams: overrideWeight, weightSource: "admin" }
    : current;
  const block = colissimoLabelBlock(preview);
  if (block) {
    if (block.stalePending) {
      const nowLock = new Date().toISOString();
      current.colissimoLabelAttempt = {
        status: "reconciliation_required",
        requestedAt: current.colissimoLabelAttempt?.requestedAt || nowLock,
        failedAt: nowLock,
        code: "COLISSIMO_RECONCILIATION_REQUIRED"
      };
      current.updatedAt = nowLock;
      orders[index] = current;
      writeJson("orders", orders);
    }
    return res.status(block.status).json({ ok: false, code: block.code, error: block.error, parcelNumber: block.parcelNumber });
  }
  const weight = resolveBoutiqueOrderWeight(preview, overrideWeight);
  if (!weight.known) {
    return res.status(400).json({ ok: false, code: "COLISSIMO_WEIGHT_REQUIRED", error: "Poids du colis requis. Une étiquette ne peut pas être créée tant que le poids est inconnu." });
  }
  const weightGrams = weight.grams;

  const requestedAt = new Date().toISOString();
  current.shippingWeightGrams = weightGrams;
  current.weightSource = weight.source;
  current.colissimoLabelAttempt = { status: "creation_pending", claimId: crypto.randomUUID(), requestedAt, weightGrams };
  current.updatedAt = requestedAt;
  orders[index] = current;
  writeJson("orders", orders);

  try {
    const created = await createColissimoLabel({ order: current, weightGrams });
    const refreshed = readJson("orders", []);
    const refreshedIndex = refreshed.findIndex((order) => String(order.id) === String(req.params.id));
    if (refreshedIndex < 0) throw Object.assign(new Error("Commande Boutique introuvable après création Colissimo."), { status: 500 });
    const order = refreshed[refreshedIndex];
    const now = new Date().toISOString();
    order.carrier = "Colissimo (La Poste)";
    order.shippingMethod = order.shippingMethod || "colissimo_home";
    order.shipping = order.shipping && order.shipping !== "Standard" ? order.shipping : "Colissimo domicile";
    order.tracking = created.trackingNumber;
    order.trackingUrl = created.trackingUrl || "";
    order.colissimoParcelNumber = created.parcelNumber;
    order.colissimoProductCode = created.productCode;
    order.colissimoLabelFormat = created.labelFormat;
    order.colissimoPdfUrl = created.pdfUrl || "";
    order.colissimoLabelCreatedAt = now;
    order.colissimoLabelAttempt = { status: "created", requestedAt, completedAt: now, weightGrams };
    order.updatedAt = now;
    refreshed[refreshedIndex] = order;
    writeJson("orders", refreshed);
    logAudit({ type: "shipping", action: "colissimo_label_created", user: req.authUser?.email || "admin", detail: order.id + " — " + created.parcelNumber });
    res.status(201).json({ ok: true, provider: created.provider, parcelNumber: created.parcelNumber, trackingNumber: created.trackingNumber, trackingUrl: created.trackingUrl, labelPath: "/api/admin/payments/boutique-orders/" + encodeURIComponent(order.id) + "/colissimo-label", order });
  } catch (error) {
    const refreshed = readJson("orders", []);
    const refreshedIndex = refreshed.findIndex((order) => String(order.id) === String(req.params.id));
    if (refreshedIndex >= 0) {
      const order = refreshed[refreshedIndex];
      const now = new Date().toISOString();
      const reconciliation = error?.code === "COLISSIMO_RECONCILIATION_REQUIRED";
      order.colissimoLabelAttempt = {
        status: reconciliation ? "reconciliation_required" : "failed",
        requestedAt,
        failedAt: now,
        weightGrams,
        code: clean(error?.code, 80)
      };
      order.updatedAt = now;
      refreshed[refreshedIndex] = order;
      writeJson("orders", refreshed);
    }
    const status = Number(error?.status);
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502).json({ ok: false, code: error?.code || "COLISSIMO_LABEL_FAILED", error: error?.message || "Création de l'étiquette Colissimo impossible." });
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
      const orders = readJson("orders", []);
      const index = orders.findIndex((item) => String(item.id) === String(refreshed.id));
      if (index >= 0) {
        orders[index].paymentReviewRequired = false;
        orders[index].updatedAt = new Date().toISOString();
        writeJson("orders", orders);
      }
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

    const orders = readJson("orders", []);
    const index = orders.findIndex((item) => String(item.id) === String(order.id));
    if (index >= 0) {
      orders[index].status = "Annulée";
      orders[index].paymentReviewRequired = true;
      orders[index].refundRequestedAt = new Date().toISOString();
      orders[index].updatedAt = new Date().toISOString();
      writeJson("orders", orders);
    }

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
