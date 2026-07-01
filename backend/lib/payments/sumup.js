/**
 * Paiements SumUp Cardoria — CB via lien hosted checkout.
 * Variables : SUMUP_API_KEY, SUMUP_MERCHANT_CODE, SUMUP_WEBHOOK_SECRET
 */
import crypto from "crypto";
import { logAudit } from "../audit.js";
import { readJson, writeJson } from "../storage.js";
import { recordWitnotPurchase } from "../attribution/witnot.js";
import { markOrderPaid, markOrderPaymentStatus, getOrder, updateOrderSumUpRefs } from "../marketplace/orders.js";
import { recordPayment, updatePaymentByCheckoutId, getPaymentByCheckoutId, updatePayment } from "./ledger.js";
import { makePaymentId } from "./migrate.js";

const SUMUP_API = process.env.SUMUP_API_BASE || "https://api.sumup.com";

export function isSumUpConfigured() {
  return !!(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE);
}

async function sumupRequest(method, path, body) {
  if (!process.env.SUMUP_API_KEY) throw new Error("SUMUP_API_KEY non configurée");
  const res = await fetch(`${SUMUP_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SUMUP_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data.message || data.error_message || data.detail || text || `SumUp HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export function mapSumUpStatus(status) {
  const s = String(status || "").toUpperCase();
  if (["PAID", "SUCCESSFUL", "SUCCESS"].includes(s)) return "paid";
  if (["FAILED", "DECLINED", "CANCELLED", "CANCELED"].includes(s)) return "failed";
  if (["REFUNDED"].includes(s)) return "refunded";
  return "pending";
}

export async function retrieveSumUpCheckout(checkoutId) {
  return sumupRequest("GET", `/v0.1/checkouts/${checkoutId}`);
}

export async function createSumUpCheckout({ orderId, amount, description, customerEmail, redirectUrl, returnUrl, source = "marketplace" }) {
  if (!isSumUpConfigured()) throw new Error("SumUp non configuré — définir SUMUP_API_KEY et SUMUP_MERCHANT_CODE");

  const payload = {
    checkout_reference: orderId,
    amount: Math.round(Number(amount) * 100) / 100,
    currency: "EUR",
    merchant_code: process.env.SUMUP_MERCHANT_CODE,
    description: description || `Commande Cardoria ${orderId}`,
    redirect_url: redirectUrl,
    hosted_checkout: { enabled: true }
  };
  if (returnUrl) payload.return_url = returnUrl;
  if (customerEmail) payload.customer_email = customerEmail;

  const checkout = await sumupRequest("POST", "/v0.1/checkouts", payload);
  const paymentId = makePaymentId();

  recordPayment({
    id: paymentId,
    orderId,
    source,
    sumupCheckoutId: checkout.id,
    amount: payload.amount,
    status: mapSumUpStatus(checkout.status),
    customerEmail: customerEmail || "",
    description: payload.description,
    metadata: { checkoutReference: orderId }
  });

  logAudit({ type: "payment", action: "sumup_checkout_created", user: customerEmail || "client", detail: `${orderId} — ${checkout.id}` });

  return {
    checkoutId: checkout.id,
    sessionId: checkout.id,
    url: checkout.hosted_checkout_url,
    status: mapSumUpStatus(checkout.status),
    paymentId
  };
}

/** Compatibilité route marketplace — alias createCheckoutSession */
export async function createCheckoutSession(order, successUrl, cancelUrl) {
  updateOrderSumUpRefs(order.id, null, "pending");
  const redirect = successUrl + (successUrl.includes("?") ? "&" : "?") + "order=" + encodeURIComponent(order.id);
  return createSumUpCheckout({
    orderId: order.id,
    amount: order.total,
    description: `Marketplace — ${order.listingTitle || order.id}`,
    customerEmail: order.buyerEmail,
    redirectUrl: redirect,
    returnUrl: process.env.SUMUP_RETURN_URL || undefined,
    source: "marketplace"
  }).then((session) => {
    updateOrderSumUpRefs(order.id, session.checkoutId, "pending");
    return session;
  });
}

export async function syncPaymentFromCheckout(checkoutId) {
  const checkout = await retrieveSumUpCheckout(checkoutId);
  const status = mapSumUpStatus(checkout.status);
  const tx = checkout.transactions?.[0];
  const transactionId = tx?.id || tx?.transaction_code || checkout.transaction_code || "";

  const payment = getPaymentByCheckoutId(checkoutId);
  if (payment) {
    updatePayment(payment.id, {
      status,
      sumupTransactionId: transactionId,
      paymentMethod: tx?.payment_type || "sumup_card"
    });
  }

  await applyPaymentStatus(payment?.orderId || checkout.checkout_reference, status, {
    checkoutId,
    transactionId,
    source: payment?.source || "marketplace",
    paymentMethod: tx?.payment_type || "sumup_card"
  });

  return { checkout, status, payment: getPaymentByCheckoutId(checkoutId) };
}

export async function applyPaymentStatus(orderId, status, { checkoutId, transactionId, source, paymentMethod } = {}) {
  if (!orderId) return null;

  if (source === "boutique" || String(orderId).startsWith("CMD-")) {
    return applyBoutiquePaymentStatus(orderId, status, { checkoutId, transactionId, paymentMethod });
  }

  if (status === "paid") {
    markOrderPaid(orderId, {
      sumupCheckoutId: checkoutId,
      sumupTransactionId: transactionId,
      paymentMethod: paymentMethod || "sumup_card"
    });
    logAudit({ type: "payment", action: "marketplace_paid", user: "system", detail: orderId });
  } else {
    markOrderPaymentStatus(orderId, status, { sumupCheckoutId: checkoutId, sumupTransactionId: transactionId, paymentMethod });
  }
  return getOrder(orderId);
}

function applyBoutiquePaymentStatus(orderId, status, { checkoutId, transactionId, paymentMethod } = {}) {
  const orders = readJson("orders", []);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;

  const labels = { pending: "En attente SumUp", paid: "Payé SumUp (CB)", failed: "Paiement échoué", refunded: "Remboursé SumUp" };
  orders[idx].paymentStatus = status;
  orders[idx].payment = labels[status] || orders[idx].payment;
  orders[idx].sumupCheckoutId = checkoutId || orders[idx].sumupCheckoutId;
  orders[idx].sumupTransactionId = transactionId || orders[idx].sumupTransactionId;
  orders[idx].paymentMethod = paymentMethod || "sumup_card";
  if (status === "paid") {
    const prev = orders[idx].status;
    if (prev === "En attente SumUp" || prev === "En attente" || orders[idx].payment === "Paiement test") {
      orders[idx].status = "À préparer";
    }
    if (orders[idx].trafficSource === "witnot") {
      recordWitnotPurchase({
        visitorId: orders[idx].visitorId,
        trafficSource: "witnot",
        orderId: orders[idx].id,
        amount: orders[idx].total,
        email: orders[idx].email
      });
    }
  }
  writeJson("orders", orders);
  logAudit({ type: "payment", action: "boutique_" + status, user: orders[idx].email || "client", detail: orderId });
  return orders[idx];
}

export async function createBoutiqueCheckout({ customerName, customerEmail, items, shippingCost, shipping, successUrl, trafficSource, visitorId }) {
  if (!items?.length) throw new Error("Panier vide");
  const total = Math.round((items.reduce((s, i) => s + i.qty * i.price, 0) + Number(shippingCost || 0)) * 100) / 100;
  const orderId = "CMD-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
  const now = new Date().toISOString().slice(0, 10);

  const order = {
    id: orderId,
    date: now,
    client: customerName || "",
    email: customerEmail || "",
    address: "",
    items,
    payment: "En attente SumUp",
    paymentStatus: "pending",
    status: "En attente SumUp",
    shipping: shipping || "À définir",
    tracking: "",
    total,
    sumupCheckoutId: "",
    sumupTransactionId: "",
    trafficSource: trafficSource === "witnot" ? "witnot" : "",
    visitorId: visitorId || ""
  };

  const orders = readJson("orders", []);
  orders.unshift(order);
  writeJson("orders", orders.slice(0, 500));

  const redirect = (successUrl || process.env.BOUTIQUE_SUCCESS_URL || "https://cardoria.vercel.app/boutique.html") +
    (successUrl?.includes("?") ? "&" : "?") + "paid=1&order=" + encodeURIComponent(orderId);

  const session = await createSumUpCheckout({
    orderId,
    amount: total,
    description: `Boutique Cardoria — ${items.length} article(s)`,
    customerEmail,
    redirectUrl: redirect,
    source: "boutique"
  });

  order.sumupCheckoutId = session.checkoutId;
  const updated = readJson("orders", []);
  const i = updated.findIndex((o) => o.id === orderId);
  if (i >= 0) {
    updated[i].sumupCheckoutId = session.checkoutId;
    writeJson("orders", updated);
  }

  return { order, ...session };
}

export function verifySumUpWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.SUMUP_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return !secret;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sig = String(signatureHeader).replace(/^sha256=/i, "").trim();
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return sig === expected;
  }
}

export async function handleSumUpWebhook(rawBody, signatureHeader) {
  if (process.env.NODE_ENV === "production" && !process.env.SUMUP_WEBHOOK_SECRET) {
    throw new Error("SUMUP_WEBHOOK_SECRET obligatoire en production");
  }
  if (process.env.SUMUP_WEBHOOK_SECRET && !verifySumUpWebhookSignature(rawBody, signatureHeader)) {
    throw new Error("Signature webhook SumUp invalide");
  }
  if (!process.env.SUMUP_WEBHOOK_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("Webhook non signé refusé en production");
  }

  let event = {};
  try { event = JSON.parse(rawBody.toString()); } catch { throw new Error("Payload webhook invalide"); }

  const checkoutId = event.id || event.checkout_id || event.data?.id || event.payload?.checkout_id;
  if (!checkoutId) return { received: true, ignored: true };

  const result = await syncPaymentFromCheckout(checkoutId);
  logAudit({ type: "payment", action: "sumup_webhook", user: "system", detail: `${checkoutId} → ${result.status}` });
  return { received: true, checkoutId, status: result.status };
}

export async function handleSumUpReturnCallback(body) {
  const checkoutId = body?.checkout_id || body?.id;
  if (!checkoutId) return { ok: false, error: "checkout_id manquant" };
  const result = await syncPaymentFromCheckout(checkoutId);
  return { ok: true, ...result };
}

/** @deprecated — conservé pour compatibilité interne uniquement */
export const createPaymentLink = createSumUpCheckout;
