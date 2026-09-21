import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { createSumUpCheckout } from "../payments/sumup.js";
import { assertSaleProvider, assertServerAmount } from "../payments/routing.js";
import { listBoutiqueProducts } from "./catalog.js";
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
function validateEmail(value) { const email = clean(value, 254).toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Adresse email invalide."), { status: 400 }); return email; }
function validateItems(requestedItems) {
  const catalog = new Map(listBoutiqueProducts({ includeDisabled: false }).map((p) => [String(p.id), p]));
  return requestedItems.map(({ ref, qty }) => {
    const p = catalog.get(ref);
    if (!p || p.boutiqueEnabled === false) throw Object.assign(new Error(`Produit indisponible: ${ref || "référence manquante"}`), { status: 400 });
    if (qty > Number(p.stock || 0)) throw Object.assign(new Error(`Stock insuffisant pour ${p.name} (${p.stock} disponible).`), { status: 409 });
    if (!p.purchasable || Number(p.price || 0) <= 0) throw Object.assign(new Error(`Prix Boutique non défini pour ${p.name}.`), { status: 409 });
    const weight = Math.trunc(Number(p.shippingWeightGrams));
    const item = { ref: p.id, name: p.name, qty, price: money(p.price), category: p.category || "pokemon" };
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
async function attachSumUpCheckout(order, successUrl) {
  const redirect = successRedirect(order.id, successUrl);
  try {
    const session = await createSumUpCheckout({
      orderId: order.id,
      amount: order.total,
      description: `Boutique CardoriaShop — ${(order.items || []).length} article(s)`,
      customerEmail: order.email,
      redirectUrl: redirect,
      source: "boutique"
    });
    const updated = readJson("orders", []), idx = updated.findIndex((o) => o.id === order.id);
    if (idx < 0) throw Object.assign(new Error("Commande Boutique introuvable après création du paiement."), { status: 500, code: "BOUTIQUE_ORDER_LOST" });
    const now = new Date().toISOString();
    updated[idx].sumupCheckoutId = session.checkoutId;
    updated[idx].paymentProviderOrderId = session.checkoutId;
    updated[idx].paymentUrl = session.url;
    updated[idx].paymentId = session.paymentId;
    updated[idx].checkoutCreationStatus = "created";
    updated[idx].checkoutCreationCompletedAt = now;
    updated[idx].updatedAt = now;
    writeJson("orders", updated);
    return { order: updated[idx], ...session };
  } catch (error) {
    const updated = readJson("orders", []), idx = updated.findIndex((o) => o.id === order.id);
    if (idx >= 0) {
      const now = new Date().toISOString();
      updated[idx].paymentStatus = "failed";
      updated[idx].status = "Paiement échoué";
      updated[idx].shipmentStatus = "annulée";
      updated[idx].checkoutCreationStatus = "failed";
      updated[idx].checkoutCreationFailedAt = now;
      updated[idx].paymentError = clean(error?.message || "Paiement SumUp indisponible", 500);
      updated[idx].updatedAt = now;
      writeJson("orders", updated);
    }
    throw error;
  }
}

export async function createLiveBoutiqueCheckout({ customerName, customerEmail, customerPhone, address, postalCode, city, country, items, shipping, shippingMethod, pickupPoint, successUrl, trafficSource, visitorId, accountUserId = "", requestedProvider, requestedAmount }) {
  assertSaleProvider({ channel: "boutique", requestedProvider });
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

  const requestedItems = normalizeCheckoutRequestItems(items);
  const requestKey = checkoutRequestFingerprint({
    email,
    items: requestedItems,
    shippingMethod: selection.code,
    pickupId: selection.pickupPoint?.id || ""
  });

  return withCheckoutRequestLock(requestKey, async () => {
    let orders = readJson("orders", []);
    const existing = findRecentPendingCheckout(orders, requestKey);
    if (existing?.sumupCheckoutId) return existingCheckoutResponse(existing);
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

    const verifiedItems = validateItems(requestedItems), shippingCost = 0;
    const total = assertServerAmount(money(verifiedItems.reduce((s, i) => s + i.qty * i.price, 0) + shippingCost), requestedAmount);
    const key = fingerprint({ email, items: verifiedItems, total, shippingMethod: selection.code, pickupId: selection.pickupPoint?.id || "" });

    // Re-read after stock/price validation so a checkout created by another process
    // while this request was waiting on the file lock is reused instead of duplicated.
    orders = readJson("orders", []);
    const raced = findRecentPendingCheckout(orders, requestKey);
    if (raced?.sumupCheckoutId) return existingCheckoutResponse(raced);
    if (raced) {
      throw Object.assign(new Error("Création du paiement déjà en cours. Réessaie dans quelques secondes."), {
        status: 409,
        code: "BOUTIQUE_CHECKOUT_IN_PROGRESS",
        orderId: raced.id
      });
    }

    const orderId = "CMD-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomInt(1000, 10000), now = new Date().toISOString();
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
    return attachSumUpCheckout(order, successUrl);
  });
}
