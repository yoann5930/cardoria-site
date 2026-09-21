import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { createSumUpCheckout } from "../payments/sumup.js";
import { assertSaleProvider, assertServerAmount } from "../payments/routing.js";
import { listBoutiqueProducts } from "./catalog.js";
import { withBoutiqueOrderLock } from "./order-lock.js";
import { resolveBoutiqueOrderWeight, resolveBoutiqueShippingSelection } from "./shipping.js";
import {
  checkoutCreationIsFresh,
  checkoutRequestFingerprint,
  findRecentPendingCheckout,
  normalizeCheckoutRequestItems,
  withCheckoutRequestLock
} from "./checkout-idempotency.js";

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const clean = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);

function validateEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Adresse email invalide."), { status: 400 });
  return email;
}

export function validateBoutiqueItems(rawItems) {
  const requestedItems = normalizeCheckoutRequestItems(rawItems);
  const catalog = new Map(listBoutiqueProducts({ includeDisabled: false }).map((p) => [String(p.id), p]));
  return requestedItems.map(({ ref, qty }) => {
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

function successRedirect(orderId, successUrl) {
  const base = String(process.env.SITE_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const target = successUrl || process.env.BOUTIQUE_SUCCESS_URL || (base ? `${base}/boutique.html?gamme=pokemon` : "/boutique.html?gamme=pokemon");
  return target + (target.includes("?") ? "&" : "?") + "paid=1&order=" + encodeURIComponent(orderId);
}

function existingCheckoutResponse(order) {
  return {
    order,
    checkoutId: order.sumupCheckoutId,
    providerOrderId: order.sumupCheckoutId,
    url: order.paymentUrl || "",
    paymentId: order.paymentId || "",
    status: "pending"
  };
}

function persistCreatingOrder(payload) {
  const {
    name, email, phone, street, zip, locality, countryName, selection, verifiedItems,
    shippingCost, total, key, requestKey, accountUserId, trafficSource, visitorId
  } = payload;
  const orders = readJson("orders", []);
  const existing = findRecentPendingCheckout(orders, requestKey);
  if (existing?.sumupCheckoutId) return { reused: true, order: existing, selection };
  if (existing) {
    if (checkoutCreationIsFresh(existing)) {
      throw Object.assign(new Error("Création du paiement déjà en cours. Réessaie dans quelques secondes."), {
        status: 409,
        code: "BOUTIQUE_CHECKOUT_IN_PROGRESS",
        orderId: existing.id
      });
    }
    const index = orders.findIndex((order) => String(order.id) === String(existing.id));
    if (index >= 0) {
      const now = new Date().toISOString();
      orders[index].checkoutCreationStatus = "reconciliation_required";
      orders[index].checkoutReconciliationRequiredAt = now;
      orders[index].updatedAt = now;
      writeJson("orders", orders);
    }
    throw Object.assign(new Error("Une commande identique existe déjà sans confirmation de création du paiement. Vérification nécessaire avant de réessayer."), {
      status: 409,
      code: "BOUTIQUE_CHECKOUT_RECONCILIATION_REQUIRED",
      orderId: existing.id
    });
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
    checkoutRequestKey: requestKey,
    checkoutCreationStatus: "creating",
    checkoutCreationStartedAt: now,
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

async function attachSumUpCheckout(order, successUrl, createPaymentSession, pickupPoint) {
  const redirect = successRedirect(order.id, successUrl);
  try {
    const session = await createPaymentSession({
      orderId: order.id,
      amount: order.total,
      description: `Boutique CardoriaShop — ${(order.items || []).length} article(s)`,
      customerEmail: order.email,
      redirectUrl: redirect,
      source: "boutique"
    });
    return withBoutiqueOrderLock(() => {
      const updated = readJson("orders", []);
      const idx = updated.findIndex((row) => row.id === order.id);
      if (idx < 0) throw Object.assign(new Error("Commande Boutique introuvable après création du paiement."), { status: 500, code: "BOUTIQUE_ORDER_LOST" });
      const now = new Date().toISOString();
      updated[idx].sumupCheckoutId = session.checkoutId;
      updated[idx].paymentProviderOrderId = session.checkoutId;
      updated[idx].paymentUrl = session.url;
      updated[idx].paymentId = session.paymentId;
      updated[idx].checkoutCreationStatus = "created";
      updated[idx].checkoutCreationCompletedAt = now;
      updated[idx].updatedAt = now;
      if (updated[idx].pickupPoint && pickupPoint) updated[idx].pickupPoint = pickupPoint;
      writeJson("orders", updated);
      return { order: updated[idx], ...session };
    });
  } catch (error) {
    await withBoutiqueOrderLock(() => {
      const updated = readJson("orders", []);
      const idx = updated.findIndex((row) => row.id === order.id);
      if (idx < 0) return;
      const now = new Date().toISOString();
      updated[idx].paymentStatus = "failed";
      updated[idx].status = "Paiement échoué";
      updated[idx].shipmentStatus = "annulée";
      updated[idx].checkoutCreationStatus = "failed";
      updated[idx].checkoutCreationFailedAt = now;
      updated[idx].paymentError = clean(error?.message || "Paiement SumUp indisponible", 500);
      updated[idx].updatedAt = now;
      writeJson("orders", updated);
    });
    throw error;
  }
}

export async function createLiveBoutiqueCheckout(payload, { createPaymentSession = createSumUpCheckout } = {}) {
  const {
    customerName, customerEmail, customerPhone, address, postalCode, city, country, items, shipping, shippingMethod,
    pickupPoint, successUrl, trafficSource, visitorId, accountUserId = "", requestedProvider, requestedAmount, requestedShippingCost
  } = payload || {};
  assertSaleProvider({ channel: "boutique", requestedProvider });
  if (requestedShippingCost != null && requestedShippingCost !== "" && money(requestedShippingCost) !== 0) {
    throw Object.assign(new Error("Les frais de port envoyés par le client ne correspondent pas au tarif serveur."), { status: 403, code: "SHIPPING_FORGED" });
  }
  const name = clean(customerName, 120);
  const email = validateEmail(customerEmail);
  const phone = clean(customerPhone, 40);
  const street = clean(address, 300);
  const zip = clean(postalCode, 20);
  const locality = clean(city, 120);
  const countryName = clean(country, 80) || "France";
  if (!name) throw Object.assign(new Error("Nom du client obligatoire."), { status: 400 });
  if (!phone) throw Object.assign(new Error("Téléphone obligatoire pour la livraison."), { status: 400 });
  const selection = resolveBoutiqueShippingSelection({ shippingMethod, shipping, pickupPoint });
  if (selection.code !== "mondial_relay" && (!street || !zip || !locality)) {
    throw Object.assign(new Error("Adresse, code postal et ville obligatoires pour la livraison Colissimo."), { status: 400 });
  }
  if (selection.code === "mondial_relay" && !selection.pickupPoint) {
    throw Object.assign(new Error("Point Relais Mondial Relay obligatoire."), { status: 400 });
  }

  const requestedItems = normalizeCheckoutRequestItems(items);
  const requestKey = checkoutRequestFingerprint({
    email,
    items: requestedItems,
    shippingMethod: selection.code,
    pickupId: selection.pickupPoint?.id || ""
  });

  return withCheckoutRequestLock(requestKey, async () => {
    const reserved = await withBoutiqueOrderLock(() => {
      const verifiedItems = validateBoutiqueItems(requestedItems);
      const shippingCost = 0;
      const total = assertServerAmount(money(verifiedItems.reduce((s, i) => s + i.qty * i.price, 0) + shippingCost), requestedAmount);
      const key = fingerprint({ email, items: verifiedItems, total, shippingMethod: selection.code, pickupId: selection.pickupPoint?.id || "" });
      return persistCreatingOrder({
        name, email, phone, street, zip, locality, countryName, selection, verifiedItems,
        shippingCost, total, key, requestKey, accountUserId, trafficSource, visitorId
      });
    });
    if (reserved.reused && reserved.order?.sumupCheckoutId) return existingCheckoutResponse(reserved.order);
    return attachSumUpCheckout(reserved.order, successUrl, createPaymentSession, reserved.selection?.pickupPoint);
  });
}
