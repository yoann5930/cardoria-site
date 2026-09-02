/**
 * Paiements Revolut Merchant API — Boutique CardoriaShop.
 * Sandbox est le mode par défaut pour empêcher tout débit réel pendant les tests.
 */
import crypto from "crypto";
import { logAudit } from "../audit.js";
import { readJson, writeJson } from "../storage.js";
import { recordWitnotPurchase } from "../attribution/witnot.js";
import {
  recordPayment,
  getPaymentByProviderOrderId,
  getPaymentByOrderId,
  updatePayment
} from "./ledger.js";
import { makePaymentId } from "./migrate.js";

const API_VERSION = process.env.REVOLUT_API_VERSION || "2026-04-20";

function cleanEnvironment() {
  return String(process.env.REVOLUT_ENVIRONMENT || "sandbox").trim().toLowerCase() === "production" ? "production" : "sandbox";
}

export function getRevolutEnvironment() { return cleanEnvironment(); }

export function getRevolutApiBase() {
  const configured = String(process.env.REVOLUT_API_BASE || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return cleanEnvironment() === "production"
    ? "https://merchant.revolut.com"
    : "https://sandbox-merchant.revolut.com";
}

export function isRevolutConfigured() {
  return !!String(process.env.REVOLUT_SECRET_KEY || "").trim();
}

function toMinor(value) {
  return Math.round((Number(value) || 0) * 100);
}

async function revolutRequest(method, requestPath, body, { idempotencyKey } = {}) {
  const secret = String(process.env.REVOLUT_SECRET_KEY || "").trim();
  if (!secret) throw Object.assign(new Error("REVOLUT_SECRET_KEY non configurée"), { status: 503 });
  const headers = {
    Authorization: `Bearer ${secret}`,
    Accept: "application/json",
    "Revolut-Api-Version": API_VERSION
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${getRevolutApiBase()}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.message || data?.error?.message || data?.error || data?.detail || text || `Revolut HTTP ${response.status}`;
    throw Object.assign(new Error(String(message)), { status: response.status >= 400 && response.status < 500 ? response.status : 502, revolutStatus: response.status });
  }
  return data;
}

export function mapRevolutOrderStatus(orderOrState) {
  const order = typeof orderOrState === "object" && orderOrState ? orderOrState : { state: orderOrState };
  const amount = Number(order.amount || 0);
  const refunded = Number(order.refunded_amount || 0);
  if (amount > 0 && refunded >= amount) return "refunded";
  const state = String(order.state || "").toLowerCase();
  if (state === "completed") return "paid";
  if (["failed", "cancelled", "canceled"].includes(state)) return "failed";
  return "pending";
}

function extractTransactionId(order) {
  const payments = Array.isArray(order?.payments) ? order.payments : [];
  const completed = payments.find((item) => String(item?.state || "").toLowerCase() === "completed");
  return String(completed?.id || payments[0]?.id || "");
}

export async function createRevolutCheckout({
  orderId,
  amount,
  description,
  customerName,
  customerEmail,
  customerPhone,
  redirectUrl,
  source = "boutique"
}) {
  if (!isRevolutConfigured()) throw Object.assign(new Error("Revolut non configuré — définir REVOLUT_SECRET_KEY"), { status: 503 });
  const amountMinor = toMinor(amount);
  if (amountMinor <= 0) throw Object.assign(new Error("Montant de paiement invalide"), { status: 400 });

  const payload = {
    amount: amountMinor,
    currency: "EUR",
    description: description || `Commande CardoriaShop ${orderId}`,
    metadata: {
      cardoria_order_id: String(orderId),
      cardoria_source: String(source)
    }
  };
  if (customerEmail) {
    payload.customer = { email: String(customerEmail).trim().toLowerCase() };
    if (customerName) payload.customer.full_name = String(customerName).slice(0, 120);
    if (customerPhone) payload.customer.phone = String(customerPhone).slice(0, 40);
  }
  if (redirectUrl) payload.redirect_url = redirectUrl;

  const revolutOrder = await revolutRequest("POST", "/api/orders", payload);
  if (!revolutOrder?.id || !revolutOrder?.checkout_url) {
    throw Object.assign(new Error("Revolut n'a pas renvoyé de lien Hosted Checkout valide"), { status: 502 });
  }

  const status = mapRevolutOrderStatus(revolutOrder);
  const paymentId = makePaymentId();
  recordPayment({
    id: paymentId,
    orderId,
    source,
    provider: "revolut",
    providerOrderId: revolutOrder.id,
    providerTransactionId: extractTransactionId(revolutOrder),
    amount: Number(amount),
    currency: "EUR",
    status,
    paymentMethod: "revolut_hosted",
    customerEmail: customerEmail || "",
    customerName: customerName || "",
    description: payload.description,
    metadata: {
      environment: cleanEnvironment(),
      apiVersion: API_VERSION,
      revolutState: revolutOrder.state || ""
    }
  });
  logAudit({ type: "payment", action: "revolut_order_created", user: customerEmail || "client", detail: `${orderId} — ${revolutOrder.id} — ${cleanEnvironment()}` });

  return {
    provider: "revolut",
    environment: cleanEnvironment(),
    checkoutId: revolutOrder.id,
    providerOrderId: revolutOrder.id,
    token: revolutOrder.token || "",
    url: revolutOrder.checkout_url,
    status,
    paymentId
  };
}

export async function retrieveRevolutOrder(revolutOrderId) {
  return revolutRequest("GET", `/api/orders/${encodeURIComponent(revolutOrderId)}`);
}

function applyBoutiqueStatus(orderId, status, { providerOrderId, providerTransactionId, paymentMethod } = {}) {
  const orders = readJson("orders", []);
  const index = orders.findIndex((item) => String(item.id) === String(orderId));
  if (index < 0) return null;
  const current = orders[index];
  const previous = current.paymentStatus;
  const labels = {
    pending: "En attente Revolut",
    paid: "Payé Revolut",
    failed: "Paiement Revolut échoué",
    refunded: "Remboursé Revolut"
  };
  current.paymentStatus = status;
  current.payment = labels[status] || current.payment;
  current.paymentProvider = "revolut";
  current.paymentProviderOrderId = providerOrderId || current.paymentProviderOrderId || "";
  current.paymentProviderTransactionId = providerTransactionId || current.paymentProviderTransactionId || "";
  current.paymentMethod = paymentMethod || current.paymentMethod || "revolut_hosted";
  current.updatedAt = new Date().toISOString();

  if (status === "paid") {
    if (["En attente Revolut", "En attente SumUp", "En attente"].includes(current.status) || current.status === "Paiement test") current.status = "À préparer";
    if (previous !== "paid" && current.trafficSource === "witnot") {
      recordWitnotPurchase({ visitorId: current.visitorId, trafficSource: "witnot", orderId: current.id, amount: current.total, email: current.email });
    }
  } else if (status === "failed" && !["Expédiée", "Livrée"].includes(current.status)) {
    current.status = "Paiement échoué";
  }

  orders[index] = current;
  writeJson("orders", orders);
  logAudit({ type: "payment", action: `boutique_revolut_${status}`, user: current.email || "client", detail: orderId });
  return current;
}

export async function syncRevolutOrder(revolutOrderId) {
  const order = await retrieveRevolutOrder(revolutOrderId);
  const status = mapRevolutOrderStatus(order);
  const payment = getPaymentByProviderOrderId(revolutOrderId);
  const transactionId = extractTransactionId(order);
  if (payment) {
    updatePayment(payment.id, {
      provider: "revolut",
      providerOrderId: revolutOrderId,
      providerTransactionId: transactionId,
      status,
      paymentMethod: "revolut_hosted",
      metadata: {
        ...(payment.metadata || {}),
        environment: cleanEnvironment(),
        apiVersion: API_VERSION,
        revolutState: order.state || "",
        refundedAmountMinor: Number(order.refunded_amount || 0)
      }
    });
    if (payment.source === "boutique" || String(payment.orderId || "").startsWith("CMD-")) {
      applyBoutiqueStatus(payment.orderId, status, {
        providerOrderId: revolutOrderId,
        providerTransactionId: transactionId,
        paymentMethod: "revolut_hosted"
      });
    }
  }
  return { order, status, payment: payment ? getPaymentByProviderOrderId(revolutOrderId) : null };
}

export async function syncRevolutOrderByCardoriaOrder(orderId) {
  const payment = getPaymentByOrderId(orderId, "revolut");
  if (!payment?.providerOrderId) throw Object.assign(new Error("Commande Revolut introuvable pour cette commande CardoriaShop"), { status: 404 });
  return syncRevolutOrder(payment.providerOrderId);
}

export async function refundRevolutOrder(revolutOrderId, { amount, currency = "EUR", description = "Remboursement CardoriaShop" } = {}) {
  const body = {};
  if (amount != null) {
    const minor = toMinor(amount);
    if (minor <= 0) throw Object.assign(new Error("Montant de remboursement invalide"), { status: 400 });
    body.amount = minor;
    body.currency = currency;
  }
  if (description) body.description = description;
  await revolutRequest("POST", `/api/orders/${encodeURIComponent(revolutOrderId)}/refund`, body, { idempotencyKey: crypto.randomUUID() });
  return syncRevolutOrder(revolutOrderId);
}

export function verifyRevolutWebhookSignature(rawBody, timestampHeader, signatureHeader) {
  const secret = String(process.env.REVOLUT_WEBHOOK_SECRET || "").trim();
  if (!secret) return cleanEnvironment() !== "production";
  if (!rawBody || !timestampHeader || !signatureHeader) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const expected = crypto.createHmac("sha256", secret).update(`v1.${timestampHeader}.${payload}`).digest("hex");
  const candidates = String(signatureHeader).split(",").map((part) => part.trim()).filter(Boolean);
  return candidates.some((candidate) => {
    const hex = candidate.replace(/^v1=/i, "");
    try {
      const a = Buffer.from(hex, "hex");
      const b = Buffer.from(expected, "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
  });
}

export async function handleRevolutWebhook(rawBody, timestampHeader, signatureHeader) {
  if (!verifyRevolutWebhookSignature(rawBody, timestampHeader, signatureHeader)) {
    throw Object.assign(new Error("Signature webhook Revolut invalide"), { status: 401 });
  }
  const payloadText = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  let event;
  try { event = JSON.parse(payloadText); } catch { throw Object.assign(new Error("Payload webhook Revolut invalide"), { status: 400 }); }
  const revolutOrderId = event?.order_id || event?.order?.id || event?.data?.order_id;
  if (!revolutOrderId) return { received: true, ignored: true };
  const result = await syncRevolutOrder(revolutOrderId);
  logAudit({ type: "payment", action: "revolut_webhook", user: "system", detail: `${event?.event || "event"} — ${revolutOrderId} → ${result.status}` });
  return { received: true, orderId: revolutOrderId, status: result.status };
}
