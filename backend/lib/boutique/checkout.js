import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { createSumUpCheckout } from "../payments/sumup.js";
import { assertSaleProvider, assertServerAmount } from "../payments/routing.js";
import { listBoutiqueProducts } from "./catalog.js";
import { resolveBoutiqueOrderWeight, resolveBoutiqueShippingSelection } from "./shipping.js";

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const clean = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);
function validateEmail(value) { const email = clean(value, 254).toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Adresse email invalide."), { status: 400 }); return email; }
function validateItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw Object.assign(new Error("Panier vide"), { status: 400 });
  const catalog = new Map(listBoutiqueProducts({ includeDisabled: false }).map((p) => [String(p.id), p]));
  const combined = new Map();
  for (const raw of rawItems) { const ref = clean(raw?.ref || raw?.id, 240); const qty = Math.max(1, Math.min(20, Math.trunc(Number(raw?.qty) || 1))); combined.set(ref, (combined.get(ref) || 0) + qty); }
  return Array.from(combined.entries()).map(([ref, qty]) => {
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
  const verifiedItems = validateItems(items), shippingCost = 0;
  const total = assertServerAmount(money(verifiedItems.reduce((s, i) => s + i.qty * i.price, 0) + shippingCost), requestedAmount);
  const key = fingerprint({ email, items: verifiedItems, total, shippingMethod: selection.code, pickupId: selection.pickupPoint?.id || "" });
  const orders = readJson("orders", []);
  const existing = orders.find((o) => o.idempotencyKey === key && o.paymentStatus === "pending" && Date.now() - Date.parse(o.createdAt || 0) < 30 * 60 * 1000);
  if (existing?.sumupCheckoutId) return { order: existing, checkoutId: existing.sumupCheckoutId, providerOrderId: existing.sumupCheckoutId, url: existing.paymentUrl || "", paymentId: existing.paymentId || "", status: "pending" };
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
  orders.unshift(order); writeJson("orders", orders);
  const base = String(process.env.SITE_URL || process.env.FRONTEND_URL || "").replace(/\/$/, ""), target = successUrl || process.env.BOUTIQUE_SUCCESS_URL || (base ? `${base}/boutique.html?gamme=pokemon` : "/boutique.html?gamme=pokemon");
  const redirect = target + (target.includes("?") ? "&" : "?") + "paid=1&order=" + encodeURIComponent(orderId);
  try {
    const session = await createSumUpCheckout({ orderId, amount: total, description: `Boutique CardoriaShop — ${verifiedItems.length} article(s)`, customerEmail: email, redirectUrl: redirect, source: "boutique" });
    const updated = readJson("orders", []), idx = updated.findIndex((o) => o.id === orderId);
    if (idx >= 0) {
      updated[idx].sumupCheckoutId = session.checkoutId;
      updated[idx].paymentProviderOrderId = session.checkoutId;
      updated[idx].paymentUrl = session.url;
      updated[idx].paymentId = session.paymentId;
      updated[idx].updatedAt = new Date().toISOString();
      if (updated[idx].pickupPoint && selection.pickupPoint) updated[idx].pickupPoint = selection.pickupPoint;
      writeJson("orders", updated);
    }
    return { order: { ...order, sumupCheckoutId: session.checkoutId, pickupPoint: selection.pickupPoint }, ...session };
  } catch (error) {
    const updated = readJson("orders", []), idx = updated.findIndex((o) => o.id === orderId);
    if (idx >= 0) { updated[idx].paymentStatus = "failed"; updated[idx].status = "Paiement échoué"; updated[idx].shipmentStatus = "annulée"; updated[idx].paymentError = clean(error?.message || "Paiement SumUp indisponible",500); updated[idx].updatedAt = new Date().toISOString(); writeJson("orders", updated); }
    throw error;
  }
}
