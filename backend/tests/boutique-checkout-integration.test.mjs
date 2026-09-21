import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, "../lib/boutique/checkout.js"), "utf8");

test("Boutique checkout uses request-level locking before creating an order", () => {
  assert.match(source, /checkoutRequestFingerprint/);
  assert.match(source, /return withCheckoutRequestLock\(requestKey, async \(\) => \{/);
  assert.match(source, /findRecentPendingCheckout\(orders, requestKey\)/);
  assert.match(source, /checkoutRequestKey: requestKey/);
  assert.match(source, /checkoutCreationStatus: "creating"/);
});

test("existing pending order with checkout is reused and unfinished stale order requires reconciliation", () => {
  assert.match(source, /existingCheckoutResponse/);
  assert.match(source, /BOUTIQUE_CHECKOUT_IN_PROGRESS/);
  assert.match(source, /BOUTIQUE_CHECKOUT_RECONCILIATION_REQUIRED/);
  assert.match(source, /checkoutCreationStatus = "reconciliation_required"/);
});

test("stock and server amount validation happen inside the critical section before new order persistence", () => {
  const lockIndex = source.indexOf("return withCheckoutRequestLock(requestKey");
  const persistIndex = source.indexOf("return persistCreatingOrder({");
  const validateIndex = source.indexOf("const verifiedItems = validateBoutiqueItems(requestedItems)");
  assert.ok(lockIndex >= 0 && persistIndex > lockIndex && validateIndex > lockIndex);
  assert.match(source, /orders\.unshift\(order\)/);
  assert.match(source, /withBoutiqueOrderLock/);
});
