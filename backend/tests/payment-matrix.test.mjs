import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import express from "express";
import {
  PAYMENT_MATRIX,
  assertSaleProvider,
  assertServerAmount,
  resolvePaymentRoute
} from "../lib/payments/routing.js";
import { isSumUpConfigured, createSumUpCheckout, handleSumUpWebhook } from "../lib/payments/sumup.js";
import { refundSumUpTransaction } from "../lib/payments/sumup-refund.js";
import { verifyRevolutWebhookSignature, handleRevolutWebhook } from "../lib/payments/revolut.js";
import { handlePayPalWebhook, paypalWebhookConfigured } from "../lib/marketplace/paypal-events.js";
import { planLiveCheckout } from "../lib/live/checkout.js";
import {
  __resetLiveStoreForTests,
  __setLiveStoreForTests,
  applyLivePaymentStatus,
  assertCanManageLive,
  createLiveSession
} from "../lib/live/sessions.js";
import paymentsRoutes from "../routes/payments.js";
import liveRoutes from "../routes/live.js";
import liveAdminRoutes from "../routes/live-admin.js";
import { webhookRouter } from "../routes/marketplace-admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");
const readRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

function seedLives() {
  __setLiveStoreForTests({
    sessions: [
      {
        id: "LIVE-ADMIN-1",
        title: "Live Cardoria",
        ownerRole: "admin",
        ownerId: "cardoria",
        status: "live",
        products: [{ id: "LOT-ADMIN", name: "Lot admin", qty: 1, stock: 3, price: 20, mode: "buy_now" }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "LIVE-SELLER-1",
        title: "Live vendeur",
        ownerRole: "seller",
        ownerId: "SEL-1",
        status: "live",
        products: [{ id: "LOT-SELLER", name: "Lot vendeur", qty: 1, stock: 3, price: 15, mode: "buy_now" }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    checkouts: []
  });
}

async function withServer(setup, fn) {
  const app = express();
  app.use(express.json());
  setup(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    __resetLiveStoreForTests();
  }
}

async function postJson(base, pathname, body) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

test("TEST A — Boutique Cardoria => Revolut", () => {
  const route = resolvePaymentRoute({ channel: "boutique" });
  assert.equal(route.provider, "revolut");
  assert.equal(PAYMENT_MATRIX.boutique, "revolut");
  const boutique = readRepo("js/boutique.js");
  assert.match(boutique, /\/api\/payments\/boutique\/checkout/);
  assert.match(boutique, /Paiement Revolut/);
  assert.doesNotMatch(boutique, /provider:\s*["']paypal["']/);
  assert.doesNotMatch(readRepo("backend/routes/payments.js"), /createSumUpCheckout|createBoutiqueCheckout/);
});

test("TEST B — LIVE ADMIN => REVOLUT", () => {
  const route = resolvePaymentRoute({ channel: "live", ownerRole: "admin" });
  assert.equal(route.channel, "live_admin");
  assert.equal(route.provider, "revolut");
  seedLives();
  const planned = planLiveCheckout({
    liveId: "LIVE-ADMIN-1",
    productId: "LOT-ADMIN",
    qty: 1,
    customerEmail: "buyer@example.com",
    customerName: "Buyer"
  });
  assert.equal(planned.provider, "revolut");
  assert.equal(planned.channel, "live_admin");
  assert.equal(planned.amount, 20);
  __resetLiveStoreForTests();
});

test("TEST C — LIVE VENDEUR => PAYPAL", () => {
  const route = resolvePaymentRoute({ channel: "live", ownerRole: "seller" });
  assert.equal(route.channel, "live_seller");
  assert.equal(route.provider, "paypal");
  seedLives();
  const planned = planLiveCheckout({
    liveId: "LIVE-SELLER-1",
    productId: "LOT-SELLER",
    qty: 1,
    customerEmail: "buyer@example.com",
    customerName: "Buyer"
  });
  assert.equal(planned.provider, "paypal");
  assert.equal(planned.channel, "live_seller");
  assert.equal(planned.commissionPercent, 6);
  assert.equal(planned.platformFee, 0.9);
  __resetLiveStoreForTests();
});

test("TEST D — MARKETPLACE => PAYPAL", () => {
  const route = resolvePaymentRoute({ channel: "marketplace" });
  assert.equal(route.provider, "paypal");
  assert.match(readRepo("js/marketplace-cart-page.js"), /\/v1\/paypal\/checkout/);
  assert.match(readRepo("backend/routes/marketplace-paypal.js"), /assertSaleProvider\(\{ channel: "marketplace"/);
});

test("TEST E — SumUp absent du runtime", () => {
  assert.equal(isSumUpConfigured(), false);
  const previous = process.env.SUMUP_API_KEY;
  process.env.SUMUP_API_KEY = "dummy";
  assert.equal(isSumUpConfigured(), false);
  if (previous == null) delete process.env.SUMUP_API_KEY;
  else process.env.SUMUP_API_KEY = previous;
  const sumup = readRepo("backend/lib/payments/sumup.js");
  assert.doesNotMatch(sumup, /api\.sumup\.com/);
  assert.match(sumup, /n'est plus utilisé/);
  assert.throws(() => { throw Object.assign(new Error("probe"), { status: 410 }); }, { status: 410 });
});

test("TEST E — stubs SumUp lèvent 410", async () => {
  await assert.rejects(createSumUpCheckout({}), (error) => error.status === 410);
  await assert.rejects(handleSumUpWebhook(), (error) => error.status === 410);
  await assert.rejects(refundSumUpTransaction("tx"), (error) => error.status === 410);
});

test("TEST F — tentative Boutique → PayPal refusée", async () => {
  await withServer((app) => app.use("/api/payments", paymentsRoutes), async (base) => {
    const result = await postJson(base, "/api/payments/boutique/checkout", {
      provider: "paypal",
      customerName: "Test",
      customerEmail: "test@example.com",
      customerPhone: "0600000000",
      address: "1 rue",
      postalCode: "75001",
      city: "Paris",
      items: [{ ref: "x", qty: 1 }]
    });
    assert.equal(result.status, 403);
    assert.equal(result.data.expectedProvider, "revolut");
    assert.match(result.data.error, /refusé/i);
  });
});

test("TEST G — tentative Live Admin → PayPal refusée", () => {
  seedLives();
  assert.throws(() => planLiveCheckout({
    liveId: "LIVE-ADMIN-1",
    productId: "LOT-ADMIN",
    qty: 1,
    customerEmail: "buyer@example.com",
    requestedProvider: "paypal"
  }), (error) => error.status === 403 && error.expectedProvider === "revolut");
  __resetLiveStoreForTests();
});

test("TEST H — tentative Live vendeur → Revolut refusée", () => {
  seedLives();
  assert.throws(() => planLiveCheckout({
    liveId: "LIVE-SELLER-1",
    productId: "LOT-SELLER",
    qty: 1,
    customerEmail: "buyer@example.com",
    requestedProvider: "revolut"
  }), (error) => error.status === 403 && error.expectedProvider === "paypal");
  __resetLiveStoreForTests();
});

test("TEST I — tentative Marketplace → Revolut refusée", () => {
  assert.throws(
    () => assertSaleProvider({ channel: "marketplace", requestedProvider: "revolut" }),
    (error) => error.status === 403 && error.expectedProvider === "paypal"
  );
});

test("TEST J — webhooks Revolut", async () => {
  const previous = process.env.REVOLUT_WEBHOOK_SECRET;
  process.env.REVOLUT_WEBHOOK_SECRET = "cardoria-test-webhook";
  const payload = JSON.stringify({ event: "ORDER_COMPLETED" });
  const timestamp = String(Date.now());
  const signature = "v1=" + crypto.createHmac("sha256", process.env.REVOLUT_WEBHOOK_SECRET).update(`v1.${timestamp}.${payload}`).digest("hex");
  assert.equal(verifyRevolutWebhookSignature(payload, timestamp, "v1=deadbeef"), false);
  await assert.rejects(handleRevolutWebhook(payload, timestamp, "v1=deadbeef"), (error) => error.status === 401);
  const accepted = await handleRevolutWebhook(payload, timestamp, signature);
  assert.equal(accepted.received, true);
  assert.equal(accepted.ignored, true);
  const again = await handleRevolutWebhook(payload, timestamp, signature);
  assert.equal(again.received, true);
  if (previous == null) delete process.env.REVOLUT_WEBHOOK_SECRET;
  else process.env.REVOLUT_WEBHOOK_SECRET = previous;
});

test("TEST K — webhooks PayPal", async () => {
  const previousId = process.env.PAYPAL_WEBHOOK_ID;
  delete process.env.PAYPAL_WEBHOOK_ID;
  assert.equal(paypalWebhookConfigured(), false);
  await assert.rejects(handlePayPalWebhook({}, {}), (error) => error.status === 503);
  process.env.PAYPAL_WEBHOOK_ID = "wh_test";
  assert.equal(paypalWebhookConfigured(), true);
  await assert.rejects(handlePayPalWebhook({}, { event_type: "CHECKOUT.ORDER.APPROVED" }), (error) => error.status === 400);
  if (previousId == null) delete process.env.PAYPAL_WEBHOOK_ID;
  else process.env.PAYPAL_WEBHOOK_ID = previousId;
});

test("TEST L — idempotence Live et paiement déjà traité", () => {
  seedLives();
  const first = planLiveCheckout({
    liveId: "LIVE-ADMIN-1",
    productId: "LOT-ADMIN",
    qty: 1,
    customerEmail: "same@example.com",
    customerName: "Same"
  });
  const second = planLiveCheckout({
    liveId: "LIVE-ADMIN-1",
    productId: "LOT-ADMIN",
    qty: 1,
    customerEmail: "same@example.com",
    customerName: "Same"
  });
  assert.equal(first.id, second.id);
  applyLivePaymentStatus(first.id, "paid");
  assert.throws(() => planLiveCheckout({
    liveId: "LIVE-ADMIN-1",
    productId: "LOT-ADMIN",
    qty: 1,
    customerEmail: "same@example.com"
  }), (error) => error.status === 409);
  const again = applyLivePaymentStatus(first.id, "paid");
  assert.equal(again.alreadyPaid, true);
  __resetLiveStoreForTests();
});

test("TEST M — sécurité des montants", () => {
  assert.equal(assertServerAmount(19.9, 19.9), 19.9);
  assert.throws(() => assertServerAmount(19.9, 1), (error) => error.status === 403);
  seedLives();
  assert.throws(() => planLiveCheckout({
    liveId: "LIVE-ADMIN-1",
    productId: "LOT-ADMIN",
    qty: 1,
    customerEmail: "buyer@example.com",
    requestedAmount: 1
  }), (error) => error.status === 403);
  __resetLiveStoreForTests();
});

test("TEST N — permissions vendeur/admin/client", async () => {
  __setLiveStoreForTests({ sessions: [], checkouts: [] });
  const sellerLive = createLiveSession({
    title: "A",
    ownerRole: "seller",
    ownerId: "SEL-A",
    products: [{ name: "Lot", price: 10, qty: 1, stock: 1 }],
    actor: { role: "seller", sellerId: "SEL-A" }
  });
  assert.throws(
    () => assertCanManageLive({ role: "seller", sellerId: "SEL-B" }, sellerLive),
    (error) => error.status === 403
  );
  assert.throws(
    () => assertCanManageLive({ role: "client", id: "CLI-1" }, sellerLive),
    (error) => error.status === 403
  );
  assert.equal(assertCanManageLive({ role: "admin" }, sellerLive, { adminOverride: true }).id, sellerLive.id);
  await withServer((app) => {
    app.use("/api/live", liveRoutes);
    app.use("/api/admin/live", liveAdminRoutes);
  }, async (base) => {
    const seller = await postJson(base, "/api/live/seller/sessions", { title: "x", products: [{ name: "Lot", price: 10 }] });
    assert.equal(seller.status, 401);
    const admin = await fetch(base + "/api/admin/live/sessions");
    assert.equal(admin.status, 401);
    const client = await fetch(base + "/api/live/matrix");
    const matrix = await client.json();
    assert.equal(client.status, 200);
    assert.equal(matrix.matrix.boutique, "revolut");
    assert.equal(matrix.sumup, "retired");
  });
});

test("TEST E HTTP — endpoints SumUp 410", async () => {
  await withServer((app) => {
    app.use("/api/payments", paymentsRoutes);
    app.use("/api/marketplace/webhooks", webhookRouter);
  }, async (base) => {
    const checkout = await postJson(base, "/api/payments/sumup/checkout", {});
    assert.equal(checkout.status, 410);
    const webhook = await postJson(base, "/api/marketplace/webhooks/sumup", {});
    assert.equal(webhook.status, 410);
  });
});

test("SumUp demandé sur un canal actif est refusé en 410", () => {
  assert.throws(
    () => assertSaleProvider({ channel: "boutique", requestedProvider: "sumup" }),
    (error) => error.status === 410
  );
});
