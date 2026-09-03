import { readJson, writeJson } from "../storage.js";
import { DEFAULT_SELLER_PLAN, assertSellerPlan, capturedSaleCalendarMonthKey, getSellerPlanEntitlements, marketplaceCommissionAmount, marketplaceCommissionRate } from "./plans.js";

const PLAN_STORE = "seller-subscriptions";
const CAPTURE_STORE = "marketplace-captured-sales";
const PLAN_STATUSES = new Set(["inactive", "active", "canceled"]);

function sellerIdValue(sellerId) {
  const id = String(sellerId || "").trim();
  if (!id) throw Object.assign(new Error("Vendeur requis."), { code: 400, status: 400 });
  return id;
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!PLAN_STATUSES.has(value)) throw Object.assign(new Error("Statut d'abonnement vendeur invalide."), { code: 400, status: 400 });
  return value;
}

function subscriptions() {
  const rows = readJson(PLAN_STORE, []);
  return Array.isArray(rows) ? rows : [];
}

function captures() {
  const rows = readJson(CAPTURE_STORE, []);
  return Array.isArray(rows) ? rows : [];
}

export function getSellerPlanState(sellerId) {
  const id = sellerIdValue(sellerId);
  const row = subscriptions().find((item) => item && item.sellerId === id) || null;
  const planId = String(row?.planId || DEFAULT_SELLER_PLAN).trim().toLowerCase();
  const plan = assertSellerPlan(planId);
  const status = PLAN_STATUSES.has(String(row?.status || "").toLowerCase()) ? String(row.status).toLowerCase() : "inactive";
  return {
    sellerId: id,
    planId: plan.id,
    status,
    active: status === "active",
    planStartedAt: row?.startedAt || "",
    updatedAt: row?.updatedAt || "",
    entitlements: status === "active" ? getSellerPlanEntitlements(plan.id) : null
  };
}

export function assertActiveSellerPlan(sellerId) {
  const state = getSellerPlanState(sellerId);
  if (!state.active) throw Object.assign(new Error("Un abonnement vendeur Cardoria actif est requis."), { code: 409, status: 409 });
  return state;
}

export function setSellerPlan(sellerId, planId, { status = "active", startedAt = new Date() } = {}) {
  const id = sellerIdValue(sellerId);
  const plan = assertSellerPlan(planId);
  const planStatus = normalizeStatus(status);
  const date = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("Date de debut d'abonnement invalide."), { code: 400, status: 400 });
  const now = new Date().toISOString();
  const rows = subscriptions().filter((item) => item && item.sellerId !== id);
  rows.push({ sellerId: id, planId: plan.id, status: planStatus, startedAt: planStatus === "active" ? date.toISOString() : "", updatedAt: now });
  writeJson(PLAN_STORE, rows);
  return getSellerPlanState(id);
}

export function recordMarketplaceCapture({ orderId, sellerId, capturedAt = new Date() }) {
  const order = String(orderId || "").trim();
  const seller = sellerIdValue(sellerId);
  if (!order) throw Object.assign(new Error("Commande Marketplace requise."), { code: 400, status: 400 });
  const date = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("Date de capture Marketplace invalide."), { code: 400, status: 400 });
  const rows = captures();
  const existing = rows.find((item) => item && item.orderId === order);
  if (existing) return { ...existing, duplicate: true };
  const entry = { orderId: order, sellerId: seller, capturedAt: date.toISOString() };
  rows.push(entry);
  writeJson(CAPTURE_STORE, rows);
  return { ...entry, duplicate: false };
}

export function countCapturedMarketplaceSalesForMonth(sellerId, value = new Date()) {
  const id = sellerIdValue(sellerId);
  const month = capturedSaleCalendarMonthKey(value);
  return captures().filter((item) => item && item.sellerId === id && capturedSaleCalendarMonthKey(item.capturedAt) === month).length;
}

export function getMarketplaceFeeQuote({ sellerId, grossAmountEur, shippingCostEur = 0, includeShipping = false, capturedAt = new Date(), additionalCapturedSales = 0 }) {
  const state = assertActiveSellerPlan(sellerId);
  const alreadyCaptured = countCapturedMarketplaceSalesForMonth(sellerId, capturedAt);
  const offset = Number(additionalCapturedSales);
  if (!Number.isInteger(offset) || offset < 0) throw Object.assign(new Error("Offset de ventes capturees invalide."), { code: 400, status: 400 });
  const capturedSaleNumber = alreadyCaptured + offset + 1;
  const total = Number(grossAmountEur);
  const shipping = Number(shippingCostEur || 0);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(shipping) || shipping < 0) throw Object.assign(new Error("Montant Marketplace invalide."), { code: 400, status: 400 });
  const commissionBase = includeShipping ? total : Math.max(0, total - shipping);
  const rate = marketplaceCommissionRate(state.planId, capturedSaleNumber);
  return {
    sellerId: state.sellerId,
    planId: state.planId,
    calendarMonth: capturedSaleCalendarMonthKey(capturedAt),
    alreadyCaptured,
    capturedSaleNumber,
    commissionRate: rate,
    commissionPercent: rate * 100,
    commissionBase: Math.round(commissionBase * 100) / 100,
    platformFee: marketplaceCommissionAmount(state.planId, capturedSaleNumber, commissionBase)
  };
}
