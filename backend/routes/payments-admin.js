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

const router = Router();
const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });
const FINANCE_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "finance" });
const BOUTIQUE_STATUSES = ["À préparer", "En préparation", "Expédiée", "Livrée", "Annulée"];
const BOUTIQUE_CARRIERS = ["La Poste", "Mondial Relay", "Relais Colis"];

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
  if (!["À préparer", "En préparation", "Expédiée", "Livrée"].includes(nextStatus)) return true;
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
  res.json({ ok: true, carriers: BOUTIQUE_CARRIERS, orders: readJson("orders", []) });
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

router.put("/boutique-orders/:id", WRITE_ADMIN, (req, res) => {
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
    return res.status(400).json({ ok: false, error: "Transporteur non autorisé. Choisissez La Poste, Mondial Relay ou Relais Colis." });
  }
  if (nextStatus === "Expédiée" && (!nextCarrier || !clean(body.tracking, 180))) {
    return res.status(400).json({ ok: false, error: "Transporteur et numéro de suivi obligatoires pour expédier la commande." });
  }

  const now = new Date().toISOString();
  const previousStatus = current.status;
  current.status = nextStatus;
  current.shipping = clean(body.shipping, 120) || current.shipping || "Standard";
  current.carrier = nextCarrier;
  current.tracking = clean(body.tracking, 180);
  current.address = clean(body.address, 600);
  current.phone = clean(body.phone, 40) || current.phone || "";
  current.internalNote = clean(body.internalNote, 2000);
  current.updatedAt = now;

  if (previousStatus !== nextStatus) {
    current.statusChangedAt = now;
    if (nextStatus === "En préparation" && !current.preparingAt) current.preparingAt = now;
    if (nextStatus === "Expédiée" && !current.shippedAt) current.shippedAt = now;
    if (nextStatus === "Livrée" && !current.deliveredAt) current.deliveredAt = now;
    if (nextStatus === "Annulée" && !current.cancelledAt) current.cancelledAt = now;
  }

  current.paymentReviewRequired = nextStatus === "Annulée" && current.paymentStatus === "paid";
  orders[index] = current;
  writeJson("orders", orders);

  logAudit({ type: "boutique_order", action: "update", user: req.authUser?.email || "admin", detail: `${current.id} — ${previousStatus || "—"} -> ${current.status}` });
  res.json({ ok: true, order: current });
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
