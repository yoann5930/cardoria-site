/** Paiements SumUp Cardoria — Boutique uniquement pour les nouveaux parcours. */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logAudit } from "../audit.js";
import { readJson, writeJson } from "../storage.js";
import { recordWitnotPurchase } from "../attribution/witnot.js";
import { markOrderPaid, markOrderPaymentStatus, getOrder, updateOrderSumUpRefs } from "../marketplace/orders.js";
import { recordPayment, getPaymentByCheckoutId, updatePayment } from "./ledger.js";
import { makePaymentId } from "./migrate.js";

const SUMUP_API = process.env.SUMUP_API_BASE || "https://api.sumup.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = path.resolve(__dirname, "../../../products.json");
const PENDING_RESERVATION_MS = 30 * 60 * 1000;

function money(n) { return Math.round(Number(n || 0) * 100) / 100; }
function loadShopProducts() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
  return Array.isArray(products) ? products : [];
}
function reservedQty(productId, orders) {
  const now = Date.now();
  return (orders || []).reduce((sum, order) => {
    const paid = order.paymentStatus === "paid" || ["À préparer", "Expédiée", "Livrée"].includes(order.status);
    const pendingFresh = order.paymentStatus === "pending" && (!order.createdAt || now - Date.parse(order.createdAt) < PENDING_RESERVATION_MS);
    if (!paid && !pendingFresh) return sum;
    return sum + (order.items || []).filter((i) => String(i.ref || i.id) === String(productId)).reduce((s, i) => s + Math.max(1, Number(i.qty) || 1), 0);
  }, 0);
}
function validateBoutiqueCart(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new Error("Panier vide");
  const catalog = new Map(loadShopProducts().map((p) => [String(p.id), p]));
  const orders = readJson("orders", []);
  return rawItems.map((raw) => {
    const ref = String(raw.ref || raw.id || "").trim();
    const product = catalog.get(ref);
    if (!product) throw Object.assign(new Error(`Produit inconnu: ${ref || "reference manquante"}`), { status: 400 });
    const qty = Math.max(1, Math.min(20, Number(raw.qty) || 1));
    const available = Math.max(0, Number(product.stock || 0) - reservedQty(product.id, orders));
    if (qty > available) throw Object.assign(new Error(`Stock insuffisant pour ${product.name} (${available} disponible).`), { status: 409 });
    return { ref: product.id, name: product.name, qty, price: money(product.price), category: product.category || "" };
  });
}

export function isSumUpConfigured() { return !!(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE); }
async function sumupRequest(method, requestPath, body) {
  if (!process.env.SUMUP_API_KEY) throw new Error("SUMUP_API_KEY non configurée");
  const res = await fetch(`${SUMUP_API}${requestPath}`, { method, headers: { Authorization: `Bearer ${process.env.SUMUP_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.message || data.error_message || data.detail || text || `SumUp HTTP ${res.status}`);
  return data;
}
export function mapSumUpStatus(status) {
  const s = String(status || "").toUpperCase();
  if (["PAID", "SUCCESSFUL", "SUCCESS"].includes(s)) return "paid";
  if (["FAILED", "DECLINED", "CANCELLED", "CANCELED"].includes(s)) return "failed";
  if (s === "REFUNDED") return "refunded";
  return "pending";
}
export async function retrieveSumUpCheckout(checkoutId) { return sumupRequest("GET", `/v0.1/checkouts/${checkoutId}`); }

export async function createSumUpCheckout({ orderId, amount, description, customerEmail, redirectUrl, returnUrl, source = "marketplace" }) {
  if (!isSumUpConfigured()) throw new Error("SumUp non configuré — définir SUMUP_API_KEY et SUMUP_MERCHANT_CODE");
  const payload = { checkout_reference: orderId, amount: money(amount), currency: "EUR", merchant_code: process.env.SUMUP_MERCHANT_CODE, description: description || `Commande Cardoria ${orderId}`, redirect_url: redirectUrl, hosted_checkout: { enabled: true } };
  if (returnUrl) payload.return_url = returnUrl;
  if (customerEmail) payload.customer_email = customerEmail;
  const checkout = await sumupRequest("POST", "/v0.1/checkouts", payload);
  const paymentId = makePaymentId();
  recordPayment({ id: paymentId, orderId, source, sumupCheckoutId: checkout.id, amount: payload.amount, status: mapSumUpStatus(checkout.status), customerEmail: customerEmail || "", description: payload.description, metadata: { checkoutReference: orderId } });
  logAudit({ type: "payment", action: "sumup_checkout_created", user: customerEmail || "client", detail: `${orderId} — ${checkout.id}` });
  return { checkoutId: checkout.id, sessionId: checkout.id, url: checkout.hosted_checkout_url, status: mapSumUpStatus(checkout.status), paymentId };
}

export async function createCheckoutSession(order, successUrl) {
  updateOrderSumUpRefs(order.id, null, "pending");
  const redirect = successUrl + (successUrl.includes("?") ? "&" : "?") + "order=" + encodeURIComponent(order.id);
  return createSumUpCheckout({ orderId: order.id, amount: order.total, description: `Marketplace — ${order.listingTitle || order.id}`, customerEmail: order.buyerEmail, redirectUrl: redirect, returnUrl: process.env.SUMUP_RETURN_URL || undefined, source: "marketplace" }).then((session) => { updateOrderSumUpRefs(order.id, session.checkoutId, "pending"); return session; });
}

export async function syncPaymentFromCheckout(checkoutId) {
  const checkout = await retrieveSumUpCheckout(checkoutId);
  const status = mapSumUpStatus(checkout.status);
  const tx = checkout.transactions?.[0];
  const transactionId = tx?.id || tx?.transaction_code || checkout.transaction_code || "";
  const payment = getPaymentByCheckoutId(checkoutId);
  if (payment) updatePayment(payment.id, { status, sumupTransactionId: transactionId, paymentMethod: tx?.payment_type || "sumup_card" });
  await applyPaymentStatus(payment?.orderId || checkout.checkout_reference, status, { checkoutId, transactionId, source: payment?.source || "marketplace", paymentMethod: tx?.payment_type || "sumup_card" });
  return { checkout, status, payment: getPaymentByCheckoutId(checkoutId) };
}

export async function applyPaymentStatus(orderId, status, { checkoutId, transactionId, source, paymentMethod } = {}) {
  if (!orderId) return null;
  if (source === "boutique" || String(orderId).startsWith("CMD-")) return applyBoutiquePaymentStatus(orderId, status, { checkoutId, transactionId, paymentMethod });
  if (status === "paid") {
    markOrderPaid(orderId, { sumupCheckoutId: checkoutId, sumupTransactionId: transactionId, paymentMethod: paymentMethod || "sumup_card" });
    logAudit({ type: "payment", action: "marketplace_paid", user: "system", detail: orderId });
  } else markOrderPaymentStatus(orderId, status, { sumupCheckoutId: checkoutId, sumupTransactionId: transactionId, paymentMethod });
  return getOrder(orderId);
}

function applyBoutiquePaymentStatus(orderId, status, { checkoutId, transactionId, paymentMethod } = {}) {
  const orders = readJson("orders", []);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;
  const labels = { pending: "En attente SumUp", paid: "Payé SumUp (CB)", failed: "Paiement échoué", refunded: "Remboursé SumUp" };
  const previousStatus = orders[idx].paymentStatus;
  orders[idx].paymentStatus = status;
  orders[idx].payment = labels[status] || orders[idx].payment;
  orders[idx].sumupCheckoutId = checkoutId || orders[idx].sumupCheckoutId;
  orders[idx].sumupTransactionId = transactionId || orders[idx].sumupTransactionId;
  orders[idx].paymentMethod = paymentMethod || "sumup_card";
  orders[idx].updatedAt = new Date().toISOString();
  if (status === "paid") {
    if (["En attente SumUp", "En attente"].includes(orders[idx].status) || orders[idx].payment === "Paiement test") orders[idx].status = "À préparer";
    if (previousStatus !== "paid" && orders[idx].trafficSource === "witnot") recordWitnotPurchase({ visitorId: orders[idx].visitorId, trafficSource: "witnot", orderId: orders[idx].id, amount: orders[idx].total, email: orders[idx].email });
  }
  writeJson("orders", orders);
  logAudit({ type: "payment", action: "boutique_" + status, user: orders[idx].email || "client", detail: orderId });
  return orders[idx];
}

export async function createBoutiqueCheckout({ customerName, customerEmail, items, shipping, successUrl, trafficSource, visitorId }) {
  const verifiedItems = validateBoutiqueCart(items);
  const shippingCost = 0; // Boutique: livraison Standard gratuite tant qu'aucun tarif serveur n'est configure.
  const total = money(verifiedItems.reduce((s, i) => s + i.qty * i.price, 0) + shippingCost);
  const orderId = "CMD-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomInt(1000, 10000);
  const now = new Date().toISOString();
  const order = { id: orderId, date: now.slice(0, 10), createdAt: now, updatedAt: now, client: String(customerName || "").slice(0, 120), email: String(customerEmail || "").trim().toLowerCase().slice(0, 254), address: "", items: verifiedItems, payment: "En attente SumUp", paymentStatus: "pending", status: "En attente SumUp", shipping: shipping || "Standard", shippingCost, tracking: "", total, sumupCheckoutId: "", sumupTransactionId: "", trafficSource: trafficSource === "witnot" ? "witnot" : "", visitorId: visitorId || "" };
  const orders = readJson("orders", []); orders.unshift(order); writeJson("orders", orders);
  const base = String(process.env.SITE_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const defaultSuccess = base ? `${base}/boutique.html` : "/boutique.html";
  const target = successUrl || process.env.BOUTIQUE_SUCCESS_URL || defaultSuccess;
  const redirect = target + (target.includes("?") ? "&" : "?") + "paid=1&order=" + encodeURIComponent(orderId);
  try {
    const session = await createSumUpCheckout({ orderId, amount: total, description: `Boutique Cardoria — ${verifiedItems.length} article(s)`, customerEmail: order.email, redirectUrl: redirect, source: "boutique" });
    const updated = readJson("orders", []); const i = updated.findIndex((o) => o.id === orderId); if (i >= 0) { updated[i].sumupCheckoutId = session.checkoutId; updated[i].updatedAt = new Date().toISOString(); writeJson("orders", updated); }
    return { order: { ...order, sumupCheckoutId: session.checkoutId }, ...session };
  } catch (error) {
    const updated = readJson("orders", []); const i = updated.findIndex((o) => o.id === orderId); if (i >= 0) { updated[i].paymentStatus = "failed"; updated[i].status = "Paiement échoué"; updated[i].updatedAt = new Date().toISOString(); writeJson("orders", updated); }
    throw error;
  }
}

export function verifySumUpWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.SUMUP_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return !secret;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sig = String(signatureHeader).replace(/^sha256=/i, "").trim();
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}
export async function handleSumUpWebhook(rawBody, signatureHeader) {
  if (process.env.NODE_ENV === "production" && !process.env.SUMUP_WEBHOOK_SECRET) throw new Error("SUMUP_WEBHOOK_SECRET obligatoire en production");
  if (process.env.SUMUP_WEBHOOK_SECRET && !verifySumUpWebhookSignature(rawBody, signatureHeader)) throw new Error("Signature webhook SumUp invalide");
  let event = {}; try { event = JSON.parse(rawBody.toString()); } catch { throw new Error("Payload webhook invalide"); }
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
export const createPaymentLink = createSumUpCheckout;
