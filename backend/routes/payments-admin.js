/** Admin paiements SumUp et commandes Boutique. */
import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { listPayments, getPayment, PAYMENT_STATUSES } from "../lib/payments/ledger.js";
import { isSumUpConfigured, syncPaymentFromCheckout } from "../lib/payments/sumup.js";
import { readJson, writeJson } from "../lib/storage.js";

const router = Router();
const WRITE_ADMIN = requireAuth({ action: "write" });
const BOUTIQUE_STATUSES = ["À préparer", "En préparation", "Expédiée", "Livrée", "Annulée"];
const BOUTIQUE_CARRIERS = ["La Poste", "Mondial Relay", "Relais Colis"];

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function findBoutiqueOrder(id) {
  return readJson("orders", []).find((order) => String(order.id) === String(id)) || null;
}

function canProcessPaidOrder(order, nextStatus) {
  if (!["À préparer", "En préparation", "Expédiée", "Livrée"].includes(nextStatus)) return true;
  return order.paymentStatus === "paid";
}

router.use(requireAdmin);

router.get("/", (req, res) => res.json({
  ok: true,
  provider: "sumup",
  configured: isSumUpConfigured(),
  statuses: PAYMENT_STATUSES,
  payments: listPayments({ status: req.query.status, source: req.query.source, limit: req.query.limit })
}));

router.get("/boutique-orders", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, carriers: BOUTIQUE_CARRIERS, orders: readJson("orders", []) });
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

  const now = new Date().toISOString();
  const previousStatus = current.status;
  current.status = nextStatus;
  current.shipping = clean(body.shipping, 120) || current.shipping || "Standard";
  current.carrier = nextCarrier;
  current.tracking = clean(body.tracking, 180);
  current.address = clean(body.address, 600);
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

  logAudit({
    type: "boutique_order",
    action: "update",
    user: req.authUser?.email || "admin",
    detail: `${current.id} — ${previousStatus || "—"} -> ${current.status}`
  });

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
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/:id", (req, res) => {
  const payment = getPayment(req.params.id);
  if (!payment) return res.status(404).json({ ok: false, error: "Paiement introuvable" });
  res.json({ ok: true, payment });
});

router.post("/sync/:checkoutId", async (req, res) => {
  try {
    res.json({ ok: true, ...(await syncPaymentFromCheckout(req.params.checkoutId)) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
