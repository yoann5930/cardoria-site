import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { getDb } from "../lib/engine/database.js";
import { createListing, getListing } from "../lib/marketplace/listings.js";
import { createOrder, getOrder, updateOrderStatus } from "../lib/marketplace/orders.js";
import {
  handlePayPalWebhook,
  __resetPayPalWebhookVerifyForTests,
  __setPayPalWebhookVerifyForTests
} from "../lib/marketplace/paypal-events.js";
import { registerSeller } from "../lib/marketplace/sellers.js";
import {
  __resetLiveStoreForTests,
  __setLiveStoreForTests,
  getLiveCheckout
} from "../lib/live/sessions.js";

function signedHeaders() {
  return {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
    "paypal-transmission-id": "3b-transmission",
    "paypal-transmission-sig": "3b-signature",
    "paypal-transmission-time": "2026-09-09T21:00:00Z"
  };
}

function mockSignedVerify(headers) {
  return Boolean(
    headers?.["paypal-auth-algo"]
    && headers?.["paypal-cert-url"]
    && headers?.["paypal-transmission-id"]
    && headers?.["paypal-transmission-sig"]
    && headers?.["paypal-transmission-time"]
  );
}

function attachPaypal(orderId, { paypalOrderId = "", captureId = "" } = {}) {
  getDb().prepare(`
    UPDATE mk_orders
    SET payment_provider='paypal', paypal_order_id=?, paypal_capture_id=?, updated_at=?
    WHERE id=?
  `).run(paypalOrderId, captureId, new Date().toISOString(), orderId);
  return getOrder(orderId);
}

function listingStock(listingId) {
  return Number(getListing(listingId)?.stock || 0);
}

function seedMarketplace(suffix, { stock = 5, qty = 1 } = {}) {
  const seller = registerSeller({
    email: `iso3b-${suffix}@cardoria.test`,
    displayName: "ISO 3B",
    sellerType: "individual",
    authUserId: `usr_3b_${suffix}`
  });
  const listing = createListing({
    sellerId: seller.id,
    title: `Carte 3B ${suffix}`,
    description: "webhook 3B",
    price: 20,
    stock
  });
  const order = createOrder({
    listingId: listing.id,
    buyerEmail: `buyer-3b-${suffix}@cardoria.test`,
    buyerName: "Buyer 3B",
    buyerId: `buyer_3b_${suffix}`,
    qty,
    shippingCarrier: "mondial_relay",
    shippingCost: 4.95,
    shippingAddress: "1 rue ISO"
  });
  return { seller, listing, order, stockAfterCreate: listingStock(listing.id) };
}

function cleanupMarketplace({ seller, listing, order }) {
  const db = getDb();
  if (order?.id) db.prepare("DELETE FROM mk_orders WHERE id=?").run(order.id);
  if (listing?.id) {
    try { db.prepare("DELETE FROM mk_listings_fts WHERE rowid=(SELECT rowid FROM mk_listings WHERE id=?)").run(listing.id); } catch {}
    db.prepare("DELETE FROM mk_listings WHERE id=?").run(listing.id);
  }
  if (seller?.id) db.prepare("DELETE FROM mk_sellers WHERE id=?").run(seller.id);
}

function seedLive({ paypalOrderId, captureId = "", status = "planned" }) {
  __setLiveStoreForTests({
    sessions: [{
      id: "LIVE-3B-SELLER",
      title: "Live 3B",
      ownerRole: "seller",
      ownerId: "SEL-3B",
      status: "live",
      products: [{ id: "LOT-3B", name: "Lot 3B", qty: 1, stock: 3, price: 25, mode: "buy_now" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    checkouts: [{
      id: "LCK-3B-1",
      liveId: "LIVE-3B-SELLER",
      ownerRole: "seller",
      ownerId: "SEL-3B",
      status,
      paymentProviderOrderId: paypalOrderId,
      paymentProviderTransactionId: captureId,
      productId: "LOT-3B",
      qty: 1,
      amount: 25,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }]
  });
  return getLiveCheckout("LCK-3B-1");
}

function captureResource({ captureId, paypalOrderId, customId, status }) {
  return {
    id: captureId,
    status,
    custom_id: customId,
    supplementary_data: { related_ids: { order_id: paypalOrderId } }
  };
}

test("paypal webhook 3B setup", async (t) => {
  const previousWebhookId = process.env.PAYPAL_WEBHOOK_ID;
  process.env.PAYPAL_WEBHOOK_ID = "wh_test_3b";
  __setPayPalWebhookVerifyForTests(mockSignedVerify);
  t.after(() => {
    __resetPayPalWebhookVerifyForTests();
    __resetLiveStoreForTests();
    if (previousWebhookId == null) delete process.env.PAYPAL_WEBHOOK_ID;
    else process.env.PAYPAL_WEBHOOK_ID = previousWebhookId;
  });

  await t.test("A. PAYMENT.CAPTURE.PENDING Marketplace", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ctx = seedMarketplace(suffix);
    try {
      const paypalOrderId = `PP-MK-PEND-${suffix}`;
      const captureId = `CAP-PEND-${suffix}`;
      attachPaypal(ctx.order.id, { paypalOrderId, captureId });
      const first = await handlePayPalWebhook(signedHeaders(), {
        event_type: "PAYMENT.CAPTURE.PENDING",
        resource: captureResource({ captureId, paypalOrderId, customId: ctx.order.id, status: "PENDING" })
      });
      const order = getOrder(ctx.order.id);
      assert.equal(first.received, true);
      assert.equal(order.status, "pending");
      assert.equal(order.paymentStatus, "pending");
      assert.equal(order.paymentMethod, "paypal");
      assert.equal(listingStock(ctx.listing.id), ctx.stockAfterCreate);
    } finally {
      cleanupMarketplace(ctx);
    }
  });

  await t.test("B. duplicate PENDING Marketplace", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ctx = seedMarketplace(suffix);
    try {
      const paypalOrderId = `PP-MK-PEND2-${suffix}`;
      const captureId = `CAP-PEND2-${suffix}`;
      attachPaypal(ctx.order.id, { paypalOrderId, captureId });
      const event = {
        event_type: "PAYMENT.CAPTURE.PENDING",
        resource: captureResource({ captureId, paypalOrderId, customId: ctx.order.id, status: "PENDING" })
      };
      await handlePayPalWebhook(signedHeaders(), event);
      const duplicate = await handlePayPalWebhook(signedHeaders(), event);
      const order = getOrder(ctx.order.id);
      assert.equal(duplicate.marketplace[0].duplicate, true);
      assert.equal(order.status, "pending");
      assert.equal(listingStock(ctx.listing.id), ctx.stockAfterCreate);
    } finally {
      cleanupMarketplace(ctx);
    }
  });

  await t.test("C. PAYMENT.CAPTURE.DENIED Marketplace", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ctx = seedMarketplace(suffix);
    try {
      const paypalOrderId = `PP-MK-DENY-${suffix}`;
      const captureId = `CAP-DENY-${suffix}`;
      attachPaypal(ctx.order.id, { paypalOrderId, captureId });
      await handlePayPalWebhook(signedHeaders(), {
        event_type: "PAYMENT.CAPTURE.DENIED",
        resource: captureResource({ captureId, paypalOrderId, customId: ctx.order.id, status: "DENIED" })
      });
      const order = getOrder(ctx.order.id);
      assert.equal(order.status, "cancelled");
      assert.equal(order.paymentStatus, "failed");
      assert.equal(order.paymentMethod, "paypal");
      assert.equal(listingStock(ctx.listing.id), ctx.stockAfterCreate + ctx.order.qty);
    } finally {
      cleanupMarketplace(ctx);
    }
  });

  await t.test("D. duplicate DENIED Marketplace", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ctx = seedMarketplace(suffix);
    try {
      const paypalOrderId = `PP-MK-DENY2-${suffix}`;
      const captureId = `CAP-DENY2-${suffix}`;
      attachPaypal(ctx.order.id, { paypalOrderId, captureId });
      const event = {
        event_type: "PAYMENT.CAPTURE.DENIED",
        resource: captureResource({ captureId, paypalOrderId, customId: ctx.order.id, status: "DENIED" })
      };
      await handlePayPalWebhook(signedHeaders(), event);
      const stockAfterFirst = listingStock(ctx.listing.id);
      const duplicate = await handlePayPalWebhook(signedHeaders(), event);
      assert.equal(duplicate.marketplace[0].duplicate, true);
      assert.equal(getOrder(ctx.order.id).status, "cancelled");
      assert.equal(listingStock(ctx.listing.id), stockAfterFirst);
    } finally {
      cleanupMarketplace(ctx);
    }
  });

  await t.test("E. CHECKOUT.ORDER.DECLINED Marketplace", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ctx = seedMarketplace(suffix);
    try {
      const paypalOrderId = `PP-MK-DECL-${suffix}`;
      attachPaypal(ctx.order.id, { paypalOrderId });
      await handlePayPalWebhook(signedHeaders(), {
        event_type: "CHECKOUT.ORDER.DECLINED",
        resource: {
          id: paypalOrderId,
          status: "DECLINED",
          purchase_units: [{ reference_id: ctx.order.id, custom_id: ctx.order.id }]
        }
      });
      const order = getOrder(ctx.order.id);
      assert.equal(order.status, "cancelled");
      assert.equal(order.paymentStatus, "failed");
      assert.equal(order.paymentMethod, "paypal");
      assert.equal(listingStock(ctx.listing.id), ctx.stockAfterCreate + ctx.order.qty);
    } finally {
      cleanupMarketplace(ctx);
    }
  });

  await t.test("F. duplicate DECLINED Marketplace", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ctx = seedMarketplace(suffix);
    try {
      const paypalOrderId = `PP-MK-DECL2-${suffix}`;
      attachPaypal(ctx.order.id, { paypalOrderId });
      const event = {
        event_type: "CHECKOUT.ORDER.DECLINED",
        resource: { id: paypalOrderId, status: "DECLINED", purchase_units: [{ custom_id: ctx.order.id }] }
      };
      await handlePayPalWebhook(signedHeaders(), event);
      const stockAfterFirst = listingStock(ctx.listing.id);
      const duplicate = await handlePayPalWebhook(signedHeaders(), event);
      assert.equal(duplicate.marketplace[0].duplicate, true);
      assert.equal(listingStock(ctx.listing.id), stockAfterFirst);
    } finally {
      cleanupMarketplace(ctx);
    }
  });

  await t.test("G. PENDING Live vendeur", async () => {
    const paypalOrderId = `PP-LIVE-PEND-${crypto.randomUUID().slice(0, 8)}`;
    seedLive({ paypalOrderId, status: "planned" });
    try {
      await handlePayPalWebhook(signedHeaders(), {
        event_type: "PAYMENT.CAPTURE.PENDING",
        resource: captureResource({
          captureId: `CAP-LIVE-PEND`,
          paypalOrderId,
          customId: "LCK-3B-1",
          status: "PENDING"
        })
      });
      const checkout = getLiveCheckout("LCK-3B-1");
      assert.equal(checkout.status, "pending");
      assert.notEqual(checkout.status, "paid");
    } finally {
      __resetLiveStoreForTests();
    }
  });

  await t.test("H. duplicate PENDING Live", async () => {
    const paypalOrderId = `PP-LIVE-PEND2-${crypto.randomUUID().slice(0, 8)}`;
    seedLive({ paypalOrderId, status: "planned" });
    try {
      const event = {
        event_type: "PAYMENT.CAPTURE.PENDING",
        resource: captureResource({ captureId: "CAP-LIVE-PEND2", paypalOrderId, customId: "LCK-3B-1", status: "PENDING" })
      };
      await handlePayPalWebhook(signedHeaders(), event);
      const duplicate = await handlePayPalWebhook(signedHeaders(), event);
      assert.equal(duplicate.live.duplicate, true);
      assert.equal(getLiveCheckout("LCK-3B-1").status, "pending");
    } finally {
      __resetLiveStoreForTests();
    }
  });

  await t.test("I. DENIED Live vendeur", async () => {
    const paypalOrderId = `PP-LIVE-DENY-${crypto.randomUUID().slice(0, 8)}`;
    seedLive({ paypalOrderId, captureId: "CAP-LIVE-DENY", status: "pending" });
    try {
      await handlePayPalWebhook(signedHeaders(), {
        event_type: "PAYMENT.CAPTURE.DENIED",
        resource: captureResource({ captureId: "CAP-LIVE-DENY", paypalOrderId, customId: "LCK-3B-1", status: "DENIED" })
      });
      const checkout = getLiveCheckout("LCK-3B-1");
      assert.equal(checkout.status, "failed");
      assert.notEqual(checkout.status, "paid");
    } finally {
      __resetLiveStoreForTests();
    }
  });

  await t.test("J. duplicate DENIED Live", async () => {
    const paypalOrderId = `PP-LIVE-DENY2-${crypto.randomUUID().slice(0, 8)}`;
    seedLive({ paypalOrderId, captureId: "CAP-LIVE-DENY2", status: "pending" });
    try {
      const event = {
        event_type: "PAYMENT.CAPTURE.DENIED",
        resource: captureResource({ captureId: "CAP-LIVE-DENY2", paypalOrderId, customId: "LCK-3B-1", status: "DENIED" })
      };
      await handlePayPalWebhook(signedHeaders(), event);
      const duplicate = await handlePayPalWebhook(signedHeaders(), event);
      assert.equal(duplicate.live.duplicate, true);
      assert.equal(getLiveCheckout("LCK-3B-1").status, "failed");
    } finally {
      __resetLiveStoreForTests();
    }
  });

  await t.test("K. DECLINED Live vendeur", async () => {
    const paypalOrderId = `PP-LIVE-DECL-${crypto.randomUUID().slice(0, 8)}`;
    seedLive({ paypalOrderId, status: "pending" });
    try {
      await handlePayPalWebhook(signedHeaders(), {
        event_type: "CHECKOUT.ORDER.DECLINED",
        resource: { id: paypalOrderId, status: "DECLINED" }
      });
      const checkout = getLiveCheckout("LCK-3B-1");
      assert.equal(checkout.status, "failed");
      assert.notEqual(checkout.status, "paid");
    } finally {
      __resetLiveStoreForTests();
    }
  });

  await t.test("L. duplicate DECLINED Live", async () => {
    const paypalOrderId = `PP-LIVE-DECL2-${crypto.randomUUID().slice(0, 8)}`;
    seedLive({ paypalOrderId, status: "pending" });
    try {
      const event = { event_type: "CHECKOUT.ORDER.DECLINED", resource: { id: paypalOrderId, status: "DECLINED" } };
      await handlePayPalWebhook(signedHeaders(), event);
      const duplicate = await handlePayPalWebhook(signedHeaders(), event);
      assert.equal(duplicate.live.duplicate, true);
      assert.equal(getLiveCheckout("LCK-3B-1").status, "failed");
    } finally {
      __resetLiveStoreForTests();
    }
  });

  await t.test("M. commande déjà paid + DENIED => reste paid", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ctx = seedMarketplace(suffix);
    try {
      const paypalOrderId = `PP-MK-PAID-${suffix}`;
      const captureId = `CAP-PAID-${suffix}`;
      attachPaypal(ctx.order.id, { paypalOrderId, captureId });
      updateOrderStatus(ctx.order.id, "paid", { paymentStatus: "paid", paymentMethod: "paypal" });
      const stockAfterPaid = listingStock(ctx.listing.id);
      const result = await handlePayPalWebhook(signedHeaders(), {
        event_type: "PAYMENT.CAPTURE.DENIED",
        resource: captureResource({ captureId, paypalOrderId, customId: ctx.order.id, status: "DENIED" })
      });
      const order = getOrder(ctx.order.id);
      assert.equal(result.marketplace[0].protected, true);
      assert.equal(order.status, "paid");
      assert.equal(order.paymentStatus, "paid");
      assert.equal(listingStock(ctx.listing.id), stockAfterPaid);
    } finally {
      cleanupMarketplace(ctx);
    }
  });

  await t.test("N. commande déjà refunded + DECLINED => reste refunded", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ctx = seedMarketplace(suffix);
    try {
      const paypalOrderId = `PP-MK-REF-${suffix}`;
      attachPaypal(ctx.order.id, { paypalOrderId, captureId: `CAP-REF-${suffix}` });
      updateOrderStatus(ctx.order.id, "paid", { paymentStatus: "paid", paymentMethod: "paypal" });
      updateOrderStatus(ctx.order.id, "refunded", { paymentStatus: "refunded", paymentMethod: "paypal" });
      const result = await handlePayPalWebhook(signedHeaders(), {
        event_type: "CHECKOUT.ORDER.DECLINED",
        resource: { id: paypalOrderId, status: "DECLINED", purchase_units: [{ custom_id: ctx.order.id }] }
      });
      const order = getOrder(ctx.order.id);
      assert.equal(result.marketplace[0].protected, true);
      assert.equal(order.status, "refunded");
      assert.equal(order.paymentStatus, "refunded");
    } finally {
      cleanupMarketplace(ctx);
    }
  });

  await t.test("O. resource inconnu => pas de 500", async () => {
    const pending = await handlePayPalWebhook(signedHeaders(), {
      event_type: "PAYMENT.CAPTURE.PENDING",
      resource: { id: "CAP-UNKNOWN", status: "PENDING" }
    });
    const denied = await handlePayPalWebhook(signedHeaders(), {
      event_type: "PAYMENT.CAPTURE.DENIED",
      resource: {}
    });
    const declined = await handlePayPalWebhook(signedHeaders(), {
      event_type: "CHECKOUT.ORDER.DECLINED",
      resource: { id: "ORDER-UNKNOWN", status: "DECLINED" }
    });
    assert.equal(pending.received, true);
    assert.equal(pending.ignored, true);
    assert.equal(denied.received, true);
    assert.equal(denied.ignored, true);
    assert.equal(declined.received, true);
    assert.equal(declined.ignored, true);
  });

  await t.test("P. signature invalide => refus", async () => {
    await assert.rejects(
      handlePayPalWebhook({}, { event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: "x" } }),
      (error) => error.status === 400
    );
  });
});
