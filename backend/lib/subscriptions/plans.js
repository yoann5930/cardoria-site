const PLAN_DEFINITIONS = Object.freeze({
  starter: Object.freeze({
    id: "starter",
    name: "Starter",
    monthlyPriceEur: 19.9,
    liveCommissionRate: 0.06,
    liveCardoriaShippingBuyerLimit: 0,
    marketplaceCommissionRate: 0.05,
    marketplaceFreeCapturedSalesPerMonth: 0,
    livePriority: false,
    badge: false,
    paypalFeesPaidBySeller: true
  }),
  pro: Object.freeze({
    id: "pro",
    name: "Pro",
    monthlyPriceEur: 49.9,
    liveCommissionRate: 0.045,
    liveCardoriaShippingBuyerLimit: 6,
    marketplaceCommissionRate: 0.05,
    marketplaceFreeCapturedSalesPerMonth: 0,
    livePriority: false,
    badge: false,
    paypalFeesPaidBySeller: true
  }),
  elite: Object.freeze({
    id: "elite",
    name: "Elite",
    monthlyPriceEur: 129.9,
    liveCommissionRate: 0.03,
    liveCardoriaShippingBuyerLimit: 15,
    marketplaceCommissionRate: 0.05,
    marketplaceFreeCapturedSalesPerMonth: 15,
    livePriority: true,
    badge: true,
    paypalFeesPaidBySeller: true
  })
});

export const SELLER_PLANS = PLAN_DEFINITIONS;
export const DEFAULT_SELLER_PLAN = "starter";

function normalizePlanId(planId) {
  return String(planId || "").trim().toLowerCase();
}

export function assertSellerPlan(planId) {
  const id = normalizePlanId(planId);
  const plan = PLAN_DEFINITIONS[id];
  if (!plan) throw Object.assign(new Error("Abonnement vendeur Cardoria inconnu."), { code: 400, status: 400 });
  return plan;
}

export function listSellerPlans() {
  return Object.values(PLAN_DEFINITIONS).map((plan) => ({ ...plan }));
}

export function getSellerPlan(planId = DEFAULT_SELLER_PLAN) {
  return { ...assertSellerPlan(planId) };
}

export function getLiveCommissionRate(planId) {
  return assertSellerPlan(planId).liveCommissionRate;
}

export function getLiveCommissionAmount(planId, grossAmountEur) {
  const gross = Number(grossAmountEur);
  if (!Number.isFinite(gross) || gross < 0) throw Object.assign(new Error("Montant Live invalide."), { code: 400, status: 400 });
  return Math.round(gross * getLiveCommissionRate(planId) * 100) / 100;
}

function normalizeDistinctBuyers(distinctBuyerIds) {
  if (!Array.isArray(distinctBuyerIds)) throw Object.assign(new Error("Liste d'acheteurs Live invalide."), { code: 400, status: 400 });
  const seen = new Set();
  const ordered = [];
  for (const value of distinctBuyerIds) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function isLiveBuyerShippingPaidByCardoria(planId, buyerId, priorBuyerIds = []) {
  const plan = assertSellerPlan(planId);
  const buyer = String(buyerId || "").trim();
  if (!buyer) throw Object.assign(new Error("Acheteur Live requis."), { code: 400, status: 400 });
  if (plan.liveCardoriaShippingBuyerLimit <= 0) return false;
  const prior = normalizeDistinctBuyers(priorBuyerIds);
  const existingIndex = prior.indexOf(buyer);
  if (existingIndex >= 0) return existingIndex < plan.liveCardoriaShippingBuyerLimit;
  return prior.length < plan.liveCardoriaShippingBuyerLimit;
}

export function liveShipmentGroupKey({ liveId, sellerId, buyerId }) {
  const live = String(liveId || "").trim();
  const seller = String(sellerId || "").trim();
  const buyer = String(buyerId || "").trim();
  if (!live || !seller || !buyer) throw Object.assign(new Error("liveId, sellerId et buyerId sont requis."), { code: 400, status: 400 });
  return `${live}::${seller}::${buyer}`;
}

export function marketplaceCommissionRate(planId, capturedSaleNumberInCalendarMonth) {
  const plan = assertSellerPlan(planId);
  const saleNumber = Number(capturedSaleNumberInCalendarMonth);
  if (!Number.isInteger(saleNumber) || saleNumber < 1) throw Object.assign(new Error("Numero de vente Marketplace capturee invalide."), { code: 400, status: 400 });
  if (plan.marketplaceFreeCapturedSalesPerMonth > 0 && saleNumber <= plan.marketplaceFreeCapturedSalesPerMonth) return 0;
  return plan.marketplaceCommissionRate;
}

export function marketplaceCommissionAmount(planId, capturedSaleNumberInCalendarMonth, grossAmountEur) {
  const gross = Number(grossAmountEur);
  if (!Number.isFinite(gross) || gross < 0) throw Object.assign(new Error("Montant Marketplace invalide."), { code: 400, status: 400 });
  return Math.round(gross * marketplaceCommissionRate(planId, capturedSaleNumberInCalendarMonth) * 100) / 100;
}

export function capturedSaleCalendarMonthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("Date de vente invalide."), { code: 400, status: 400 });
  return date.toISOString().slice(0, 7);
}

export function nextCapturedSaleNumber({ capturedSales = [], sellerId, capturedAt = new Date() }) {
  const seller = String(sellerId || "").trim();
  if (!seller) throw Object.assign(new Error("Vendeur requis."), { code: 400, status: 400 });
  if (!Array.isArray(capturedSales)) throw Object.assign(new Error("Historique de ventes invalide."), { code: 400, status: 400 });
  const month = capturedSaleCalendarMonthKey(capturedAt);
  let count = 0;
  for (const sale of capturedSales) {
    if (!sale || String(sale.sellerId || "").trim() !== seller || sale.captured !== true) continue;
    if (capturedSaleCalendarMonthKey(sale.capturedAt) === month) count += 1;
  }
  return count + 1;
}

export function getSellerPlanEntitlements(planId) {
  const plan = assertSellerPlan(planId);
  return {
    plan: { ...plan },
    live: {
      commissionRate: plan.liveCommissionRate,
      cardoriaShippingDistinctBuyerLimit: plan.liveCardoriaShippingBuyerLimit,
      groupingKey: "live_id + seller_id + buyer_id",
      closesAtLiveEnd: true,
      priority: plan.livePriority,
      badge: plan.badge
    },
    marketplace: {
      commissionRate: plan.marketplaceCommissionRate,
      freeCapturedSalesPerCalendarMonth: plan.marketplaceFreeCapturedSalesPerMonth,
      groupingKey: "buyer + seller + open_shipment",
      closesAtShipmentDeparture: true,
      sellerChangeCreatesSeparateParcel: true
    },
    paypalFeesPaidBySeller: plan.paypalFeesPaidBySeller
  };
}
