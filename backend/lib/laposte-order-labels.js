import { readJson, writeJson } from "./storage.js";
import { getOrder, updateOrderStatus } from "./marketplace/orders.js";
import { getSeller } from "./marketplace/sellers.js";
import { logAudit } from "./audit.js";
import {
  colissimoLabelPurchasesEnabled,
  createColissimoShipment,
  isColissimoConfigured
} from "./colissimo.js";

const failure = (code, message, status = 502) => Object.assign(new Error(message), { code, status });
const clean = (value, max = 240) => String(value == null ? "" : value).trim().slice(0, max);

export function isLaPosteCarrier(value) {
  const carrier = clean(value, 80).toLowerCase();
  return carrier === "la poste" || carrier === "colissimo" || carrier === "la_poste";
}

function estimatedWeightGrams(items = []) {
  const qty = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Math.max(1, Number(item.qty) || 1), 0);
  return Math.min(30000, Math.max(50, qty * 20));
}

function parseFreeformAddress(raw, fallback = {}) {
  const text = clean(raw, 600);
  const postal = text.match(/\b(\d{5})\b/);
  const lines = text.split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  const cityLine = postal ? clean(text.slice(text.indexOf(postal[1]) + 5), 120).split(/[,\n]/)[0] : "";
  return {
    recipientName: fallback.recipientName || fallback.name || "",
    addressLine1: fallback.addressLine1 || fallback.address || lines[0] || "",
    addressLine2: fallback.addressLine2 || "",
    postalCode: fallback.postalCode || (postal ? postal[1] : ""),
    city: fallback.city || cityLine,
    countryCode: fallback.countryCode || fallback.country || "FR",
    phone: fallback.phone || "",
    email: fallback.email || ""
  };
}

function boutiqueAddress(order) {
  const structured = order.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {};
  return parseFreeformAddress(order.address || "", {
    recipientName: order.client || order.customerName || "",
    addressLine1: structured.address || structured.addressLine1,
    postalCode: structured.postalCode,
    city: structured.city,
    countryCode: structured.country,
    phone: order.phone,
    email: order.email
  });
}

function marketplaceAddress(order) {
  return parseFreeformAddress(order.shippingAddress || "", {
    recipientName: order.buyerName || "",
    email: order.buyerEmail || "",
    countryCode: "FR"
  });
}

function sellerSender(order) {
  const seller = getSeller(order.sellerId);
  const sender = seller?.sender;
  if (!sender?.name || !sender.addressLine1 || !sender.postalCode || !sender.city) {
    throw failure("SELLER_SENDER_PROFILE_REQUIRED", "Adresse expéditeur vendeur incomplète pour Colissimo.", 409);
  }
  return {
    companyName: sender.name,
    line2: sender.addressLine1,
    line3: sender.addressLine2 || "",
    postalCode: sender.postalCode,
    zipCode: sender.postalCode,
    city: sender.city,
    countryCode: sender.countryCode || "FR",
    phone: sender.phone || "",
    email: seller.email || ""
  };
}

function patchBoutiqueOrder(orderId, patch) {
  const orders = readJson("orders", []);
  const index = orders.findIndex((row) => String(row.id) === String(orderId));
  if (index < 0) return null;
  orders[index] = { ...orders[index], ...patch, updatedAt: new Date().toISOString() };
  writeJson("orders", orders);
  return orders[index];
}

export async function attachColissimoLabelAfterPayment({ source, orderId }) {
  try {
    if (source === "boutique") return await attachBoutiqueLabel(orderId);
    if (source === "marketplace") return await attachMarketplaceLabel(orderId);
    return { skipped: true, reason: "unknown_source" };
  } catch (error) {
    logAudit({ type: "shipping", action: "colissimo_label_failed", user: "system", detail: `${source}:${orderId}:${clean(error?.code || error?.message, 120)}` });
    if (source === "boutique") {
      patchBoutiqueOrder(orderId, { shippingLabelError: clean(error?.message, 180), shippingLabelStatus: "error" });
    } else if (source === "marketplace") {
      try {
        const current = getOrder(orderId);
        if (current) updateOrderStatus(orderId, current.status, { labelUrl: "", tracking: current.shippingTracking || "" });
      } catch {}
    }
    return { ok: false, code: error?.code || "COLISSIMO_LABEL_FAILED", error: error?.message || "Étiquette Colissimo indisponible." };
  }
}

async function attachBoutiqueLabel(orderId) {
  const order = readJson("orders", []).find((row) => String(row.id) === String(orderId));
  if (!order) return { skipped: true, reason: "missing_order" };
  if (!isLaPosteCarrier(order.carrier || "La Poste")) return { skipped: true, reason: "other_carrier" };
  if (order.colissimoParcelNumber || order.tracking) return { skipped: true, reason: "already_labelled", tracking: order.tracking };
  if (!isColissimoConfigured()) {
    patchBoutiqueOrder(orderId, { carrier: "La Poste", shippingLabelStatus: "not_configured" });
    return { skipped: true, reason: "not_configured" };
  }
  if (!colissimoLabelPurchasesEnabled()) {
    patchBoutiqueOrder(orderId, { carrier: "La Poste", shippingLabelStatus: "labels_not_activated" });
    return { skipped: true, reason: "labels_not_activated" };
  }
  const created = await createColissimoShipment({
    orderId: order.id,
    weightGrams: estimatedWeightGrams(order.items),
    toAddress: boutiqueAddress(order),
    toEmail: order.email,
    content: "CARTES TCG"
  });
  const saved = patchBoutiqueOrder(order.id, {
    carrier: "La Poste",
    shipping: "Colissimo domicile",
    tracking: created.trackingNumber,
    trackingUrl: created.trackingUrl,
    colissimoParcelNumber: created.parcelNumber,
    shippingLabelPath: created.labelPath,
    shippingLabelStatus: "ready",
    shippingLabelError: "",
    status: order.status === "À préparer" ? "En préparation" : order.status
  });
  logAudit({ type: "shipping", action: "colissimo_label_created", user: order.email || "system", detail: order.id });
  return { ok: true, order: saved, tracking: created.trackingNumber };
}

async function attachMarketplaceLabel(orderId) {
  const order = getOrder(orderId);
  if (!order) return { skipped: true, reason: "missing_order" };
  if (!isLaPosteCarrier(order.shippingCarrier)) return { skipped: true, reason: "other_carrier" };
  if (order.shippingTracking) return { skipped: true, reason: "already_labelled", tracking: order.shippingTracking };
  if (!isColissimoConfigured()) return { skipped: true, reason: "not_configured" };
  if (!colissimoLabelPurchasesEnabled()) return { skipped: true, reason: "labels_not_activated" };
  const created = await createColissimoShipment({
    orderId: order.id,
    weightGrams: estimatedWeightGrams(order.items),
    toAddress: marketplaceAddress(order),
    toEmail: order.buyerEmail,
    fromAddress: sellerSender(order),
    content: "CARTES TCG"
  });
  const saved = updateOrderStatus(order.id, order.status === "paid" ? "preparing" : order.status, {
    tracking: created.trackingNumber,
    labelUrl: created.labelPath
  });
  logAudit({ type: "shipping", action: "colissimo_label_created", user: order.buyerEmail || "system", detail: order.id });
  return { ok: true, order: saved, tracking: created.trackingNumber };
}
