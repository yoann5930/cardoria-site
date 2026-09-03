import { getDb } from "../engine/database.js";
import { DEFAULT_SELLER_PLAN, assertSellerPlan, capturedSaleCalendarMonthKey, getSellerPlanEntitlements, marketplaceCommissionAmount, marketplaceCommissionRate } from "./plans.js";

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

function monthBounds(value = new Date()) {
  const month = capturedSaleCalendarMonthKey(value);
  const start = `${month}-01T00:00:00.000Z`;
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString();
  return { month, start, end };
}

export function getSellerPlanState(sellerId) {
  const id = sellerIdValue(sellerId);
  const row = getDb().prepare("SELECT id, plan_id, plan_status, plan_started_at FROM mk_sellers WHERE id=?").get(id);
  if (!row) throw Object.assign(new Error("Vendeur introuvable."), { code: 404, status: 404 });
  const planId = String(row.plan_id || DEFAULT_SELLER_PLAN).trim().toLowerCase();
  const plan = assertSellerPlan(planId);
  const status = PLAN_STATUSES.has(String(row.plan_status || "").toLowerCase()) ? String(row.plan_status).toLowerCase() : "inactive";
  return {
    sellerId: id,
    planId: plan.id,
    status,
    active: status === "active",
    planStartedAt: row.plan_started_at || "",
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
  const started = planStatus === "active" ? date.toISOString() : "";
  const result = getDb().prepare("UPDATE mk_sellers SET plan_id=?, plan_status=?, plan_started_at=? WHERE id=?").run(plan.id, planStatus, started, id);
  if (!result.changes) throw Object.assign(new Error("Vendeur introuvable."), { code: 404, status: 404 });
  return getSellerPlanState(id);
}

export function countCapturedMarketplaceSalesForMonth(sellerId, value = new Date()) {
  const id = sellerIdValue(sellerId);
  const { start, end } = monthBounds(value);
  const row = getDb().prepare(`
    SELECT COUNT(*) AS count
    FROM mk_orders
    WHERE seller_id=?
      AND payment_provider='paypal'
      AND payment_status='paid'
      AND payment_captured_at>=?
      AND payment_captured_at<?
  `).get(id, start, end);
  return Number(row?.count || 0);
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
