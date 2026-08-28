import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { createSumUpCheckout } from "../payments/sumup.js";
import { listBoutiqueProducts } from "./stock.js";

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function validateEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Adresse email invalide."), { status: 400 });
  return email;
}

function validateItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw Object.assign(new Error("Panier vide"), { status: 400 });
  }

  const catalog = new Map(
    listBoutiqueProducts({ includeDisabled: false }).map((product) => [String(product.id), product])
  );
  const combined = new Map();
  for (const raw of rawItems) {
    const ref = clean(raw?.ref || raw?.id, 240);
    const qty = Math.max(1, Math.min(20, Math.trunc(Number(raw?.qty) || 1)));
    combined.set(ref, (combined.get(ref) || 0) + qty);
  }

  return Array.from(combined.entries()).map(([ref, qty]) => {
    const product = catalog.get(ref);
    if (!product || product.boutiqueEnabled === false) {
      throw Object.assign(new Error(`Produit indisponible: ${ref || "référence manquante"}`), { status: 400 });
    }
    if (qty > Number(product.stock || 0)) {
      throw Object.assign(new Error(`Stock insuffisant pour ${product.name} (${product.stock} disponible).`), { status: 409 });
    }
    if (!product.purchasable || Number(product.price || 0) <= 0) {
      throw Object.assign(new Error(`Prix Boutique non défini pour ${product.name}.`), { status: 409 });
    }
    return {
      ref: product.id,
      name: product.name,
      qty,
      price: money(product.price),
      category: product.category || "pokemon"
    };
  });
}

export async function createLiveBoutiqueCheckout({ customerName, customerEmail, customerPhone, address, postalCode, city, country, items, shipping, successUrl, trafficSource, visitorId }) {
  const name = clean(customerName, 120);
  const email = validateEmail(customerEmail);
  const phone = clean(customerPhone, 40);
  const street = clean(address, 300);
  const zip = clean(postalCode, 20);
  const locality = clean(city, 120);
  const countryName = clean(country, 80) || "France";
  if (!name) throw Object.assign(new Error("Nom du client obligatoire."), { status: 400 });
  if (!phone) throw Object.assign(new Error("Téléphone obligatoire pour la livraison."), { status: 400 });
  if (!street || !zip || !locality) throw Object.assign(new Error("Adresse, code postal et ville obligatoires pour la livraison."), { status: 400 });

  const verifiedItems = validateItems(items);
  const shippingCost = 0;
  const total = money(verifiedItems.reduce((sum, item) => sum + item.qty * item.price, 0) + shippingCost);
  const orderId = "CMD-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomInt(1000, 10000);
  const now = new Date().toISOString();
  const fullAddress = [street, `${zip} ${locality}`.trim(), countryName].filter(Boolean).join("\n");
  const order = {
    id: orderId,
    date: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
    client: name,
    email,
    phone,
    address: fullAddress,
    shippingAddress: { address: street, postalCode: zip, city: locality, country: countryName },
    items: verifiedItems,
    payment: "En attente SumUp",
    paymentStatus: "pending",
    status: "En attente SumUp",
    shipping: clean(shipping, 120) || "Standard",
    shippingCost,
    carrier: "",
    tracking: "",
    total,
    sumupCheckoutId: "",
    sumupTransactionId: "",
    trafficSource: trafficSource === "witnot" ? "witnot" : "",
    visitorId: clean(visitorId, 200)
  };

  const orders = readJson("orders", []);
  orders.unshift(order);
  writeJson("orders", orders);

  const base = String(process.env.SITE_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const defaultSuccess = base ? `${base}/boutique.html` : "/boutique.html";
  const target = successUrl || process.env.BOUTIQUE_SUCCESS_URL || defaultSuccess;
  const redirect = target + (target.includes("?") ? "&" : "?") + "paid=1&order=" + encodeURIComponent(orderId);

  try {
    const session = await createSumUpCheckout({
      orderId,
      amount: total,
      description: `Boutique Cardoria — ${verifiedItems.length} article(s)`,
      customerEmail: order.email,
      redirectUrl: redirect,
      source: "boutique"
    });
    const updated = readJson("orders", []);
    const index = updated.findIndex((item) => item.id === orderId);
    if (index >= 0) {
      updated[index].sumupCheckoutId = session.checkoutId;
      updated[index].updatedAt = new Date().toISOString();
      writeJson("orders", updated);
    }
    return { order: { ...order, sumupCheckoutId: session.checkoutId }, ...session };
  } catch (error) {
    const updated = readJson("orders", []);
    const index = updated.findIndex((item) => item.id === orderId);
    if (index >= 0) {
      updated[index].paymentStatus = "failed";
      updated[index].status = "Paiement échoué";
      updated[index].updatedAt = new Date().toISOString();
      writeJson("orders", updated);
    }
    throw error;
  }
}
