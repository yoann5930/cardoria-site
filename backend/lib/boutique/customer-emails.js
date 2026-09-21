import { isSmtpConfigured, sendEmail, smtpMissingReason } from "../email.js";
import { readJson, writeJson } from "../storage.js";

const SITE_URL = () => String(process.env.SITE_URL || process.env.FRONTEND_URL || "https://www.cardoriashop.fr").replace(/\/$/, "");
const clean = (value, max = 500) => String(value == null ? "" : value).trim().slice(0, max);
const money = (value) => Number(value || 0).toFixed(2).replace(".", ",") + " €";
const nowIso = () => new Date().toISOString();

function html(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function total(order) {
  const explicit = Number(order?.total);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return (order?.items || []).reduce((sum, item) => sum + Number(item.qty || 1) * Number(item.price || 0), 0);
}

function trackingUrl(carrier, tracking) {
  const number = clean(tracking, 180);
  if (!number) return "";
  const c = clean(carrier, 120).toLowerCase();
  const q = encodeURIComponent(number);
  if (c.includes("mondial")) return "https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=" + q;
  if (c.includes("relais colis")) return "https://www.relaiscolis.com/suivi-de-colis/?search=" + q;
  if (c.includes("chronopost")) return "https://www.chronopost.fr/fr/suivi-colis?listeNumerosLT=" + q;
  if (c.includes("colissimo") || c.includes("la poste") || c === "poste") return "https://www.laposte.fr/outils/suivre-vos-envois?code=" + q;
  return "";
}

function itemText(order) {
  return (order?.items || []).map((item) => {
    const qty = Math.max(1, Number(item.qty || 1));
    return "- " + qty + " × " + clean(item.name || item.ref || "Article", 240) + " — " + money(qty * Number(item.price || 0));
  }).join("\n");
}

function itemHtml(order) {
  return (order?.items || []).map((item) => {
    const qty = Math.max(1, Number(item.qty || 1));
    return '<tr><td style="padding:8px 0;border-bottom:1px solid #ececec">' + html(qty + " × " + clean(item.name || item.ref || "Article", 240)) + '</td><td style="padding:8px 0;border-bottom:1px solid #ececec;text-align:right">' + html(money(qty * Number(item.price || 0))) + "</td></tr>";
  }).join("");
}

function emailShell(title, intro, body, footer) {
  return '<div style="margin:0;padding:24px;background:#f5f3ee;font-family:Arial,sans-serif;color:#161616">' +
    '<div style="max-width:640px;margin:auto;background:#fff;border:1px solid #e5dfd1;border-radius:12px;overflow:hidden">' +
      '<div style="padding:22px 28px;background:#111;color:#e9cb67"><strong style="font-size:22px">CARDORIA</strong></div>' +
      '<div style="padding:28px">' +
        '<h1 style="margin:0 0 14px;font-size:24px">' + html(title) + '</h1>' +
        '<p style="line-height:1.6">' + intro + '</p>' +
        body +
        '<p style="margin:26px 0 0;line-height:1.6;color:#555">' + footer + '</p>' +
      "</div>" +
    "</div>" +
  "</div>";
}

export function buildBoutiquePurchaseEmail(order) {
  const id = clean(order?.id, 80);
  const client = clean(order?.client, 120) || "Bonjour";
  const ordersUrl = SITE_URL() + "/client-orders.html";
  const text = [
    "Cardoria — Confirmation de commande",
    "",
    "Bonjour " + client + ",",
    "Votre paiement a bien été confirmé.",
    "Commande : " + id,
    "",
    itemText(order),
    "",
    "Total : " + money(total(order)),
    "",
    "Vous pouvez suivre votre commande depuis votre espace client :",
    ordersUrl,
    "",
    "Merci pour votre achat.",
    "Cardoria"
  ].join("\n");
  const body = '<p style="margin:20px 0 8px"><strong>Commande ' + html(id) + "</strong></p>" +
    '<table style="width:100%;border-collapse:collapse">' + itemHtml(order) + "</table>" +
    '<p style="font-size:18px;text-align:right"><strong>Total : ' + html(money(total(order))) + "</strong></p>" +
    '<p style="margin:24px 0"><a href="' + html(ordersUrl) + '" style="display:inline-block;padding:12px 18px;background:#111;color:#e9cb67;text-decoration:none;border-radius:6px">Voir mes commandes</a></p>';
  return {
    to: clean(order?.email, 254),
    subject: "Cardoria — Confirmation de votre commande " + id,
    text,
    html: emailShell("Commande confirmée", "Bonjour " + html(client) + ",<br>Votre paiement a bien été confirmé.", body, "Merci pour votre achat.<br>Cardoria")
  };
}

export function buildBoutiqueTrackingEmail(order) {
  const id = clean(order?.id, 80);
  const client = clean(order?.client, 120) || "Bonjour";
  const carrier = clean(order?.carrier, 120) || "Transporteur";
  const tracking = clean(order?.tracking, 180);
  const url = trackingUrl(carrier, tracking);
  const ordersUrl = SITE_URL() + "/client-orders.html";
  const text = [
    "Cardoria — Votre commande a été expédiée",
    "",
    "Bonjour " + client + ",",
    "Votre commande " + id + " a été expédiée.",
    "Transporteur : " + carrier,
    "Numéro de suivi : " + tracking,
    ...(url ? ["Suivre le colis : " + url] : []),
    "",
    "Votre espace client : " + ordersUrl,
    "",
    "Cardoria"
  ].join("\n");
  const trackingButton = url
    ? '<p style="margin:24px 0"><a href="' + html(url) + '" style="display:inline-block;padding:12px 18px;background:#111;color:#e9cb67;text-decoration:none;border-radius:6px">Suivre mon colis</a></p>'
    : "";
  const body = '<div style="margin:20px 0;padding:16px;background:#f7f7f7;border-radius:8px">' +
      "<p><strong>Commande :</strong> " + html(id) + "</p>" +
      "<p><strong>Transporteur :</strong> " + html(carrier) + "</p>" +
      "<p><strong>Numéro de suivi :</strong> " + html(tracking) + "</p>" +
    "</div>" + trackingButton +
    '<p><a href="' + html(ordersUrl) + '">Consulter mes commandes Cardoria</a></p>';
  return {
    to: clean(order?.email, 254),
    subject: "Cardoria — Votre commande " + id + " a été expédiée",
    text,
    html: emailShell("Votre colis est en route", "Bonjour " + html(client) + ",<br>Votre commande vient d’être expédiée.", body, "Merci pour votre confiance.<br>Cardoria")
  };
}

export async function deliverBoutiquePurchaseEmail(order) {
  const message = buildBoutiquePurchaseEmail(order);
  if (!message.to) return false;
  return sendEmail(message);
}

export async function deliverBoutiqueTrackingEmail(order) {
  const message = buildBoutiqueTrackingEmail(order);
  if (!message.to || !clean(order?.tracking, 180)) return false;
  return sendEmail(message);
}

function emailStateKey(kind) {
  return kind === "tracking" ? "trackingEmail" : "purchaseEmail";
}

function fingerprint(kind, order) {
  if (kind !== "tracking") return clean(order?.id, 80);
  return [clean(order?.carrier, 120).toLowerCase(), clean(order?.tracking, 180)].join("|");
}

function claim(orderId, kind, force = false) {
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
}

function finalize(orderId, kind, fingerprintValue, sent, error = "") {
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
}

async function notify(orderId, kind, { force = false } = {}) {
  const claimed = claim(orderId, kind, force);
  if (!claimed.ok) return { ok: true, sent: false, skipped: true, reason: claimed.reason, order: claimed.order };
  const order = claimed.order;
  const currentFingerprint = fingerprint(kind, order);

  if (!isSmtpConfigured()) {
    const reason = smtpMissingReason() || "SMTP non configuré.";
    const updated = finalize(orderId, kind, currentFingerprint, false, reason);
    return { ok: false, sent: false, skipped: false, reason: "smtp_not_configured", error: reason, order: updated };
  }

  const sent = kind === "tracking"
    ? await deliverBoutiqueTrackingEmail(order)
    : await deliverBoutiquePurchaseEmail(order);
  const updated = finalize(orderId, kind, currentFingerprint, sent, sent ? "" : "SMTP configuré mais envoi refusé ou indisponible.");
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
