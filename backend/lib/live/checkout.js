/**
 * Checkout Live Cardoria : Live Admin → Revolut, Live vendeur → PayPal.
 */
import crypto from "crypto";
import { assertSaleProvider, assertServerAmount, money } from "../payments/routing.js";
import { createRevolutCheckout, isRevolutConfigured, getRevolutEnvironment } from "../payments/revolut.js";
import { getPayPalMarketplaceConfig, createLivePayPalOrder } from "../marketplace/paypal.js";
import { getLiveCommissionAmount, getSellerPlan } from "../subscriptions/plans.js";
import { getSellerPlanState } from "../subscriptions/seller-plans.js";
import {
  getLiveCheckout,
  getLiveSession,
  saveLiveCheckout,
  withLiveLock
} from "./sessions.js";

function clean(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function validateEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Adresse email invalide."), { status: 400 });
  return email;
}

function commissionFor(live, amount) {
  if (live.ownerRole !== "seller") {
    return { platformFee: 0, sellerNet: amount, commissionPercent: 0 };
  }
  try {
    const state = getSellerPlanState(live.ownerId);
    const plan = getSellerPlan(state.planId);
    const platformFee = money(getLiveCommissionAmount(state.planId, amount));
    return {
      platformFee,
      sellerNet: money(amount - platformFee),
      commissionPercent: Number(plan.liveCommissionRate) * 100,
      planId: plan.id
    };
  } catch {
    const percent = 5;
    const platformFee = money(amount * (percent / 100));
    return { platformFee, sellerNet: money(amount - platformFee), commissionPercent: percent };
  }
}

export function planLiveCheckout({ liveId, productId, qty, customerEmail, customerName, requestedProvider, requestedAmount }) {
  const live = getLiveSession(liveId);
  if (!live) throw Object.assign(new Error("Live introuvable."), { status: 404 });
  if (live.status === "cancelled" || live.status === "ended") {
    throw Object.assign(new Error("Ce Live n'accepte plus de paiement."), { status: 409 });
  }
  const route = assertSaleProvider({
    channel: "live",
    ownerRole: live.ownerRole,
    requestedProvider
  });
  const product = (live.products || []).find((item) => item.id === String(productId || ""));
  if (!product) throw Object.assign(new Error("Produit Live introuvable."), { status: 404 });
  const units = Math.max(1, Math.min(20, Math.trunc(Number(qty) || 1)));
  if (Number(product.stock || 0) < units) {
    throw Object.assign(new Error(`Stock Live insuffisant pour ${product.name}.`), { status: 409 });
  }
  const amount = assertServerAmount(money(product.price) * units, requestedAmount);
  const email = validateEmail(customerEmail);
  const name = clean(customerName, 120) || "Client Live";
  const commission = commissionFor(live, amount);
  const idempotencyKey = [live.id, product.id, email, units].join(":");
  const existing = getLiveCheckout(idempotencyKey);
  if (existing) {
    if (existing.status === "paid") {
      throw Object.assign(new Error("Ce paiement Live a déjà été traité."), { status: 409 });
    }
    if (existing.status === "pending" || existing.status === "planned") {
      return existing;
    }
  }
  const checkout = {
    id: "LCK-" + crypto.randomUUID(),
    idempotencyKey,
    liveId: live.id,
    liveTitle: live.title,
    ownerRole: live.ownerRole,
    ownerId: live.ownerId,
    channel: route.channel,
    provider: route.provider,
    productId: product.id,
    productName: product.name,
    qty: units,
    amount,
    ...commission,
    customerEmail: email,
    customerName: name,
    status: "planned",
    paymentProviderOrderId: "",
    url: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return saveLiveCheckout(checkout);
}

export async function createLiveCheckout(input) {
  const planned = planLiveCheckout(input);
  return withLiveLock(planned.idempotencyKey, async () => {
    const current = getLiveCheckout(planned.id) || planned;
    if (current.status === "paid") {
      throw Object.assign(new Error("Ce paiement Live a déjà été traité."), { status: 409 });
    }
    if (current.url && current.paymentProviderOrderId && current.status === "pending") {
      return current;
    }
    if (current.provider === "revolut") {
      if (!isRevolutConfigured()) {
        throw Object.assign(new Error("Paiement Revolut non configuré. Définir REVOLUT_SECRET_KEY dans /etc/cardoria/cardoria.env sur OVH."), {
          status: 503,
          provider: "revolut"
        });
      }
      const session = await createRevolutCheckout({
        orderId: current.id,
        amount: current.amount,
        description: `Live Cardoria — ${current.productName}`,
        customerName: current.customerName,
        customerEmail: current.customerEmail,
        redirectUrl: String(input.successUrl || "/live.html"),
        source: "live_cardoria"
      });
      current.status = "pending";
      current.paymentProviderOrderId = session.providerOrderId;
      current.url = session.url;
      current.environment = session.environment || getRevolutEnvironment();
      current.updatedAt = new Date().toISOString();
      return saveLiveCheckout(current);
    }
    const paypal = getPayPalMarketplaceConfig();
    if (!paypal.configured) {
      throw Object.assign(new Error("Paiement PayPal non configuré côté serveur."), {
        status: 503,
        provider: "paypal"
      });
    }
    const payment = await createLivePayPalOrder({
      checkoutId: current.id,
      amount: current.amount,
      sellerId: current.ownerId,
      description: `Live vendeur Cardoria — ${current.productName}`,
      successUrl: String(input.successUrl || "/live.html"),
      cancelUrl: String(input.cancelUrl || "/live.html"),
      platformFee: current.platformFee
    });
    current.status = "pending";
    current.paymentProviderOrderId = payment.id;
    current.url = payment.url;
    current.environment = paypal.environment;
    current.updatedAt = new Date().toISOString();
    return saveLiveCheckout(current);
  });
}
