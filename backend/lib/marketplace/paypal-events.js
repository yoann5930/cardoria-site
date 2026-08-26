/** PayPal webhooks + remboursements Marketplace Cardoria. */
import { getDb } from "../engine/database.js";
import { getSeller } from "./sellers.js";
import { getOrder, updateOrderStatus } from "./orders.js";
import { captureMarketplacePayPalOrder } from "./paypal.js";

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
  }
  if (["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(type) && resource.id) {
    const rows = getDb().prepare("SELECT id FROM mk_orders WHERE paypal_capture_id=?").all(resource.id);
    for (const row of rows) {
      const order = getOrder(row.id);
      if (order && order.status !== "refunded") updateOrderStatus(row.id, "refunded", { paymentStatus: "refunded", paymentMethod: "paypal" });
    }
    return { received: true, type, updated: rows.length };
  }
  return { received: true, type, ignored: true };
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
