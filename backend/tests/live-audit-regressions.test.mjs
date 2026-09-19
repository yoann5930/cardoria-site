import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

test("independent audit: real route ownership, verified payment events and corrupt storage", async t => {
  assert.equal(process.env.NODE_ENV, "test");
  const cwd = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "cardoria-audit-regression-")); process.chdir(dir);
  const nativeFetch = globalThis.fetch, oldPublic = process.env.SENDCLOUD_PUBLIC_KEY, oldSecret = process.env.SENDCLOUD_SECRET_KEY;
  let server, db; const userIds = [], sellerIds = [];
  try {
    const { migrateAuth } = await import("../lib/auth/migrate.js"); migrateAuth();
    const { migrateMarketplace } = await import("../lib/marketplace/migrate.js"); migrateMarketplace();
    const { migrateMarketplaceV1 } = await import("../lib/marketplace/v1/migrate.js"); migrateMarketplaceV1();
    const { migratePayments } = await import("../lib/payments/migrate.js"); migratePayments();
    const { getDb } = await import("../lib/engine/database.js"); db = getDb();
    const { createUser } = await import("../lib/auth/users.js");
    const { createSession } = await import("../lib/auth/session.js");
    const { registerSeller, updateSellerPayPal } = await import("../lib/marketplace/sellers.js");
    const storage = await import("../lib/storage.js"), sessions = await import("../lib/live/sessions.js");
    const events = await import("../lib/marketplace/paypal-events.js");
    const { validateCompletedLiveCapture } = await import("../lib/live/paypal-capture-validation.js");
    function account(name, isSeller) {
      const user = createUser({ email: `${name}-${crypto.randomUUID()}@cardoria.invalid`, password: "Local-test-only-pass-123!", role: "client", name });
      userIds.push(user.id);
      const seller = isSeller ? registerSeller({ email: user.email, displayName: name, sellerType: "individual", authUserId: user.id }) : null;
      if (seller) { sellerIds.push(seller.id); updateSellerPayPal(seller.id, { merchantId: "MERCHANT-" + seller.id }); }
      return { user, seller, token: createSession(user.id).token };
    }
    const a = account("A", true), b = account("B", true), c = account("Client", false);
    const capture = () => ({ id: "CAPTURE-1", status: "COMPLETED", amount: { value: "25.00", currency_code: "EUR" }, supplementary_data: { related_ids: { order_id: "PAYPAL-1" } }, custom_id: "LCK-1", payee: { merchant_id: "MERCHANT-" + a.seller.id } });
    function setupPayment() {
      const checkout = { id: "LCK-1", liveId: "LIVE-1", ownerId: a.seller.id, ownerRole: "seller", provider: "paypal", productId: "P1", qty: 1, status: "pending", amount: 25, paymentProviderOrderId: "PAYPAL-1" };
      sessions.__setLiveStoreForTests({ sessions: [{ id: "LIVE-1", status: "live", ownerRole: "seller", ownerId: a.seller.id, products: [{ id: "P1", stock: 3 }] }], checkouts: [checkout], adminAccess: [] });
      return checkout;
    }
    events.__setPayPalWebhookVerifyForTests(() => true);
    await t.test("completed capture webhook turns a pending live payment paid exactly once", async () => {
      setupPayment();
      const event = { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: capture() };
      await events.handlePayPalWebhook({}, event); await events.handlePayPalWebhook({}, event);
      assert.equal(sessions.getLiveCheckout("LCK-1").status, "paid"); assert.equal(sessions.getLiveSession("LIVE-1").products[0].stock, 2);
    });
    await t.test("wrong amount, currency, capture id, order or payee never validates payment", () => {
      const checkout = setupPayment();
      for (const patch of [{ amount: { value: "24.99", currency_code: "EUR" } }, { amount: { value: "25.00", currency_code: "USD" } }, { status: "PENDING" }, { id: "" }, { custom_id: "OTHER" }, { supplementary_data: { related_ids: { order_id: "OTHER" } } }, { payee: { merchant_id: "FOREIGN" } }]) {
        assert.throws(() => validateCompletedLiveCapture(checkout, { ...capture(), ...patch }, { merchantId: "MERCHANT-" + a.seller.id }), { code: "LIVE_PAYPAL_CAPTURE_MISMATCH" });
      }
      assert.equal(sessions.getLiveCheckout("LCK-1").status, "pending");
    });
    await t.test("invalid signature is refused before a completed capture is applied", async () => {
      setupPayment(); events.__setPayPalWebhookVerifyForTests(() => false);
      await assert.rejects(events.handlePayPalWebhook({}, { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: capture() }));
      assert.equal(sessions.getLiveCheckout("LCK-1").status, "pending"); events.__setPayPalWebhookVerifyForTests(() => true);
    });
    await t.test("refund uses related capture id, not refund id; stale capture cannot revive it", async () => {
      setupPayment(); await events.handlePayPalWebhook({}, { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: capture() });
      const refund = { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REFUND-1", status: "COMPLETED", amount: { value: "25.00", currency_code: "EUR" }, supplementary_data: { related_ids: { capture_id: "CAPTURE-1" } } } };
      await events.handlePayPalWebhook({}, refund); await events.handlePayPalWebhook({}, refund);
      await events.handlePayPalWebhook({}, { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: capture() });
      const checkout = sessions.getLiveCheckout("LCK-1"); assert.equal(checkout.status, "refunded"); assert.equal(checkout.paypalRefundEvents.length, 1); assert.equal(sessions.getLiveSession("LIVE-1").products[0].stock, 2);
      sessions.applyLivePaymentStatus("LCK-1", "pending"); assert.equal(sessions.getLiveCheckout("LCK-1").status, "refunded");
    });
    await t.test("partial refund is blocked for reconciliation rather than guessing item/postage allocation", async () => {
      setupPayment(); await events.handlePayPalWebhook({}, { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: capture() });
      const result = await events.handlePayPalWebhook({}, { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REFUND-PARTIAL", status: "COMPLETED", amount: { value: "2.00", currency_code: "EUR" }, links: [{ href: "https://api.paypal.com/v2/payments/captures/CAPTURE-1" }] } });
      assert.equal(result.live.reconciliationRequired, true); assert.equal(sessions.getLiveCheckout("LCK-1").status, "refund_reconciliation_required");
      const { UNSETTLED_LIVE_PAYMENT_STATUSES } = await import("../lib/live/checkout-lifecycle.js"); assert.ok(UNSETTLED_LIVE_PAYMENT_STATUSES.has("refund_reconciliation_required"));
    });
    await t.test("critical JSON corruption fails closed without erasing shipment history", () => {
      for (const key of ["live-shipments", "live-sessions.json", "live-actions.json", "seller-subscriptions"]) {
        storage.writeJson(key, []); const file = path.join(storage.DATA_DIR, key.endsWith(".json") ? key : key + ".json"); fs.writeFileSync(file, "{corrupt");
        assert.throws(() => storage.readJson(key, []), { code: "LIVE_STORAGE_CORRUPT" }); assert.equal(fs.readFileSync(file, "utf8"), "{corrupt"); storage.writeJson(key, []);
      }
    });
    await t.test("backup includes all giveaway award history", () => {
      storage.writeJson("live-actions.json", { states: { live: { giveawayAwards: [{ giveawayId: "G1" }] } } });
      const backup = storage.backupAll(); assert.ok(fs.existsSync(path.join(backup.path, "live-actions.json")));
      assert.equal(JSON.parse(fs.readFileSync(path.join(backup.path, "live-actions.json"))).states.live.giveawayAwards[0].giveawayId, "G1");
    });
    const { default: express } = await import("express"); const { default: router } = await import("../routes/live-labels.js");
    const app = express(); app.use("/api/live", router); server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    storage.writeJson("live-shipments", [{ id: "LSH-A", sellerId: a.seller.id, sendcloudParcelId: "999", labelUrl: "https://evil.invalid/steal" }]);
    process.env.SENDCLOUD_PUBLIC_KEY = "fake-test-key"; process.env.SENDCLOUD_SECRET_KEY = "fake-test-secret";
    let carrierCalls = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://panel.sendcloud.sc/")) { carrierCalls++; assert.equal(url, "https://panel.sendcloud.sc/api/v3/parcels/999/documents/label?dpi=72"); return new Response("%PDF-1.4\nTEST FIXTURE ONLY", { headers: { "Content-Type": "application/pdf" } }); }
      return nativeFetch(url, init);
    };
    await t.test("anonymous, non-seller and foreign seller cannot download another seller's label", async () => {
      for (const [token, status] of [["", 401], [c.token, 403], [b.token, 404]]) {
        const response = await nativeFetch(base + "/api/live/seller/shipments/LSH-A/label", { headers: token ? { Authorization: "Bearer " + token } : {} }); assert.equal(response.status, status);
      }
      assert.equal(carrierCalls, 0);
    });
    await t.test("owner downloads protected PDF via Cardoria without exposing carrier credentials", async () => {
      const response = await nativeFetch(base + "/api/live/seller/shipments/LSH-A/label", { headers: { Authorization: "Bearer " + a.token } });
      assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/pdf"); assert.match(response.headers.get("cache-control"), /no-store/); assert.match(await response.text(), /^%PDF-/); assert.equal(carrierCalls, 1);
    });
  } finally {
    globalThis.fetch = nativeFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) { for (const id of sellerIds) db.prepare("DELETE FROM mk_sellers WHERE id=?").run(id); for (const id of userIds) { db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(id); db.prepare("DELETE FROM auth_users WHERE id=?").run(id); } }
    if (oldPublic === undefined) delete process.env.SENDCLOUD_PUBLIC_KEY; else process.env.SENDCLOUD_PUBLIC_KEY = oldPublic;
    if (oldSecret === undefined) delete process.env.SENDCLOUD_SECRET_KEY; else process.env.SENDCLOUD_SECRET_KEY = oldSecret;
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
  }
});
