import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  checkoutCreationIsFresh,
  checkoutRequestFingerprint,
  findRecentPendingCheckout,
  normalizeCheckoutRequestItems,
  withCheckoutRequestLock
} from "../lib/boutique/checkout-idempotency.js";

function tempLockRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cardoria-checkout-lock-"));
}

test("request fingerprint is stable for duplicate item lines and item order", () => {
  const a = checkoutRequestFingerprint({
    email: "client@example.com",
    shippingMethod: "colissimo_home",
    items: [{ ref: "B", qty: 1 }, { ref: "A", qty: 1 }, { ref: "A", qty: 1 }]
  });
  const b = checkoutRequestFingerprint({
    email: "CLIENT@example.com",
    shippingMethod: "colissimo_home",
    items: [{ ref: "A", qty: 2 }, { ref: "B", qty: 1 }]
  });
  assert.equal(a, b);
  assert.deepEqual(normalizeCheckoutRequestItems([{ ref: "A", qty: 1 }, { id: "A", qty: 2 }]), [{ ref: "A", qty: 3 }]);
});

test("recent pending order is reusable even before a SumUp checkout id exists", () => {
  const now = Date.now();
  const order = {
    id: "CMD-1",
    email: "client@example.com",
    items: [{ ref: "A", qty: 1 }],
    shippingMethod: "colissimo_home",
    paymentStatus: "pending",
    createdAt: new Date(now - 1000).toISOString()
  };
  const key = checkoutRequestFingerprint({ email: order.email, items: order.items, shippingMethod: order.shippingMethod });
  assert.equal(findRecentPendingCheckout([order], key, now)?.id, "CMD-1");
});

test("paid, failed and expired orders are never reused", () => {
  const now = Date.now();
  const base = {
    email: "client@example.com",
    items: [{ ref: "A", qty: 1 }],
    shippingMethod: "colissimo_home"
  };
  const key = checkoutRequestFingerprint(base);
  assert.equal(findRecentPendingCheckout([{ ...base, paymentStatus: "paid", createdAt: new Date(now - 1000).toISOString() }], key, now), null);
  assert.equal(findRecentPendingCheckout([{ ...base, paymentStatus: "failed", createdAt: new Date(now - 1000).toISOString() }], key, now), null);
  assert.equal(findRecentPendingCheckout([{ ...base, paymentStatus: "pending", createdAt: new Date(now - 31 * 60 * 1000).toISOString() }], key, now), null);
});

test("two simultaneous identical checkout requests execute the critical section once", async () => {
  const lockRoot = tempLockRoot();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const work = async () => {
    calls += 1;
    await gate;
    return { orderId: "CMD-1", checkoutId: "SUMUP-1" };
  };
  const first = withCheckoutRequestLock("same-cart", work, { lockRoot });
  const second = withCheckoutRequestLock("same-cart", work, { lockRoot });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, { orderId: "CMD-1", checkoutId: "SUMUP-1" });
  assert.deepEqual(await second, { orderId: "CMD-1", checkoutId: "SUMUP-1" });
  assert.equal(calls, 1);
});

test("lock is released after an error so a later retry can proceed", async () => {
  const lockRoot = tempLockRoot();
  await assert.rejects(
    withCheckoutRequestLock("retry-cart", async () => { throw new Error("boom"); }, { lockRoot }),
    /boom/
  );
  const value = await withCheckoutRequestLock("retry-cart", async () => "ok", { lockRoot });
  assert.equal(value, "ok");
});

test("fresh creation marker blocks unsafe recovery while stale marker can be recovered", () => {
  const now = Date.now();
  assert.equal(checkoutCreationIsFresh({ checkoutCreationStartedAt: new Date(now - 30_000).toISOString() }, now), true);
  assert.equal(checkoutCreationIsFresh({ checkoutCreationStartedAt: new Date(now - 180_000).toISOString() }, now), false);
});

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

function runWorker(moduleUrl, lockRoot, stateFile) {
  const script = `
    import fs from "node:fs";
    import { withCheckoutRequestLock } from ${JSON.stringify(moduleUrl)};
    const lockRoot = process.argv[1];
    const stateFile = process.argv[2];
    await withCheckoutRequestLock("cross-process-cart", async () => {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (!state.orderId) {
        state.created += 1;
        state.orderId = "CMD-ONE";
        fs.writeFileSync(stateFile, JSON.stringify(state), "utf8");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return state.orderId;
    }, { lockRoot, waitMs: 5000, staleMs: 5000 });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, lockRoot, stateFile], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `worker exited ${code}`)));
  });
}

test("inter-process lock serializes the shared order creation critical section", async () => {
  const lockRoot = tempLockRoot();
  const stateFile = path.join(lockRoot, "state.json");
  fs.writeFileSync(stateFile, JSON.stringify({ created: 0, orderId: "" }), "utf8");
  const moduleUrl = pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), "../lib/boutique/checkout-idempotency.js")).href;
  await Promise.all([
    runWorker(moduleUrl, lockRoot, stateFile),
    runWorker(moduleUrl, lockRoot, stateFile)
  ]);
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.created, 1);
  assert.equal(state.orderId, "CMD-ONE");
});
