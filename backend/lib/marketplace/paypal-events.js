/** PayPal webhooks + remboursements Marketplace Cardoria. */
import { getDb } from "../engine/database.js";
import { getSeller } from "./sellers.js";
import { getOrder, updateOrderStatus, markOrderPaymentStatus } from "./orders.js";
import { captureLivePayPalOrder, captureMarketplacePayPalOrder } from "./paypal.js";
import { applyLivePaymentStatus, listLiveCheckouts } from "../live/sessions.js";

const PROTECTED_ORDER_STATUSES = new Set(["paid", "preparing", "shipped", "delivered", "refunded"]);
let testVerify = null;

export function __setPayPalWebhookVerifyForTests(fn) {
  testVerify = typeof fn === "function" ? fn : null;
}

export function __resetPayPalWebhookVerifyForTests() {
  testVerify = null;
}

function envName() { return String(process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "live" : "sandbox"; }
function apiBase() { return envName() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"; }
async function accessToken() {
  const id = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!id || !secret) throw Object.assign(new Error("PayPal non configure."), { status: 503 });
  const response = await fetch(`${apiBase()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw Object.assign(new Error(data.error_description || "Authentification PayPal impossible."), { status: response.status || 502 });
  return data.access_token;
}
async function request(path, { method = "POST", body, sellerMerchantId = "" } = {}) {
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "PayPal-Partner-Attribution-Id": String(process.env.PAYPAL_PARTNER_ATTRIBUTION_ID || "").trim() };
  if (sellerMerchantId) {
    const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64");
    headers["PayPal-Auth-Assertion"] = `${b64({ alg: "none" })}.${b64({ iss: clientId, payer_id: sellerMerchantId })}.`;
  }
  const response = await fetch(`${apiBase()}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.details?.[0]?.description || data?.message || `PayPal HTTP ${response.status}`), { status: response.status, paypal: data });
  return data;
}

export function paypalWebhookConfigured() { return Boolean(String(process.env.PAYPAL_WEBHOOK_ID || "").trim()); }

export async function verifyPayPalWebhook(headers, event) {
  if (testVerify) return testVerify(headers, event);
  const webhookId = String(process.env.PAYPAL_WEBHOOK_ID || "").trim();
  if (!webhookId) throw Object.assign(new Error("PAYPAL_WEBHOOK_ID obligatoire."), { status: 503 });
  const payload = {
    auth_algo: String(headers["paypal-auth-algo"] || ""),
    cert_url: String(headers["paypal-cert-url"] || ""),
    transmission_id: String(headers["paypal-transmission-id"] || ""),
    transmission_sig: String(headers["paypal-transmission-sig"] || ""),
    transmission_time: String(headers["paypal-transmission-time"] || ""),
    webhook_id: webhookId,
    webhook_event: event
  };
  if (!payload.auth_algo || !payload.cert_url || !payload.transmission_id || !payload.transmission_sig || !payload.transmission_time) return false;
  const result = await request("/v1/notifications/verify-webhook-signature", { method: "POST", body: payload });
  return result.verification_status === "SUCCESS";
}

export async function handlePayPalWebhook(headers, event) {
  if (!await verifyPayPalWebhook(headers, event)) throw Object.assign(new Error("Signature webhook PayPal invalide."), { status: 400 });
  const type = String(event?.event_type || "");
  const resource = event?.resource || {};
  if (type === "CHECKOUT.ORDER.APPROVED" && resource.id) {
    const existing = getDb().prepare("SELECT COUNT(*) AS n FROM mk_orders WHERE paypal_order_id=? AND payment_status='paid'").get(resource.id)?.n || 0;
    const total = getDb().prepare("SELECT COUNT(*) AS n FROM mk_orders WHERE paypal_order_id=?").get(resource.id)?.n || 0;
    if (total > 0 && existing < total) return { received: true, type, capture: await captureMarketplacePayPalOrder(resource.id) };
    const liveCheckout = listLiveCheckouts().find((item) => item.paymentProviderOrderId === resource.id);
    if (liveCheckout && liveCheckout.status !== "paid") {
      return { received: true, type, capture: await captureLivePayPalOrder(resource.id) };
    }
  }
  if (["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(type) && resource.id) {
    const rows = getDb().prepare("SELECT id FROM mk_orders WHERE paypal_capture_id=?").all(resource.id);
    for (const row of rows) {
      const order = getOrder(row.id);
      if (order && order.status !== "refunded") updateOrderStatus(row.id, "refunded", { paymentStatus: "refunded", paymentMethod: "paypal" });
    }
    return { received: true, type, updated: rows.length };
  }
  if (type === "PAYMENT.CAPTURE.PENDING") {
    return { received: true, type, ...applyCapturePending(resource) };
  }
  if (type === "PAYMENT.CAPTURE.DENIED") {
    return { received: true, type, ...applyCaptureDenied(resource) };
  }
  if (type === "CHECKOUT.ORDER.DECLINED") {
    return { received: true, type, ...applyOrderDeclined(resource) };
  }
  return { received: true, type, ignored: true };
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function resourceIds(resource = {}, { captureEvent = false } = {}) {
  const units = Array.isArray(resource.purchase_units) ? resource.purchase_units : [];
  const relatedOrderId = String(resource.supplementary_data?.related_ids?.order_id || "").trim();
  return {
    captureId: captureEvent ? String(resource.id || "").trim() : "",
    paypalOrderId: captureEvent ? relatedOrderId : String(resource.id || relatedOrderId || "").trim(),
    customIds: unique([
      resource.custom_id,
      resource.invoice_id,
      ...units.map((unit) => unit?.reference_id),
      ...units.map((unit) => unit?.custom_id)
    ])
  };
}

function findMarketplaceOrders({ captureId = "", paypalOrderId = "", customIds = [] } = {}) {
  const db = getDb();
  const ids = new Set();
  if (captureId) {
    for (const row of db.prepare("SELECT id FROM mk_orders WHERE paypal_capture_id=?").all(captureId)) ids.add(row.id);
  }
  if (paypalOrderId) {
    for (const row of db.prepare("SELECT id FROM mk_orders WHERE paypal_order_id=?").all(paypalOrderId)) ids.add(row.id);
  }
  for (const customId of customIds) {
    const byPk = getOrder(customId);
    if (byPk) ids.add(byPk.id);
    for (const row of db.prepare("SELECT id FROM mk_orders WHERE paypal_order_id=?").all(customId)) ids.add(row.id);
  }
  return [...ids].map((id) => getOrder(id)).filter(Boolean);
}

function findLiveCheckout({ captureId = "", paypalOrderId = "", customIds = [] } = {}) {
  return listLiveCheckouts().find((item) => {
    const providerOrderId = String(item.paymentProviderOrderId || "");
    const providerCaptureId = String(item.paymentProviderTransactionId || "");
    return (captureId && providerCaptureId === captureId)
      || (paypalOrderId && providerOrderId === paypalOrderId)
      || customIds.includes(item.id)
      || customIds.includes(providerOrderId);
  }) || null;
}

function rememberCaptureId(order, captureId) {
  if (!order || !captureId || order.paypalCaptureId === captureId) return;
  getDb().prepare("UPDATE mk_orders SET paypal_capture_id=?, payment_provider='paypal', updated_at=? WHERE id=?").run(captureId, new Date().toISOString(), order.id);
}

function applyMarketplacePending(order, captureId) {
  if (!order) return { skipped: true, reason: "unknown" };
  rememberCaptureId(order, captureId);
  const current = getOrder(order.id) || order;
  if (PROTECTED_ORDER_STATUSES.has(current.status) || current.status === "cancelled") {
    return { skipped: true, protected: PROTECTED_ORDER_STATUSES.has(current.status), orderId: current.id, status: current.status };
  }
  if (current.status === "pending" && current.paymentStatus === "pending" && current.paymentMethod === "paypal") {
    return { duplicate: true, orderId: current.id };
  }
  markOrderPaymentStatus(current.id, "pending", { paymentMethod: "paypal" });
  return { updated: true, orderId: current.id };
}

function applyMarketplaceFailed(order) {
  if (!order) return { skipped: true, reason: "unknown" };
  if (PROTECTED_ORDER_STATUSES.has(order.status)) {
    return { skipped: true, protected: true, orderId: order.id, status: order.status };
  }
  if (order.status === "cancelled") {
    return { duplicate: true, orderId: order.id };
  }
  markOrderPaymentStatus(order.id, "failed", { paymentMethod: "paypal" });
  return { updated: true, orderId: order.id };
}

function applyLivePending(checkout, captureId) {
  if (!checkout) return { skipped: true, reason: "unknown" };
  const updated = applyLivePaymentStatus(checkout.id, "pending", captureId ? { paymentProviderTransactionId: captureId } : {});
  if (!updated) return { skipped: true, reason: "unknown" };
  if (updated.protected || updated.alreadyPaid) return { skipped: true, protected: true, checkoutId: checkout.id, status: "paid" };
  if (updated.duplicate) return { duplicate: true, checkoutId: checkout.id };
  return { updated: true, checkoutId: checkout.id, status: updated.status };
}

function applyLiveFailed(checkout) {
  if (!checkout) return { skipped: true, reason: "unknown" };
  const updated = applyLivePaymentStatus(checkout.id, "failed");
  if (!updated) return { skipped: true, reason: "unknown" };
  if (updated.protected || updated.alreadyPaid) return { skipped: true, protected: true, checkoutId: checkout.id, status: "paid" };
  if (updated.duplicate) return { duplicate: true, checkoutId: checkout.id };
  return { updated: true, checkoutId: checkout.id, status: updated.status };
}

function applyCapturePending(resource) {
  const ids = resourceIds(resource, { captureEvent: true });
  const orders = findMarketplaceOrders({ captureId: ids.captureId, paypalOrderId: ids.paypalOrderId, customIds: ids.customIds });
  const live = findLiveCheckout({ captureId: ids.captureId, paypalOrderId: ids.paypalOrderId, customIds: ids.customIds });
  if (!orders.length && !live) return { ignored: true, reason: "unknown" };
  return {
    marketplace: orders.map((order) => applyMarketplacePending(order, ids.captureId)),
    live: live ? applyLivePending(live, ids.captureId) : null
  };
}

function applyCaptureDenied(resource) {
  const ids = resourceIds(resource, { captureEvent: true });
  const orders = findMarketplaceOrders({ captureId: ids.captureId, paypalOrderId: ids.paypalOrderId, customIds: ids.customIds });
  const live = findLiveCheckout({ captureId: ids.captureId, paypalOrderId: ids.paypalOrderId, customIds: ids.customIds });
  if (!orders.length && !live) return { ignored: true, reason: "unknown" };
  return {
    marketplace: orders.map((order) => applyMarketplaceFailed(order)),
    live: live ? applyLiveFailed(live) : null
  };
}

function applyOrderDeclined(resource) {
  const paypalOrderId = String(resource?.id || "").trim();
  const ids = resourceIds(resource);
  const orders = findMarketplaceOrders({ paypalOrderId, customIds: ids.customIds });
  const live = findLiveCheckout({ paypalOrderId, customIds: ids.customIds });
  if (!orders.length && !live) return { ignored: true, reason: "unknown" };
  return {
    marketplace: orders.map((order) => applyMarketplaceFailed(order)),
    live: live ? applyLiveFailed(live) : null
  };
}

export async function refundPayPalOrder(orderId, amount = null) {
  const order = getOrder(orderId);
  if (!order) throw Object.assign(new Error("Commande introuvable."), { status: 404 });
  if (order.paymentProvider !== "paypal" || !order.paypalCaptureId) throw Object.assign(new Error("Cette commande ne dispose pas d'une capture PayPal remboursable."), { status: 409 });
  if (order.paymentStatus === "refunded" || order.status === "refunded") return { alreadyRefunded: true, order };
  const seller = getSeller(order.sellerId);
  if (!seller?.paypalMerchantId) throw Object.assign(new Error("Compte PayPal vendeur introuvable."), { status: 409 });
  const requested = amount == null || amount === "" ? Number(order.total) : Number(amount);
  if (!Number.isFinite(requested) || requested <= 0 || requested > Number(order.total)) throw Object.assign(new Error("Montant de remboursement invalide."), { status: 400 });
  const result = await request(`/v2/payments/captures/${encodeURIComponent(order.paypalCaptureId)}/refund`, { method: "POST", sellerMerchantId: seller.paypalMerchantId, body: { amount: { value: requested.toFixed(2), currency_code: "EUR" } } });
  const complete = ["COMPLETED", "PENDING"].includes(String(result.status || "").toUpperCase());
  if (!complete) throw Object.assign(new Error("PayPal n'a pas accepte le remboursement."), { status: 502 });
  // Un remboursement partiel ne marque pas toute la commande comme remboursee.
  if (Math.abs(requested - Number(order.total)) < 0.001 && String(result.status || "").toUpperCase() === "COMPLETED") updateOrderStatus(order.id, "refunded", { paymentStatus: "refunded", paymentMethod: "paypal" });
  return { provider: "paypal", refundId: result.id, status: result.status, amount: requested, order: getOrder(order.id) };
}
