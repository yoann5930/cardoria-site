import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getSellerPlan,
  getLiveCommissionAmount,
  isLiveBuyerShippingPaidByCardoria,
  liveShipmentGroupKey,
  marketplaceCommissionRate,
  nextCapturedSaleNumber
} from "../lib/subscriptions/plans.js";

test("canonical plan prices and commissions are exact", () => {
  assert.equal(getSellerPlan("starter").monthlyPriceEur, 19.9);
  assert.equal(getSellerPlan("starter").liveCommissionRate, 0.06);
  assert.equal(getSellerPlan("pro").monthlyPriceEur, 49.9);
  assert.equal(getSellerPlan("pro").liveCommissionRate, 0.045);
  assert.equal(getSellerPlan("elite").monthlyPriceEur, 129.9);
  assert.equal(getSellerPlan("elite").liveCommissionRate, 0.03);
  assert.equal(getLiveCommissionAmount("starter", 100), 6);
  assert.equal(getLiveCommissionAmount("pro", 100), 4.5);
  assert.equal(getLiveCommissionAmount("elite", 100), 3);
});

test("Starter has no Cardoria-paid Live shipping, waiver, priority or badge", () => {
  const plan = getSellerPlan("starter");
  assert.equal(plan.liveCardoriaShippingBuyerLimit, 0);
  assert.equal(plan.marketplaceFreeCapturedSalesPerMonth, 0);
  assert.equal(plan.livePriority, false);
  assert.equal(plan.badge, false);
  assert.equal(isLiveBuyerShippingPaidByCardoria("starter", "buyer-1", []), false);
  assert.equal(marketplaceCommissionRate("starter", 1), 0.05);
});

test("Pro pays shipping for first 6 distinct Live buyers only", () => {
  const firstFive = ["b1", "b2", "b3", "b4", "b5"];
  assert.equal(isLiveBuyerShippingPaidByCardoria("pro", "b6", firstFive), true);
  assert.equal(isLiveBuyerShippingPaidByCardoria("pro", "b7", [...firstFive, "b6"]), false);
  assert.equal(isLiveBuyerShippingPaidByCardoria("pro", "b2", [...firstFive, "b6"]), true);
  assert.equal(marketplaceCommissionRate("pro", 1), 0.05);
});

test("Elite pays first 15 distinct Live buyers and gets 15 Marketplace fee-free captures", () => {
  const first14 = Array.from({ length: 14 }, (_, i) => `b${i + 1}`);
  assert.equal(isLiveBuyerShippingPaidByCardoria("elite", "b15", first14), true);
  assert.equal(isLiveBuyerShippingPaidByCardoria("elite", "b16", [...first14, "b15"]), false);
  for (let n = 1; n <= 15; n += 1) assert.equal(marketplaceCommissionRate("elite", n), 0);
  assert.equal(marketplaceCommissionRate("elite", 16), 0.05);
  assert.equal(getSellerPlan("elite").livePriority, true);
  assert.equal(getSellerPlan("elite").badge, true);
});

test("Live grouping is exactly live + seller + buyer", () => {
  assert.equal(liveShipmentGroupKey({ liveId: "LIVE1", sellerId: "SELL1", buyerId: "BUY1" }), "LIVE1::SELL1::BUY1");
});

test("captured-sale counter ignores uncaptured, isolates sellers and resets by month", () => {
  const rows = [
    { sellerId: "s1", captured: true, capturedAt: "2026-09-01T10:00:00Z" },
    { sellerId: "s1", captured: false, capturedAt: "2026-09-02T10:00:00Z" },
    { sellerId: "s2", captured: true, capturedAt: "2026-09-03T10:00:00Z" },
    { sellerId: "s1", captured: true, capturedAt: "2026-08-31T23:00:00Z" }
  ];
  assert.equal(nextCapturedSaleNumber({ capturedSales: rows, sellerId: "s1", capturedAt: "2026-09-20T12:00:00Z" }), 2);
  assert.equal(nextCapturedSaleNumber({ capturedSales: rows, sellerId: "s2", capturedAt: "2026-09-20T12:00:00Z" }), 2);
  assert.equal(nextCapturedSaleNumber({ capturedSales: rows, sellerId: "s1", capturedAt: "2026-10-01T00:00:00Z" }), 1);
});

test("invalid plan and invalid amounts are rejected", () => {
  assert.throws(() => getSellerPlan("unknown"), /inconnu/i);
  assert.throws(() => getLiveCommissionAmount("starter", -1), /invalide/i);
  assert.throws(() => marketplaceCommissionRate("elite", 0), /invalide/i);
});

test("durable seller plan state and capture ledger are idempotent", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cardoria-subscriptions-"));
  const cwd = process.cwd();
  process.chdir(temp);
  try {
    const mod = await import(`../lib/subscriptions/seller-plans.js?test=${Date.now()}`);
    assert.equal(mod.getSellerPlanState("seller-a").active, false);
    const active = mod.setSellerPlan("seller-a", "elite", { status: "active", startedAt: "2026-09-01T00:00:00Z" });
    assert.equal(active.planId, "elite");
    assert.equal(active.active, true);
    assert.equal(active.entitlements.marketplace.freeCapturedSalesPerCalendarMonth, 15);

    const first = mod.recordMarketplaceCapture({ orderId: "order-1", sellerId: "seller-a", capturedAt: "2026-09-03T12:00:00Z" });
    const duplicate = mod.recordMarketplaceCapture({ orderId: "order-1", sellerId: "seller-a", capturedAt: "2026-09-03T12:01:00Z" });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(mod.countCapturedMarketplaceSalesForMonth("seller-a", "2026-09-20T00:00:00Z"), 1);
    assert.equal(mod.countCapturedMarketplaceSalesForMonth("seller-a", "2026-10-01T00:00:00Z"), 0);
  } finally {
    process.chdir(cwd);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
