import { isSmtpConfigured, publicSiteOrigin, sendEmail, smtpMissingReason } from "../email.js";
import { renderCardoriaEmail } from "../email-templates.js";
import { readJson, writeJson } from "../storage.js";
import { boutiqueTrackingUrl, firstNameFromClient, formatPickupSummary, publicClientOrder } from "./shipping.js";
import { withBoutiqueOrderLock } from "./order-lock.js";

const SITE_URL = () => publicSiteOrigin();
const clean = (value, max = 500) => String(value == null ? "" : value).trim().slice(0, max);
const money = (value) => Number(value || 0).toFixed(2).replace(".", ",") + " €";
const nowIso = () => new Date().toISOString();

function total(order) {
  const explicit = Number(order?.total);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return (order?.items || []).reduce((sum, item) => sum + Number(item.qty || 1) * Number(item.price || 0), 0);
}

function itemText(order) {
  return (order?.items || []).map((item) => {
    const qty = Math.max(1, Number(item.qty || 1));
    return "- " + qty + " × " + clean(item.name || item.ref || "Article", 240) + " — " + money(qty * Number(item.price || 0));
  }).join("\n");
}

function deliveryLine(order) {
  const pickup = formatPickupSummary(order?.pickupPoint);
  if (pickup) return pickup;
  const shipping = order?.shippingAddress || {};
  const parts = [shipping.address, [shipping.postalCode, shipping.city].filter(Boolean).join(" "), shipping.country].filter(Boolean);
  return parts.join(", ");
}

export function buildBoutiquePurchaseEmail(order) {
  const id = clean(order?.id, 80);
  const client = firstNameFromClient(order?.client);
  const ordersUrl = SITE_URL() + "/client-orders.html";
  const rendered = renderCardoriaEmail({
    preheader: "Votre paiement Cardoria a bien été confirmé.",
    title: "Commande confirmée",
    bodyText: "Bonjour " + client + ",\n\nVotre paiement a bien été confirmé.\n\n" + itemText(order),
    actionUrl: ordersUrl,
    actionLabel: "Voir mes commandes",
    details: [
      { label: "Commande", value: id },
      { label: "Total", value: money(total(order)) }
    ]
  });
  return {
    to: clean(order?.email, 254),
    subject: "Cardoria — Confirmation de votre commande " + id,
    text: rendered.text,
    html: rendered.html
  };
}

export function buildBoutiqueTrackingEmail(order) {
  const id = clean(order?.id, 80);
  const client = firstNameFromClient(order?.client);
  const carrier = clean(order?.carrier, 120) || "Transporteur";
  const tracking = clean(order?.tracking, 180);
  const url = boutiqueTrackingUrl(carrier, tracking);
  const ordersUrl = SITE_URL() + "/client-orders.html";
  const destination = deliveryLine(order);
  const rendered = renderCardoriaEmail({
    preheader: "Votre commande " + id + " a été expédiée.",
    title: "Commande expédiée",
    bodyText: "Bonjour " + client + ",\n\nVotre commande " + id + " a bien été expédiée par Cardoria.",
    actionUrl: url || ordersUrl,
    actionLabel: "Suivre mon colis",
    details: [
      { label: "Commande", value: id },
      { label: "Transporteur", value: carrier },
      { label: "Numéro de suivi", value: tracking },
      destination ? { label: publicClientOrder(order).delivery?.pickupPoint ? "Point Relais" : "Livraison", value: destination } : null,
      { label: "Mon compte", value: ordersUrl }
    ].filter(Boolean)
  });
  return {
    to: clean(order?.email, 254),
    subject: "Cardoria — Votre commande " + id + " a été expédiée",
    text: rendered.text,
    html: rendered.html
  };
}

export async function deliverBoutiquePurchaseEmail(order) {
  const message = buildBoutiquePurchaseEmail(order);
  if (!message.to) return false;
  return sendEmail({ ...message, kind: "boutique_purchase" });
}

export async function deliverBoutiqueTrackingEmail(order) {
  const message = buildBoutiqueTrackingEmail(order);
  if (!message.to || !clean(order?.tracking, 180)) return false;
  return sendEmail({ ...message, kind: "boutique_tracking" });
}

function emailStateKey(kind) {
  return kind === "tracking" ? "trackingEmail" : "purchaseEmail";
}

function fingerprint(kind, order) {
  if (kind !== "tracking") return clean(order?.id, 80);
  return [clean(order?.carrier, 120).toLowerCase(), clean(order?.tracking, 180)].join("|");
}

function claim(orderId, kind, force = false) {
  return withBoutiqueOrderLock(() => {
    const orders = readJson("orders", []);
    const index = orders.findIndex((order) => String(order.id) === String(orderId));
    if (index < 0) return { ok: false, reason: "order_not_found", order: null };
    const order = orders[index];
    if (kind === "purchase" && order.paymentStatus !== "paid") return { ok: false, reason: "payment_not_paid", order };
    if (kind === "tracking" && (order.status !== "Expédiée" || !clean(order.tracking, 180) || !clean(order.carrier, 120))) {
      return { ok: false, reason: "tracking_not_ready", order };
    }

    const key = emailStateKey(kind);
    const state = order[key] || {};
    const currentFingerprint = fingerprint(kind, order);
    if (!force && state.status === "sent" && state.fingerprint === currentFingerprint) {
      return { ok: false, reason: "already_sent", order };
    }
    if (!force && state.status === "sending" && state.fingerprint === currentFingerprint) {
      const age = Date.now() - Date.parse(state.lastAttemptAt || 0);
      if (Number.isFinite(age) && age >= 0 && age < 5 * 60 * 1000) return { ok: false, reason: "already_sending", order };
    }

    const now = nowIso();
    order[key] = {
      ...state,
      status: "sending",
      fingerprint: currentFingerprint,
      attempts: Number(state.attempts || 0) + 1,
      lastAttemptAt: now,
      error: ""
    };
    order.updatedAt = now;
    orders[index] = order;
    writeJson("orders", orders);
    return { ok: true, reason: "", order: { ...order } };
  });
}

function finalize(orderId, kind, fingerprintValue, sent, error = "") {
  return withBoutiqueOrderLock(() => {
    const orders = readJson("orders", []);
    const index = orders.findIndex((order) => String(order.id) === String(orderId));
    if (index < 0) return null;
    const order = orders[index];
    const key = emailStateKey(kind);
    const state = order[key] || {};
    if (state.fingerprint !== fingerprintValue) return order;
    const now = nowIso();
    order[key] = {
      ...state,
      status: sent ? "sent" : "failed",
      sentAt: sent ? now : (state.sentAt || ""),
      failedAt: sent ? "" : now,
      error: sent ? "" : clean(error || "Envoi e-mail impossible.", 240)
    };
    order.updatedAt = now;
    orders[index] = order;
    writeJson("orders", orders);
    return order;
  });
}

async function notify(orderId, kind, { force = false } = {}) {
  const claimed = await claim(orderId, kind, force);
  if (!claimed.ok) return { ok: true, sent: false, skipped: true, reason: claimed.reason, order: claimed.order };
  const order = claimed.order;
  const currentFingerprint = fingerprint(kind, order);

  if (!isSmtpConfigured()) {
    const reason = smtpMissingReason() || "SMTP non configuré.";
    const updated = await finalize(orderId, kind, currentFingerprint, false, reason);
    return { ok: false, sent: false, skipped: false, reason: "smtp_not_configured", error: reason, order: updated };
  }

  const sent = kind === "tracking"
    ? await deliverBoutiqueTrackingEmail(order)
    : await deliverBoutiquePurchaseEmail(order);
  const updated = await finalize(orderId, kind, currentFingerprint, sent, sent ? "" : "SMTP configuré mais envoi refusé ou indisponible.");
  return { ok: sent, sent, skipped: false, reason: sent ? "" : "send_failed", error: sent ? "" : "Envoi e-mail impossible.", order: updated };
}

export function getBoutiqueEmailConfiguration() {
  return {
    configured: isSmtpConfigured(),
    missingReason: isSmtpConfigured() ? "" : smtpMissingReason()
  };
}

export function sendBoutiquePurchaseEmail(orderId, options) {
  return notify(orderId, "purchase", options);
}

export function sendBoutiqueTrackingEmail(orderId, options) {
  return notify(orderId, "tracking", options);
}
