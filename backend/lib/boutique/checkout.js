import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { createSumUpCheckout } from "../payments/sumup.js";
import { assertSaleProvider, assertServerAmount } from "../payments/routing.js";
import { listBoutiqueProducts } from "./catalog.js";
import { withBoutiqueOrderLock } from "./order-lock.js";
import { resolveBoutiqueOrderWeight, resolveBoutiqueShippingSelection } from "./shipping.js";

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const clean = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);

function validateEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Adresse email invalide."), { status: 400 });
  return email;
}

export function validateBoutiqueItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw Object.assign(new Error("Panier vide"), { status: 400 });
  const catalog = new Map(listBoutiqueProducts({ includeDisabled: false }).map((p) => [String(p.id), p]));
  const combined = new Map();
  for (const raw of rawItems) {
    const ref = clean(raw?.ref || raw?.id, 240);
    if (!ref) throw Object.assign(new Error("Référence produit invalide."), { status: 400, code: "PRODUCT_ID_INVALID" });
    const qty = Math.trunc(Number(raw?.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      throw Object.assign(new Error("Quantité invalide."), { status: 400, code: "QTY_INVALID" });
    }
    if (qty > 20) throw Object.assign(new Error("Quantité trop élevée."), { status: 400, code: "QTY_INVALID" });
    combined.set(ref, (combined.get(ref) || 0) + qty);
  }
  return Array.from(combined.entries()).map(([ref, qty]) => {
    const p = catalog.get(ref);
    if (!p || p.boutiqueEnabled === false) {
      throw Object.assign(new Error(`Produit indisponible: ${ref}`), { status: 400, code: "PRODUCT_UNAVAILABLE" });
    }
    if (qty > Number(p.stock || 0)) {
      throw Object.assign(new Error(`Stock insuffisant pour ${p.name} (${p.stock} disponible).`), { status: 409, code: "STOCK_INSUFFICIENT" });
    }
    if (!p.purchasable || Number(p.price || 0) <= 0) {
      throw Object.assign(new Error(`Prix Boutique non défini pour ${p.name}.`), { status: 409, code: "PRICE_INVALID" });
    }
    const weight = Math.trunc(Number(p.shippingWeightGrams));
    const item = {
      ref: p.id,
      name: p.name,
      qty,
      price: money(p.price),
      category: p.category || "pokemon",
      condition: clean(p.condition, 80),
      extension: clean(p.extension, 80),
      number: clean(p.number, 40),
      image: clean(p.image, 500)
    };
    if (Number.isFinite(weight) && weight >= 1 && weight <= 30000) item.shippingWeightGrams = weight;
    return item;
  });
}

function fingerprint({ email, items, total, shippingMethod, pickupId }) {
  const normalized = items.map((i) => `${i.ref}:${i.qty}`).sort().join("|");
  return crypto.createHash("sha256").update(`${email}|${normalized}|${money(total)}|${shippingMethod || ""}|${pickupId || ""}`).digest("hex");
}

function reserveUnlocked({ customerName, customerEmail, customerPhone, address, postalCode, city, country, items, shipping, shippingMethod, pickupPoint, trafficSource, visitorId, accountUserId = "", requestedProvider, requestedAmount, requestedShippingCost }) {
  assertSaleProvider({ channel: "boutique", requestedProvider });
  if (requestedShippingCost != null && requestedShippingCost !== "" && money(requestedShippingCost) !== 0) {
    throw Object.assign(new Error("Les frais de port envoyés par le client ne correspondent pas au tarif serveur."), { status: 403, code: "SHIPPING_FORGED" });
  }
  const name = clean(customerName, 120), email = validateEmail(customerEmail), phone = clean(customerPhone, 40);
  const street = clean(address, 300), zip = clean(postalCode, 20), locality = clean(city, 120), countryName = clean(country, 80) || "France";
  if (!name) throw Object.assign(new Error("Nom du client obligatoire."), { status: 400 });
  if (!phone) throw Object.assign(new Error("Téléphone obligatoire pour la livraison."), { status: 400 });
  const selection = resolveBoutiqueShippingSelection({ shippingMethod, shipping, pickupPoint });
  if (selection.code !== "mondial_relay" && (!street || !zip || !locality)) {
    throw Object.assign(new Error("Adresse, code postal et ville obligatoires pour la livraison Colissimo."), { status: 400 });
  }
  if (selection.code === "mondial_relay" && !selection.pickupPoint) {
    throw Object.assign(new Error("Point Relais Mondial Relay obligatoire."), { status: 400 });
  }
  const verifiedItems = validateBoutiqueItems(items);
  const shippingCost = 0;
  const total = assertServerAmount(money(verifiedItems.reduce((s, i) => s + i.qty * i.price, 0) + shippingCost), requestedAmount);
  const key = fingerprint({ email, items: verifiedItems, total, shippingMethod: selection.code, pickupId: selection.pickupPoint?.id || "" });
  const orders = readJson("orders", []);
  const existing = orders.find((o) => o.idempotencyKey === key && o.paymentStatus === "pending" && Date.now() - Date.parse(o.createdAt || 0) < 30 * 60 * 1000);
  if (existing?.sumupCheckoutId) {
    return { reused: true, order: existing, selection };
  }
  if (existing && !existing.sumupCheckoutId) {
    return { reused: true, order: existing, selection, needsPaymentSession: true };
  }
  const orderId = "CMD-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomInt(1000, 10000);
  const now = new Date().toISOString();
  const homeAddress = selection.code === "mondial_relay"
    ? {
        address: street || selection.pickupPoint.address,
        postalCode: zip || selection.pickupPoint.postalCode,
        city: locality || selection.pickupPoint.city,
        country: countryName
      }
    : { address: street, postalCode: zip, city: locality, country: countryName };
  const addressText = selection.pickupPoint
    ? ["Point Relais " + selection.pickupPoint.name + " n° " + selection.pickupPoint.id, selection.pickupPoint.address, `${selection.pickupPoint.postalCode} ${selection.pickupPoint.city}`].join("\n")
    : [street, `${zip} ${locality}`, countryName].join("\n");
  const weight = resolveBoutiqueOrderWeight({ items: verifiedItems });
  const order = {
    id: orderId,
    idempotencyKey: key,
    userId: clean(accountUserId, 120),
    date: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
    client: name,
    email,
    phone,
    address: addressText,
    shippingAddress: homeAddress,
    pickupPoint: selection.pickupPoint,
    items: verifiedItems,
    payment: "En attente SumUp",
    paymentStatus: "pending",
    status: "En attente SumUp",
    shipping: selection.shipping,
    shippingMethod: selection.code,
    carrier: selection.carrier,
    shippingCost,
    total,
    shipmentStatus: "paiement en attente",
    ...(weight.known ? { shippingWeightGrams: weight.grams, weightSource: weight.source } : { weightSource: "unknown" }),
    paymentProvider: "sumup",
    sumupCheckoutId: "",
    trafficSource: trafficSource === "witnot" ? "witnot" : "",
    visitorId: clean(visitorId, 200)
  };
  orders.unshift(order);
  writeJson("orders", orders);
  return { reused: false, order, selection };
}

export function reserveBoutiqueCheckout(payload) {
  return withBoutiqueOrderLock(() => reserveUnlocked(payload));
}

function attachPaymentSession(orderId, session, pickupPoint) {
  return withBoutiqueOrderLock(() => {
    const updated = readJson("orders", []);
    const idx = updated.findIndex((o) => o.id === orderId);
    if (idx < 0) return null;
    updated[idx].sumupCheckoutId = session.checkoutId;
    updated[idx].paymentProviderOrderId = session.checkoutId;
    updated[idx].paymentUrl = session.url;
    updated[idx].paymentId = session.paymentId;
    updated[idx].updatedAt = new Date().toISOString();
    if (updated[idx].pickupPoint && pickupPoint) updated[idx].pickupPoint = pickupPoint;
    writeJson("orders", updated);
    return updated[idx];
  });
}

function markCheckoutFailed(orderId, error) {
  return withBoutiqueOrderLock(() => {
    const updated = readJson("orders", []);
    const idx = updated.findIndex((o) => o.id === orderId);
    if (idx < 0) return;
    updated[idx].paymentStatus = "failed";
    updated[idx].status = "Paiement échoué";
    updated[idx].shipmentStatus = "annulée";
    updated[idx].paymentError = clean(error?.message || "Paiement SumUp indisponible", 500);
    updated[idx].updatedAt = new Date().toISOString();
    writeJson("orders", updated);
  });
}

export async function createLiveBoutiqueCheckout(payload, { createPaymentSession = createSumUpCheckout } = {}) {
  const reserved = await reserveBoutiqueCheckout(payload);
  if (reserved.reused && reserved.order?.sumupCheckoutId) {
    return {
      order: reserved.order,
      checkoutId: reserved.order.sumupCheckoutId,
      providerOrderId: reserved.order.sumupCheckoutId,
      url: reserved.order.paymentUrl || "",
      paymentId: reserved.order.paymentId || "",
      status: "pending"
    };
  }
  const order = reserved.order;
  const base = String(process.env.SITE_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const target = payload.successUrl || process.env.BOUTIQUE_SUCCESS_URL || (base ? `${base}/boutique.html?gamme=pokemon` : "/boutique.html?gamme=pokemon");
  const redirect = target + (target.includes("?") ? "&" : "?") + "paid=1&order=" + encodeURIComponent(order.id);
  try {
    const session = await createPaymentSession({
      orderId: order.id,
      amount: order.total,
      description: `Boutique CardoriaShop — ${order.items.length} article(s)`,
      customerEmail: order.email,
      redirectUrl: redirect,
      source: "boutique"
    });
    const saved = await attachPaymentSession(order.id, session, reserved.selection?.pickupPoint);
    return { order: saved || { ...order, sumupCheckoutId: session.checkoutId, pickupPoint: reserved.selection?.pickupPoint }, ...session };
  } catch (error) {
    await markCheckoutFailed(order.id, error);
    throw error;
  }
}
