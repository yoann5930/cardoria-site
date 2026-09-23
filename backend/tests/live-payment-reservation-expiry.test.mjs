import test from "node:test";
import assert from "node:assert/strict";

import {
  __resetLiveStoreForTests,
  __setLiveStoreForTests,
  applyLivePaymentStatus,
  createLiveSession,
  getLiveCheckout,
  getLiveSession,
  saveLiveCheckout,
  setLiveStatus
} from "../lib/live/sessions.js";
import { __resetLiveActionsStoreForTests, __setLiveActionsStoreForTests } from "../lib/live/actions.js";
import { planLiveCheckout } from "../lib/live/checkout.js";
import { isCheckoutReservationDue, liveCheckoutReservationHolds } from "../lib/live/checkout-reservations.js";
import { reconcileLiveCheckoutReservation } from "../lib/live/payment-reconciliation.js";

const actor = { role: "admin", id: "admin-test", email: "admin@cardoria.invalid" };
const address = {
  recipientName: "Client Test",
  addressLine1: "1 rue de Test",
  postalCode: "59000",
  city: "Lille",
  countryCode: "FR"
};

function setup(stock = 1) {
  const store = { sessions: [], checkouts: [], adminAccess: [] };
  __setLiveStoreForTests(store);
  __setLiveActionsStoreForTests({ states: {} });
  const live = createLiveSession({
    title: "Reservation expiry",
    ownerRole: "admin",
    ownerId: "cardoria",
    actor,
    products: [{ id: "A", name: "Lot A", mode: "buy_now", price: 10, qty: stock, stock, shippingWeightGrams: 20 }]
  });
  setLiveStatus(live.id, "live", actor, { adminOverride: true });
  return { live };
}

function pendingCheckout(live, patch = {}) {
  const now = new Date().toISOString();
  return saveLiveCheckout({
    id: patch.id || "LCK-PENDING",
    idempotencyKey: patch.idempotencyKey || "pending-key",
    liveId: live.id,
    liveTitle: live.title,
    ownerRole: "admin",
    ownerId: "cardoria",
    provider: "sumup",
    channel: "live",
    productId: "A",
    productName: "Lot A",
    qty: 1,
    unitPrice: 10,
    itemAmount: 10,
    amount: 12.29,
    customerId: patch.customerId || "client-a",
    customerEmail: patch.customerEmail || "a@cardoria.invalid",
    customerName: "Client A",
    shippingAddress: address,
    status: "pending",
    paymentProviderOrderId: patch.paymentProviderOrderId || "SUMUP-1",
    url: "https://pay.example.invalid",
    reservationStartedAt: patch.reservationStartedAt || "2026-09-23T00:00:00.000Z",
    reservationExpiresAt: patch.reservationExpiresAt || "2026-09-23T00:20:00.000Z",
    reservationReleasedAt: "",
    createdAt: patch.createdAt || "2026-09-23T00:00:00.000Z",
    updatedAt: patch.updatedAt || now,
    ...patch
  });
}

test("stale planned quote no longer blocks stock forever", () => {
  const { live } = setup(1);
  try {
    saveLiveCheckout({
      id: "LCK-OLD-QUOTE",
      idempotencyKey: "old-quote",
      liveId: live.id,
      ownerRole: "admin",
      ownerId: "cardoria",
      provider: "sumup",
      productId: "A",
      productName: "Lot A",
      qty: 1,
      customerId: "old-client",
      customerEmail: "old@cardoria.invalid",
      status: "planned",
      reservationStartedAt: "2020-01-01T00:00:00.000Z",
      reservationExpiresAt: "2020-01-01T00:05:00.000Z",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z"
    });
    const old = getLiveCheckout("LCK-OLD-QUOTE");
    assert.equal(isCheckoutReservationDue(old), true);
    assert.equal(liveCheckoutReservationHolds(old), false);

    const next = planLiveCheckout({
      liveId: live.id,
      productId: "A",
      qty: 1,
      customerId: "client-b",
      customerEmail: "b@cardoria.invalid",
      customerName: "Client B",
      shippingAddress: address
    });
    assert.equal(next.status, "planned");
    assert.equal(next.customerId, "client-b");
    assert.ok(Date.parse(next.reservationExpiresAt) > Date.now());
  } finally {
    __resetLiveStoreForTests();
    __resetLiveActionsStoreForTests();
  }
});

test("provider-verified stale pending payment is released only after provider still says pending", async () => {
  const { live } = setup(1);
  try {
    const checkout = pendingCheckout(live);
    assert.equal(liveCheckoutReservationHolds(checkout), true);
    const result = await reconcileLiveCheckoutReservation(checkout, {
      now: Date.parse("2026-09-23T00:21:00.000Z"),
      resolveProvider: async () => ({ provider: "sumup", status: "pending", providerStatus: "PENDING" })
    });
    assert.equal(result.released, true);
    const expired = getLiveCheckout(checkout.id);
    assert.equal(expired.status, "expired");
    assert.ok(expired.reservationReleasedAt);
    assert.equal(liveCheckoutReservationHolds(expired), false);
  } finally {
    __resetLiveStoreForTests();
    __resetLiveActionsStoreForTests();
  }
});

test("provider error never releases a stale pending reservation blindly", async () => {
  const { live } = setup(1);
  try {
    const checkout = pendingCheckout(live);
    const result = await reconcileLiveCheckoutReservation(checkout, {
      now: Date.parse("2026-09-23T00:21:00.000Z"),
      resolveProvider: async () => { throw Object.assign(new Error("network"), { code: "ETIMEDOUT" }); }
    });
    assert.equal(result.deferred, true);
    const current = getLiveCheckout(checkout.id);
    assert.equal(current.status, "pending");
    assert.equal(current.reservationReleasedAt, "");
    assert.equal(liveCheckoutReservationHolds(current), true);
  } finally {
    __resetLiveStoreForTests();
    __resetLiveActionsStoreForTests();
  }
});

test("late paid checkout is accepted when released stock is still free", async () => {
  const { live } = setup(1);
  try {
    const checkout = pendingCheckout(live);
    await reconcileLiveCheckoutReservation(checkout, {
      now: Date.parse("2026-09-23T00:21:00.000Z"),
      resolveProvider: async () => ({ provider: "sumup", status: "pending", providerStatus: "PENDING" })
    });
    const paid = applyLivePaymentStatus(checkout.id, "paid", { paymentProviderTransactionId: "TX-LATE" });
    assert.equal(paid.status, "paid");
    assert.equal(paid.latePaymentDetected, true);
    assert.equal(paid.latePaymentAccepted, true);
    assert.equal(getLiveCheckout(checkout.id).paymentProviderTransactionId, "TX-LATE");
    assert.equal(getLiveSession(live.id).products[0].stock, 0);
  } finally {
    __resetLiveStoreForTests();
    __resetLiveActionsStoreForTests();
  }
});

test("late paid checkout never oversells stock now reserved by another buyer", async () => {
  const { live } = setup(1);
  try {
    const checkout = pendingCheckout(live);
    await reconcileLiveCheckoutReservation(checkout, {
      now: Date.parse("2026-09-23T00:21:00.000Z"),
      resolveProvider: async () => ({ provider: "sumup", status: "pending", providerStatus: "PENDING" })
    });
    pendingCheckout(live, {
      id: "LCK-NEW-BUYER",
      idempotencyKey: "new-buyer-key",
      customerId: "client-b",
      customerEmail: "b@cardoria.invalid",
      paymentProviderOrderId: "SUMUP-2",
      reservationStartedAt: new Date().toISOString(),
      reservationExpiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString()
    });
    const late = applyLivePaymentStatus(checkout.id, "paid", { paymentProviderTransactionId: "TX-LATE" });
    assert.equal(late.status, "reconciliation_required");
    assert.equal(late.paymentObservedStatus, "paid");
    assert.equal(late.latePaymentDetected, true);
    assert.equal(late.stockReconcileRequired, true);
    assert.match(late.paymentReconciliationReason, /stock_unavailable/);
    assert.equal(getLiveSession(live.id).products[0].stock, 1);
  } finally {
    __resetLiveStoreForTests();
    __resetLiveActionsStoreForTests();
  }
});

test("provider-confirmed paid stale checkout settles instead of expiring", async () => {
  const { live } = setup(1);
  try {
    const checkout = pendingCheckout(live);
    const result = await reconcileLiveCheckoutReservation(checkout, {
      now: Date.parse("2026-09-23T00:21:00.000Z"),
      resolveProvider: async () => ({ provider: "sumup", status: "paid", providerStatus: "PAID", transactionId: "TX-PAID" })
    });
    assert.equal(result.settled, true);
    assert.equal(getLiveCheckout(checkout.id).status, "paid");
    assert.equal(getLiveSession(live.id).products[0].stock, 0);
  } finally {
    __resetLiveStoreForTests();
    __resetLiveActionsStoreForTests();
  }
});
