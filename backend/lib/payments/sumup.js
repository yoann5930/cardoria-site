/** Paiements SumUp Cardoria — Boutique et Live Admin. */
import { logAudit } from "../audit.js";
import { readJson, writeJson } from "../storage.js";
import { applyLivePaymentStatus } from "../live/sessions.js";
import { recordPayment, getPaymentByCheckoutId, updatePayment } from "./ledger.js";
import { makePaymentId } from "./migrate.js";
import { sendBoutiquePurchaseEmail } from "../boutique/customer-emails.js";
import { withBoutiqueOrderLock } from "../boutique/order-lock.js";
import { shipmentStatusOf } from "../boutique/shipping.js";
import { listBoutiqueProducts, PENDING_RESERVATION_MS } from "../boutique/stock.js";
import { money } from "./routing.js";

const SUMUP_API = process.env.SUMUP_API_BASE || "https://api.sumup.com";

export function isSumUpConfigured() {
  return !!(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE);
}

async function sumupRequest(method, p, b) {
  if (!process.env.SUMUP_API_KEY) throw Object.assign(new Error("SUMUP_API_KEY non configurée"), { status: 503 });
  const r = await fetch(`${SUMUP_API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SUMUP_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: b ? JSON.stringify(b) : undefined
  });
  const t = await r.text();
  let d = {};
  try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t }; }
  if (!r.ok) throw Object.assign(new Error(d.message || d.error_message || d.detail || t || `SumUp HTTP ${r.status}`), { status: r.status });
  return d;
}

export function mapSumUpStatus(status) {
  const s = String(status || "").toUpperCase();
  if (["PAID", "SUCCESSFUL", "SUCCESS"].includes(s)) return "paid";
  if (["FAILED", "DECLINED", "CANCELLED", "CANCELED"].includes(s)) return "failed";
  if (s === "REFUNDED") return "refunded";
  return "pending";
}

export async function retrieveSumUpCheckout(id) {
  return sumupRequest("GET", `/v0.1/checkouts/${encodeURIComponent(id)}`);
}

export async function createSumUpCheckout({ orderId, amount, description, customerEmail, redirectUrl, returnUrl, source = "boutique" }) {
  if (!isSumUpConfigured()) throw Object.assign(new Error("SumUp non configuré — définir SUMUP_API_KEY et SUMUP_MERCHANT_CODE"), { status: 503 });
  const payload = {
    checkout_reference: orderId,
    amount: money(amount),
    currency: "EUR",
    merchant_code: process.env.SUMUP_MERCHANT_CODE,
    description: description || `Commande Cardoria ${orderId}`,
    redirect_url: redirectUrl,
    hosted_checkout: { enabled: true }
  };
  if (returnUrl) payload.return_url = returnUrl;
  if (customerEmail) payload.customer_email = customerEmail;
  const c = await sumupRequest("POST", "/v0.1/checkouts", payload);
  const paymentId = makePaymentId();
  recordPayment({
    id: paymentId,
    orderId,
    source,
    sumupCheckoutId: c.id,
    amount: payload.amount,
    status: mapSumUpStatus(c.status),
    customerEmail: customerEmail || "",
    description: payload.description,
    metadata: { checkoutReference: orderId }
  });
  logAudit({ type: "payment", action: "sumup_checkout_created", user: customerEmail || "client", detail: `${orderId} — ${c.id}` });
  return {
    checkoutId: c.id,
    sessionId: c.id,
    providerOrderId: c.id,
    url: c.hosted_checkout_url,
    status: mapSumUpStatus(c.status),
    paymentId,
    environment: "production"
  };
}

function reservationStillHolds(order) {
  if (String(order?.paymentStatus || "").toLowerCase() !== "pending") return false;
  const createdAt = Date.parse(order?.createdAt || "");
  return !Number.isFinite(createdAt) || Date.now() - createdAt < PENDING_RESERVATION_MS;
}

function orderCanConsumeStock(order) {
  if (reservationStillHolds(order)) return true;
  const catalog = new Map(listBoutiqueProducts({ includeDisabled: true }).map((product) => [String(product.id), product]));
  for (const item of order?.items || []) {
    const product = catalog.get(String(item.ref || item.id));
    const qty = Math.max(1, Math.trunc(Number(item.qty) || 1));
    if (!product || qty > Number(product.stock || 0)) return false;
  }
  return true;
}

export function sumupCheckoutMatchesOrder(checkout, order) {
  const rawAmount = checkout?.amount;
  const amount = money(rawAmount);
  const expected = money(order?.total);
  const currency = String(checkout?.currency || "EUR").toUpperCase();
  const reference = String(checkout?.checkout_reference || "").trim();
  if (reference && order?.id && reference !== String(order.id)) return { ok: false, reason: "reference" };
  if (checkout?.currency && currency !== "EUR") return { ok: false, reason: "currency" };
  if (rawAmount != null && rawAmount !== "" && Number.isFinite(Number(rawAmount)) && Number.isFinite(expected) && amount !== expected) {
    return { ok: false, reason: "amount" };
  }
  return { ok: true };
}

function applyBoutiqueUnlocked(orderId, status, { checkoutId, transactionId, paymentMethod, checkout } = {}) {
  const orders = readJson("orders", []);
  const i = orders.findIndex((row) => row.id === orderId);
  if (i < 0) return null;
  const o = orders[i];
  const previous = o.paymentStatus;
  if (previous === "paid" && status !== "refunded") return { ...o, alreadyPaid: true };
  if (previous === status) return { ...o, duplicate: true };

  if (transactionId) {
    const clash = orders.find((row) => (
      row.id !== orderId
      && String(row.sumupTransactionId || "") === String(transactionId)
      && ["paid", "refunded"].includes(String(row.paymentStatus || ""))
    ));
    if (clash) {
      o.paymentReviewRequired = true;
      o.reusedTransactionId = String(transactionId);
      o.updatedAt = new Date().toISOString();
      writeJson("orders", orders);
      return { ...o, duplicate: true, reusedTransaction: true };
    }
  }

  if (status === "paid" && checkout && o) {
    const match = sumupCheckoutMatchesOrder(checkout, o);
    if (!match.ok) {
      o.paymentReviewRequired = true;
      o.paymentMismatch = { reason: match.reason, expected: money(o.total), received: money(checkout.amount), currency: checkout.currency || "" };
      o.updatedAt = new Date().toISOString();
      writeJson("orders", orders);
      return { ...o, paymentMismatch: true };
    }
  }

  if (status === "paid" && previous !== "paid" && !orderCanConsumeStock(o)) {
    o.paymentReviewRequired = true;
    o.stockReconcileRequired = true;
    o.updatedAt = new Date().toISOString();
    writeJson("orders", orders);
    return { ...o, stockInsufficient: true };
  }

  o.paymentStatus = status;
  o.payment = { pending: "En attente SumUp", paid: "Payé SumUp (CB)", failed: "Paiement échoué", refunded: "Remboursé SumUp" }[status] || o.payment;
  o.sumupCheckoutId = checkoutId || o.sumupCheckoutId;
  o.paymentProviderOrderId = o.sumupCheckoutId;
  o.sumupTransactionId = transactionId || o.sumupTransactionId;
  o.paymentProviderTransactionId = o.sumupTransactionId;
  o.paymentMethod = paymentMethod || "sumup_card";
  o.updatedAt = new Date().toISOString();
  if (status === "paid" && previous !== "paid") o.status = "À préparer";
  if (status === "failed") o.status = "Paiement échoué";
  if (status === "refunded") {
    o.status = "Remboursée";
    o.paymentReviewRequired = false;
  }
  o.shipmentStatus = shipmentStatusOf(o);
  writeJson("orders", orders);
  return o;
}

export function applyBoutiquePayment(orderId, status, patch = {}) {
  return withBoutiqueOrderLock(() => applyBoutiqueUnlocked(orderId, status, patch));
}

function applyCardoriaStatus(orderId, status, patch) {
  if (String(orderId || "").startsWith("LCK-")) {
    return applyLivePaymentStatus(orderId, status, {
      paymentProviderOrderId: patch.checkoutId,
      paymentProviderTransactionId: patch.transactionId
    });
  }
  return applyBoutiquePayment(orderId, status, patch);
}

export async function syncPaymentFromCheckout(checkoutId) {
  const checkout = await retrieveSumUpCheckout(checkoutId);
  const status = mapSumUpStatus(checkout.status);
  const tx = checkout.transactions?.[0];
  const transactionId = tx?.id || tx?.transaction_code || checkout.transaction_code || "";
  const payment = getPaymentByCheckoutId(checkoutId);
  const orderId = payment?.orderId || checkout.checkout_reference;
  if (payment) updatePayment(payment.id, { status, sumupTransactionId: transactionId, paymentMethod: tx?.payment_type || "sumup_card" });
  const order = await applyCardoriaStatus(orderId, status, {
    checkoutId,
    transactionId,
    paymentMethod: tx?.payment_type || "sumup_card",
    checkout
  });
  let customerEmail = null;
  const firstPaid = status === "paid"
    && order
    && order.paymentStatus === "paid"
    && !order.alreadyPaid
    && !order.duplicate
    && !order.paymentMismatch
    && !order.stockInsufficient
    && orderId
    && !String(orderId).startsWith("LCK-");
  if (firstPaid) {
    try { customerEmail = await sendBoutiquePurchaseEmail(orderId); } catch (error) {
      console.warn("E-mail achat Boutique non envoyé :", orderId, String(error?.message || "erreur"));
    }
  }
  return { checkout, status, transactionId, payment: getPaymentByCheckoutId(checkoutId), orderId, order, customerEmail };
}

export async function handleSumUpWebhook(rawBody) {
  let event = {};
  try { event = JSON.parse(rawBody.toString()); } catch { throw Object.assign(new Error("Payload webhook invalide"), { status: 400 }); }
  const checkoutId = event.id || event.checkout_id || event.data?.id || event.payload?.checkout_id;
  if (!checkoutId) return { received: true, ignored: true };
  const result = await syncPaymentFromCheckout(checkoutId);
  logAudit({ type: "payment", action: "sumup_webhook_verified", user: "system", detail: `${checkoutId} → ${result.status}` });
  return { received: true, verifiedViaApi: true, checkoutId, ...result };
}

export const createPaymentLink = createSumUpCheckout;
