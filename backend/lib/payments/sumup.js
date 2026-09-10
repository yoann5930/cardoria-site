/** Paiements SumUp Cardoria — Boutique et Live Admin. */
import crypto from "crypto";
import { logAudit } from "../audit.js";
import { recordPayment, getPaymentByCheckoutId, updatePayment } from "./ledger.js";
import { makePaymentId } from "./migrate.js";

const SUMUP_API = process.env.SUMUP_API_BASE || "https://api.sumup.com";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

export function isSumUpConfigured() { return !!(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE); }
async function sumupRequest(method, requestPath, body) {
  if (!process.env.SUMUP_API_KEY) throw Object.assign(new Error("SUMUP_API_KEY non configurée"), { status: 503 });
  const res = await fetch(`${SUMUP_API}${requestPath}`, { method, headers: { Authorization: `Bearer ${process.env.SUMUP_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(data.message || data.error_message || data.detail || text || `SumUp HTTP ${res.status}`), { status: res.status });
  return data;
}
export function mapSumUpStatus(status) {
  const s = String(status || "").toUpperCase();
  if (["PAID", "SUCCESSFUL", "SUCCESS"].includes(s)) return "paid";
  if (["FAILED", "DECLINED", "CANCELLED", "CANCELED"].includes(s)) return "failed";
  if (s === "REFUNDED") return "refunded";
  return "pending";
}
export async function retrieveSumUpCheckout(checkoutId) { return sumupRequest("GET", `/v0.1/checkouts/${encodeURIComponent(checkoutId)}`); }
export async function createSumUpCheckout({ orderId, amount, description, customerEmail, redirectUrl, returnUrl, source = "boutique" }) {
  if (!isSumUpConfigured()) throw Object.assign(new Error("SumUp non configuré — définir SUMUP_API_KEY et SUMUP_MERCHANT_CODE"), { status: 503 });
  const payload = { checkout_reference: orderId, amount: money(amount), currency: "EUR", merchant_code: process.env.SUMUP_MERCHANT_CODE, description: description || `Commande Cardoria ${orderId}`, redirect_url: redirectUrl, hosted_checkout: { enabled: true } };
  if (returnUrl) payload.return_url = returnUrl;
  if (customerEmail) payload.customer_email = customerEmail;
  const checkout = await sumupRequest("POST", "/v0.1/checkouts", payload);
  const paymentId = makePaymentId();
  recordPayment({ id: paymentId, orderId, source, sumupCheckoutId: checkout.id, amount: payload.amount, status: mapSumUpStatus(checkout.status), customerEmail: customerEmail || "", description: payload.description, metadata: { checkoutReference: orderId } });
  logAudit({ type: "payment", action: "sumup_checkout_created", user: customerEmail || "client", detail: `${orderId} — ${checkout.id}` });
  return { checkoutId: checkout.id, sessionId: checkout.id, providerOrderId: checkout.id, url: checkout.hosted_checkout_url, status: mapSumUpStatus(checkout.status), paymentId, environment: "production" };
}
export async function syncPaymentFromCheckout(checkoutId) {
  const checkout = await retrieveSumUpCheckout(checkoutId);
  const status = mapSumUpStatus(checkout.status);
  const tx = checkout.transactions?.[0];
  const transactionId = tx?.id || tx?.transaction_code || checkout.transaction_code || "";
  const payment = getPaymentByCheckoutId(checkoutId);
  if (payment) updatePayment(payment.id, { status, sumupTransactionId: transactionId, paymentMethod: tx?.payment_type || "sumup_card" });
  return { checkout, status, transactionId, payment: getPaymentByCheckoutId(checkoutId), orderId: payment?.orderId || checkout.checkout_reference };
}
export function verifySumUpWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.SUMUP_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return !secret;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sig = String(signatureHeader).replace(/^sha256=/i, "").trim();
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}
export async function handleSumUpWebhook(rawBody, signatureHeader) {
  if (process.env.NODE_ENV === "production" && !process.env.SUMUP_WEBHOOK_SECRET) throw Object.assign(new Error("SUMUP_WEBHOOK_SECRET obligatoire en production"), { status: 503 });
  if (process.env.SUMUP_WEBHOOK_SECRET && !verifySumUpWebhookSignature(rawBody, signatureHeader)) throw Object.assign(new Error("Signature webhook SumUp invalide"), { status: 401 });
  let event = {}; try { event = JSON.parse(rawBody.toString()); } catch { throw Object.assign(new Error("Payload webhook invalide"), { status: 400 }); }
  const checkoutId = event.id || event.checkout_id || event.data?.id || event.payload?.checkout_id;
  if (!checkoutId) return { received: true, ignored: true };
  const result = await syncPaymentFromCheckout(checkoutId);
  logAudit({ type: "payment", action: "sumup_webhook", user: "system", detail: `${checkoutId} → ${result.status}` });
  return { received: true, checkoutId, ...result };
}
export const createPaymentLink = createSumUpCheckout;
