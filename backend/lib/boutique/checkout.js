import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { createSumUpCheckout } from "../payments/sumup.js";
import { listBoutiqueProducts } from "./stock.js";

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function validateItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw Object.assign(new Error("Panier vide"), { status: 400 });
  }

  const catalog = new Map(
    listBoutiqueProducts({ includeDisabled: false }).map((product) => [String(product.id), product])
  );

  return rawItems.map((raw) => {
    const ref = String(raw.ref || raw.id || "").trim();
    const product = catalog.get(ref);
    if (!product || product.boutiqueEnabled === false) {
      throw Object.assign(new Error(`Produit indisponible: ${ref || "référence manquante"}`), { status: 400 });
    }
    const qty = Math.max(1, Math.min(20, Math.trunc(Number(raw.qty) || 1)));
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

export async function createLiveBoutiqueCheckout({ customerName, customerEmail, items, shipping, successUrl, trafficSource, visitorId }) {
  const verifiedItems = validateItems(items);
  const shippingCost = 0;
  const total = money(verifiedItems.reduce((sum, item) => sum + item.qty * item.price, 0) + shippingCost);
  const orderId = "CMD-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomInt(1000, 10000);
  const now = new Date().toISOString();
  const order = {
    id: orderId,
    date: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
    client: String(customerName || "").slice(0, 120),
    email: String(customerEmail || "").trim().toLowerCase().slice(0, 254),
    address: "",
    items: verifiedItems,
    payment: "En attente SumUp",
    paymentStatus: "pending",
    status: "En attente SumUp",
    shipping: shipping || "Standard",
    shippingCost,
    tracking: "",
    total,
    sumupCheckoutId: "",
    sumupTransactionId: "",
    trafficSource: trafficSource === "witnot" ? "witnot" : "",
    visitorId: visitorId || ""
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
