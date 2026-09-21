import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cardoria-boutique-stock-"));
process.env.CARDORIA_DATA_DIR = dataDir;
delete process.env.SUMUP_API_KEY;
delete process.env.SUMUP_MERCHANT_CODE;

const { writeJson, readJson } = await import("../backend/lib/storage.js");
const { createLiveBoutiqueCheckout, validateBoutiqueItems } = await import("../backend/lib/boutique/checkout.js");
const {
  listBoutiqueProducts,
  listBoutiqueInventory,
  boutiqueStockImpact,
  boutiqueAvailability,
  sanitizeStockPreference,
  applyStockPrefsToNotes,
  LOW_STOCK_THRESHOLD,
  MAX_STOCK_BASE,
  PENDING_RESERVATION_MS
} = await import("../backend/lib/boutique/stock.js");
const { applyBoutiquePayment, sumupCheckoutMatchesOrder } = await import("../backend/lib/payments/sumup.js");
const { publicClientOrder } = await import("../backend/lib/boutique/shipping.js");
const { checkoutRequestFingerprint } = await import("../backend/lib/boutique/checkout-idempotency.js");

const PRODUCT_ID = "purchase:P-STOCK-1:sealed";
const pickup = {
  id: "012345",
  name: "Tabac du Centre",
  address: "10 rue des Arts",
  postalCode: "59300",
  city: "Valenciennes"
};

function purchaseNotes(price = 10, base = 1, removed = false, boutique = true) {
  return '[STOCK_PREFS] ' + JSON.stringify({
    [PRODUCT_ID]: {
      boutique,
      boutiquePrice: price,
      stockBase: base,
      shippingWeightGrams: 80,
      removed
    }
  });
}

function seed({ stock = 1, price = 10, removed = false, boutique = true, orders = [] } = {}) {
  writeJson("purchases", [{
    id: "P-STOCK-1",
    status: "paid",
    license: "pokemon",
    category: "boosters",
    packaging: "booster",
    description: "Booster Test Integrity",
    quantity: Math.max(1, stock),
    amount: price * Math.max(1, stock),
    date: "2026-01-01",
    notes: purchaseNotes(price, stock, removed, boutique)
  }]);
  writeJson("orders", orders);
}

function checkoutPayload(email, qty = 1, extra = {}) {
  return {
    customerName: "Client Test",
    customerEmail: email,
    customerPhone: "0600000000",
    shippingMethod: "mondial_relay",
    pickupPoint: pickup,
    items: [{ ref: PRODUCT_ID, qty }],
    ...extra
  };
}

async function fakePay({ orderId, amount }) {
  return {
    checkoutId: "chk-" + orderId,
    sessionId: "chk-" + orderId,
    providerOrderId: "chk-" + orderId,
    url: "https://example.test/sumup/" + encodeURIComponent(orderId),
    status: "pending",
    paymentId: "pay-" + orderId,
    environment: "test",
    amount
  };
}

function availableStock() {
  const product = listBoutiqueProducts({ includeDisabled: true }).find((item) => item.id === PRODUCT_ID);
  return Number(product?.stock || 0);
}

test("source of truth is derived from paid purchases minus pending, sold and refund holds", () => {
  seed({ stock: 5 });
  assert.equal(availableStock(), 5);
  const inventory = listBoutiqueInventory({ includeDisabled: true }).find((item) => item.id === PRODUCT_ID);
  assert.equal(inventory.effectiveBaseStock, 5);
  assert.equal(inventory.soldStock, 0);
  const checkout = fs.readFileSync("backend/lib/boutique/checkout.js", "utf8");
  assert.match(checkout, /withBoutiqueOrderLock/);
  assert.match(checkout, /listBoutiqueProducts/);
  assert.doesNotMatch(fs.readFileSync("backend/lib/payments/sumup.js", "utf8"), /paid=1.*paymentStatus = "paid"/);
});

test("stock 0 cannot be added and quantity above stock is rejected", () => {
  seed({ stock: 0 });
  assert.throws(() => validateBoutiqueItems([{ ref: PRODUCT_ID, qty: 1 }]), (error) => error.code === "STOCK_INSUFFICIENT" || error.status === 409);
  seed({ stock: 1 });
  assert.throws(() => validateBoutiqueItems([{ ref: PRODUCT_ID, qty: 2 }]), (error) => error.code === "STOCK_INSUFFICIENT");
  assert.throws(() => validateBoutiqueItems([{ ref: PRODUCT_ID, qty: 0 }]), (error) => error.code === "QTY_INVALID");
  assert.throws(() => validateBoutiqueItems([{ ref: PRODUCT_ID, qty: -1 }]), (error) => error.code === "QTY_INVALID");
  assert.throws(() => validateBoutiqueItems([{ ref: "missing-product", qty: 1 }]), (error) => error.code === "PRODUCT_UNAVAILABLE" || error.code === "PRODUCT_ID_INVALID");
  assert.throws(() => validateBoutiqueItems([{ ref: "", qty: 1 }]), (error) => error.code === "PRODUCT_ID_INVALID");
});

test("frontend price and shipping amounts cannot be forged", async () => {
  seed({ stock: 2 });
  await assert.rejects(
    () => createLiveBoutiqueCheckout({ ...checkoutPayload("forge-price@example.test"), requestedAmount: 1 }, { createPaymentSession: fakePay }),
    (error) => error.status === 403
  );
  await assert.rejects(
    () => createLiveBoutiqueCheckout({ ...checkoutPayload("forge-ship@example.test"), requestedShippingCost: 5.99 }, { createPaymentSession: fakePay }),
    (error) => error.status === 403 && error.code === "SHIPPING_FORGED"
  );
  const ok = await createLiveBoutiqueCheckout({
    ...checkoutPayload("ok-price@example.test"),
    requestedAmount: 10,
    requestedShippingCost: 0
  }, { createPaymentSession: fakePay });
  assert.equal(ok.order.total, 10);
  assert.equal(ok.order.shippingCost, 0);
  assert.equal(ok.order.items[0].price, 10);
});

test("two simultaneous checkouts cannot consume the last unit twice", async () => {
  seed({ stock: 1 });
  const results = await Promise.allSettled([
    createLiveBoutiqueCheckout(checkoutPayload("buyer-a@example.test"), { createPaymentSession: fakePay }),
    createLiveBoutiqueCheckout(checkoutPayload("buyer-b@example.test"), { createPaymentSession: fakePay })
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "STOCK_INSUFFICIENT");
  assert.equal(availableStock(), 0);
  const pending = readJson("orders", []).filter((order) => order.paymentStatus === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].items[0].qty, 1);
});

test("double payment confirmation and double decrement are no-ops", async () => {
  seed({ stock: 1 });
  const created = await createLiveBoutiqueCheckout(checkoutPayload("paid-once@example.test"), { createPaymentSession: fakePay });
  const first = await applyBoutiquePayment(created.order.id, "paid", { checkoutId: created.checkoutId, transactionId: "tx-1" });
  assert.equal(first.paymentStatus, "paid");
  assert.equal(availableStock(), 0);
  const second = await applyBoutiquePayment(created.order.id, "paid", { checkoutId: created.checkoutId, transactionId: "tx-1" });
  assert.equal(second.alreadyPaid, true);
  const inventory = listBoutiqueInventory({ includeDisabled: true }).find((item) => item.id === PRODUCT_ID);
  assert.equal(inventory.soldStock, 1);
  assert.equal(inventory.stock, 0);
  assert.ok(inventory.stock >= 0);
});

test("failed payment does not decrement stock or mark the order paid", async () => {
  seed({ stock: 1 });
  const created = await createLiveBoutiqueCheckout(checkoutPayload("fail@example.test"), { createPaymentSession: fakePay });
  assert.equal(availableStock(), 0);
  const failed = await applyBoutiquePayment(created.order.id, "failed", { checkoutId: created.checkoutId });
  assert.equal(failed.paymentStatus, "failed");
  assert.equal(failed.status, "Paiement échoué");
  assert.equal(availableStock(), 1);
  assert.equal(boutiqueStockImpact(failed).code, "released");
});

test("unpaid cancellation releases stock once, paid cancellation holds until refunded", async () => {
  seed({ stock: 5 });
  const created = await createLiveBoutiqueCheckout(checkoutPayload("hold@example.test", 2), { createPaymentSession: fakePay });
  assert.equal(availableStock(), 3);
  await applyBoutiquePayment(created.order.id, "paid", { checkoutId: created.checkoutId, transactionId: "tx-hold" });
  assert.equal(availableStock(), 3);
  writeJson("orders", readJson("orders", []).map((order) => (
    order.id === created.order.id ? { ...order, status: "Annulée", paymentReviewRequired: true } : order
  )));
  assert.equal(availableStock(), 3);
  assert.equal(boutiqueStockImpact(readJson("orders", [])[0]).code, "hold");
  await applyBoutiquePayment(created.order.id, "refunded", { checkoutId: created.checkoutId, transactionId: "tx-hold" });
  assert.equal(availableStock(), 5);
  const refunded = readJson("orders", []).find((order) => order.id === created.order.id);
  assert.equal(refunded.status, "Remboursée");
  assert.equal(boutiqueStockImpact(refunded).code, "released");
  await applyBoutiquePayment(created.order.id, "refunded", { checkoutId: created.checkoutId, transactionId: "tx-hold" });
  assert.equal(availableStock(), 5);

  seed({ stock: 1 });
  const pending = await createLiveBoutiqueCheckout(checkoutPayload("cancel-pending@example.test"), { createPaymentSession: fakePay });
  writeJson("orders", readJson("orders", []).map((order) => (
    order.id === pending.order.id ? { ...order, status: "Annulée", paymentStatus: "cancelled" } : order
  )));
  assert.equal(availableStock(), 1);
});

test("paid order keeps snapshot price after catalog change and remains readable if product is removed", async () => {
  seed({ stock: 2, price: 10 });
  const created = await createLiveBoutiqueCheckout(checkoutPayload("snapshot@example.test"), { createPaymentSession: fakePay });
  await applyBoutiquePayment(created.order.id, "paid", { checkoutId: created.checkoutId, transactionId: "tx-snap" });
  assert.equal(created.order.items[0].price, 10);

  seed({
    stock: 2,
    price: 15,
    orders: readJson("orders", [])
  });
  assert.equal(listBoutiqueProducts({ includeDisabled: false }).find((item) => item.id === PRODUCT_ID).price, 15);
  const stored = readJson("orders", []).find((order) => order.id === created.order.id);
  assert.equal(stored.items[0].price, 10);
  assert.equal(stored.total, 10);
  const exposed = publicClientOrder(stored);
  assert.equal(exposed.items[0].price, 10);
  assert.equal(exposed.total, 10);

  seed({
    stock: 2,
    price: 15,
    removed: true,
    orders: [stored]
  });
  assert.equal(listBoutiqueProducts({ includeDisabled: false }).find((item) => item.id === PRODUCT_ID), undefined);
  const afterDelete = publicClientOrder(readJson("orders", [])[0]);
  assert.equal(afterDelete.items.length, 1);
  assert.equal(afterDelete.items[0].name, "Booster Test Integrity");
  assert.equal(afterDelete.items[0].price, 10);
});

test("SumUp amount, currency and checkout reference must match the order", () => {
  const order = { id: "CMD-1", total: 10 };
  assert.equal(sumupCheckoutMatchesOrder({ amount: 10, currency: "EUR", checkout_reference: "CMD-1" }, order).ok, true);
  assert.equal(sumupCheckoutMatchesOrder({ amount: 1, currency: "EUR", checkout_reference: "CMD-1" }, order).ok, false);
  assert.equal(sumupCheckoutMatchesOrder({ amount: 10, currency: "USD", checkout_reference: "CMD-1" }, order).ok, false);
  assert.equal(sumupCheckoutMatchesOrder({ amount: 10, currency: "EUR", checkout_reference: "CMD-OTHER" }, order).ok, false);
});

test("same SumUp transaction cannot pay a second boutique order", async () => {
  seed({ stock: 2 });
  const first = await createLiveBoutiqueCheckout(checkoutPayload("tx-a@example.test"), { createPaymentSession: fakePay });
  const second = await createLiveBoutiqueCheckout(checkoutPayload("tx-b@example.test"), { createPaymentSession: fakePay });
  await applyBoutiquePayment(first.order.id, "paid", { checkoutId: first.checkoutId, transactionId: "shared-tx" });
  const reused = await applyBoutiquePayment(second.order.id, "paid", { checkoutId: second.checkoutId, transactionId: "shared-tx" });
  assert.equal(reused.reusedTransaction, true);
  assert.notEqual(reused.paymentStatus, "paid");
  const sold = listBoutiqueInventory({ includeDisabled: true }).find((item) => item.id === PRODUCT_ID).soldStock;
  assert.equal(sold, 1);
});

test("client order payload stays a snapshot and hides internals", () => {
  const exposed = publicClientOrder({
    id: "CMD-SECRET",
    email: "owner@example.test",
    items: [{ ref: PRODUCT_ID, name: "Booster Test Integrity", qty: 1, price: 10, condition: "Scellé" }],
    total: 10,
    paymentStatus: "paid",
    status: "À préparer",
    address: "SECRET-ADDRESS",
    phone: "SECRET-PHONE",
    internalNote: "SECRET-NOTE",
    sumupCheckoutId: "SECRET-SUMUP",
    idempotencyKey: "SECRET-KEY"
  });
  const json = JSON.stringify(exposed);
  assert.equal(exposed.items[0].price, 10);
  assert.equal(json.includes("SECRET-"), false);
  assert.equal("idempotencyKey" in exposed, false);
  const auth = fs.readFileSync("backend/routes/auth.js", "utf8");
  const start = auth.indexOf('router.get("/orders"');
  const end = auth.indexOf('router.post("/password/request"', start);
  const handler = auth.slice(start, end);
  assert.match(handler, /normalizedEmail\(order\?\.email\) === email/);
  assert.match(handler, /if \(user\.role !== "client"\) return res\.status\(403\)/);
});

test("cart, admin stock alerts and Colissimo gate stay in place", () => {
  const boutique = fs.readFileSync("js/boutique.js", "utf8");
  const adminStock = fs.readFileSync("js/admin/admin-stock.js", "utf8");
  const adminOrders = fs.readFileSync("js/admin/admin-orders.js", "utf8");
  const envExample = fs.readFileSync("backend/.env.example", "utf8");
  assert.match(boutique, /La quantité disponible pour /);
  assert.match(boutique, /Plus que /);
  assert.match(boutique, /Rupture de stock/);
  assert.match(boutique, /disabled/);
  assert.match(boutique, /shippingCost: 0/);
  assert.match(adminStock, /Produits en rupture/);
  assert.match(adminStock, /Stock faible/);
  assert.match(adminStock, /Retiré de la Boutique/);
  assert.match(adminStock, /Stock bloqué — remboursement en attente/);
  assert.match(adminOrders, /stockImpact/);
  assert.match(fs.readFileSync("backend/routes/payments-admin.js", "utf8"), /COLISSIMO_LABEL_IN_PROGRESS/);
  assert.match(envExample, /COLISSIMO_LIVE_LABELS_ENABLED=false/);
});

test("A. stockBase 0 stays 0 and is never coerced to 1", () => {
  seed({ stock: 0 });
  const inventory = listBoutiqueInventory({ includeDisabled: true }).find((item) => item.id === PRODUCT_ID);
  assert.equal(inventory.stock, 0);
  assert.equal(inventory.effectiveBaseStock, 0);
  assert.equal(inventory.availability, "out");
  assert.equal(inventory.availabilityLabel, "Rupture de stock");
  assert.equal(inventory.purchasable, false);
});

test("C/D. removed or Boutique-disabled products cannot be bought", () => {
  seed({ stock: 3, removed: true });
  assert.throws(() => validateBoutiqueItems([{ ref: PRODUCT_ID, qty: 1 }]), (error) => error.code === "PRODUCT_UNAVAILABLE" || error.status === 400);
  seed({ stock: 3, boutique: false });
  assert.equal(listBoutiqueProducts({ includeDisabled: false }).find((item) => item.id === PRODUCT_ID), undefined);
  assert.throws(() => validateBoutiqueItems([{ ref: PRODUCT_ID, qty: 1 }]), (error) => error.code === "PRODUCT_UNAVAILABLE" || error.status === 400);
});

test("E/F. pending checkout reserves only while younger than 30 minutes", () => {
  const item = { ref: PRODUCT_ID, qty: 2, price: 10, name: "Booster Test Integrity" };
  seed({
    stock: 5,
    orders: [{
      id: "CMD-FRESH",
      paymentStatus: "pending",
      status: "En attente SumUp",
      createdAt: new Date().toISOString(),
      items: [item]
    }]
  });
  assert.equal(availableStock(), 3);
  assert.equal(listBoutiqueInventory({ includeDisabled: true }).find((row) => row.id === PRODUCT_ID).pendingStock, 2);

  seed({
    stock: 5,
    orders: [{
      id: "CMD-STALE",
      paymentStatus: "pending",
      status: "En attente SumUp",
      createdAt: new Date(Date.now() - PENDING_RESERVATION_MS - 1000).toISOString(),
      items: [item]
    }]
  });
  assert.equal(availableStock(), 5);
  assert.equal(listBoutiqueInventory({ includeDisabled: true }).find((row) => row.id === PRODUCT_ID).pendingStock, 0);
});

test("K. identical double checkout does not reserve stock twice", async () => {
  seed({ stock: 5 });
  const payload = checkoutPayload("same-cart@example.test", 2);
  const [first, second] = await Promise.all([
    createLiveBoutiqueCheckout(payload, { createPaymentSession: fakePay }),
    createLiveBoutiqueCheckout(payload, { createPaymentSession: fakePay })
  ]);
  assert.equal(first.order.id, second.order.id);
  assert.equal(first.checkoutId, second.checkoutId);
  assert.equal(readJson("orders", []).filter((order) => order.paymentStatus === "pending").length, 1);
  assert.equal(availableStock(), 3);
});

test("K. checkout already creating without SumUp id does not open a second reservation", async () => {
  seed({ stock: 5 });
  const payload = checkoutPayload("creating@example.test", 2);
  const requestKey = checkoutRequestFingerprint({
    email: payload.customerEmail,
    items: payload.items,
    shippingMethod: payload.shippingMethod,
    pickupId: payload.pickupPoint.id
  });
  writeJson("orders", [{
    id: "CMD-CREATING",
    checkoutRequestKey: requestKey,
    paymentStatus: "pending",
    status: "En attente SumUp",
    createdAt: new Date().toISOString(),
    checkoutCreationStartedAt: new Date().toISOString(),
    items: [{ ref: PRODUCT_ID, qty: 2, price: 10, name: "Booster Test Integrity" }],
    email: payload.customerEmail,
    shippingMethod: "mondial_relay",
    pickupPoint: pickup,
    total: 20,
    sumupCheckoutId: ""
  }]);
  assert.equal(availableStock(), 3);
  await assert.rejects(
    () => createLiveBoutiqueCheckout(payload, { createPaymentSession: fakePay }),
    (error) => error.code === "BOUTIQUE_CHECKOUT_IN_PROGRESS" && error.status === 409
  );
  assert.equal(readJson("orders", []).length, 1);
  assert.equal(availableStock(), 3);
});

test("M. manual STOCK_PREFS reject negative, decimal and non-integer quantities", () => {
  assert.throws(() => sanitizeStockPreference({ stockBase: -1 }), (error) => error.code === "STOCK_PREFS_INVALID");
  assert.throws(() => sanitizeStockPreference({ stockBase: 2.5 }), (error) => error.code === "STOCK_PREFS_INVALID");
  assert.throws(() => sanitizeStockPreference({ stockBase: "abc" }), (error) => error.code === "STOCK_PREFS_INVALID");
  assert.throws(() => sanitizeStockPreference({ stockBase: MAX_STOCK_BASE + 1 }), (error) => error.code === "STOCK_PREFS_INVALID");
  const ok = sanitizeStockPreference({ stockBase: 14, boutique: true, boutiquePrice: 12.5, shippingWeightGrams: 80 });
  assert.equal(ok.stockBase, 14);
  assert.equal(ok.boutiquePrice, 12.5);
  const notes = applyStockPrefsToNotes("[RACHAT] keep-me", purchaseNotes(10, 14));
  assert.match(notes, /\[RACHAT\] keep-me/);
  assert.match(notes, /\[STOCK_PREFS\]/);
});

test("N/O. oversold products are not purchasable and low stock uses the shared threshold", () => {
  seed({
    stock: 1,
    orders: [{
      id: "CMD-OVER",
      paymentStatus: "paid",
      status: "À préparer",
      createdAt: new Date().toISOString(),
      items: [{ ref: PRODUCT_ID, qty: 2, price: 10, name: "Booster Test Integrity" }]
    }]
  });
  const oversold = listBoutiqueInventory({ includeDisabled: true }).find((item) => item.id === PRODUCT_ID);
  assert.equal(oversold.oversoldStock, 1);
  assert.equal(oversold.stock, 0);
  assert.equal(oversold.purchasable, false);
  assert.equal(oversold.inventoryStatus, "oversold");
  assert.equal(oversold.availabilityLabel, "Rupture de stock");
  assert.throws(() => validateBoutiqueItems([{ ref: PRODUCT_ID, qty: 1 }]), (error) => error.code === "STOCK_INSUFFICIENT" || error.status === 409);

  seed({ stock: 2 });
  const low = listBoutiqueInventory({ includeDisabled: true }).find((item) => item.id === PRODUCT_ID);
  assert.equal(LOW_STOCK_THRESHOLD, 2);
  assert.equal(low.inventoryStatus, "low_stock");
  assert.equal(low.alertBucket, "low");
  assert.equal(boutiqueAvailability(low).label, "Plus que 2 en stock");
  seed({ stock: 3 });
  assert.equal(boutiqueAvailability(listBoutiqueInventory({ includeDisabled: true }).find((item) => item.id === PRODUCT_ID)).label, "En stock");
});

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
