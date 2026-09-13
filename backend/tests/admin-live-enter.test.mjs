import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import express from "express";
import { migrateAuth } from "../lib/auth/migrate.js";
import { createSession } from "../lib/auth/session.js";
import { createUser } from "../lib/auth/users.js";
import { getDb } from "../lib/engine/database.js";
import { planLiveCheckout } from "../lib/live/checkout.js";
import {
  __resetLiveStoreForTests,
  __setLiveStoreForTests,
  grantAdminLiveAccess,
  listAdminLiveAccess,
  listLiveCheckouts,
  liveUrlPrivilegeQueryIsIgnored,
  resolveAdminLiveAccess
} from "../lib/live/sessions.js";
import { migrateMarketplace } from "../lib/marketplace/migrate.js";
import { registerSeller } from "../lib/marketplace/sellers.js";
import { listPayments } from "../lib/payments/ledger.js";
import { PAYMENT_MATRIX } from "../lib/payments/routing.js";
import liveRoutes from "../routes/live.js";
import liveAdminRoutes from "../routes/live-admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");
const readRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

function seedEnterLives() {
  __setLiveStoreForTests({
    sessions: [
      {
        id: "LIVE-ENTER-ADMIN",
        title: "Live Cardoria Admin Enter",
        ownerRole: "admin",
        ownerId: "cardoria",
        status: "live",
        products: [{ id: "LOT-ENTER-ADMIN", name: "Lot admin", qty: 1, stock: 3, price: 20, mode: "buy_now" }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "LIVE-ENTER-SELLER",
        title: "Live vendeur Enter",
        ownerRole: "seller",
        ownerId: "SEL-ENTER-1",
        status: "live",
        products: [{ id: "LOT-ENTER-SELLER", name: "Lot vendeur", qty: 1, stock: 3, price: 15, mode: "buy_now" }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    checkouts: [],
    adminAccess: []
  });
}

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use("/api/live", liveRoutes);
  app.use("/api/admin/live", liveAdminRoutes);
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

async function requestJson(base, pathname, { method = "GET", body, token, grant } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  if (grant) headers["x-live-admin-grant"] = grant;
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function makeTestUser(role, suffix) {
  migrateAuth();
  const email = `live-enter-${role}-${suffix}-${Math.random().toString(16).slice(2)}@cardoria.test`;
  const user = createUser({
    email,
    password: "LiveEnterPass1!",
    role,
    name: `Enter ${role}`
  });
  const session = createSession(user.id, { ip: "127.0.0.1", userAgent: "admin-live-enter-test" });
  return {
    user,
    token: session.token,
    cleanup() {
      const db = getDb();
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(user.id);
      try { db.prepare("DELETE FROM mk_sellers WHERE auth_user_id = ?").run(user.id); } catch {}
      db.prepare("DELETE FROM auth_users WHERE id = ?").run(user.id);
    }
  };
}

test("bouton Admin Live et route enter sont branchés sans bypass URL", () => {
  for (const relative of ["js/admin/admin-live.js", "backend/public/js/admin/admin-live.js"]) {
    const source = readRepo(relative);
    assert.match(source, /data-enter-live=/);
    assert.match(source, /Voir comme spectateur/);
    assert.match(source, /\/api\/admin\/live\/sessions\/" \+ encodeURIComponent\(btn\.dataset\.enterLive\) \+ "\/enter"/);
    assert.match(source, /window\.open\("about:blank", "_blank"\)/);
    assert.match(source, /liveWindow\.location\.href = liveUrl/);
    assert.match(source, /liveWindow\.close\(\)/);
    assert.match(source, /location\.assign\(liveUrl\)/);
    assert.doesNotMatch(source, /\?admin=1|\?free=1|\?noFee=1/);
    assert.match(source, /data-start=/);
    assert.match(source, /data-stop=/);
    assert.match(source, /data-cancel=/);
  }
  const route = readRepo("backend/routes/live-admin.js");
  assert.match(route, /router\.post\("\/sessions\/:id\/enter"/);
  assert.match(route, /grantAdminLiveAccess/);
  assert.match(route, /requireAdmin/);
  assert.doesNotMatch(route, /createLiveCheckout|createRevolutCheckout|createLivePayPalOrder/);
  const viewer = readRepo("js/cardoria-live-viewer.js");
  assert.match(viewer, /urlFlagsNeverGrantAdmin\s*=\s*true/);
  assert.match(viewer, /cardoriaAdminGrant/);
  assert.match(viewer, /x-live-admin-grant/);
  assert.equal(liveUrlPrivilegeQueryIsIgnored(), true);
  assert.equal(PAYMENT_MATRIX.live_seller, "paypal");
  assert.equal(PAYMENT_MATRIX.live_admin, "sumup");
});

test("admin authentifié entre dans le Live sans paiement ni commission", async () => {
  seedEnterLives();
  migrateAuth();
  const admin = makeTestUser("admin", `${Date.now()}-a`);
  const beforeCheckouts = listLiveCheckouts({ liveId: "LIVE-ENTER-ADMIN" }).length;
  const beforePayments = listPayments({ limit: 500 }).length;
  try {
    await withServer(async (base) => {
      const entered = await requestJson(base, "/api/admin/live/sessions/LIVE-ENTER-ADMIN/enter", {
        method: "POST",
        body: {},
        token: admin.token
      });
      assert.equal(entered.status, 200);
      assert.equal(entered.data.ok, true);
      assert.equal(entered.data.access.role, "admin");
      assert.equal(entered.data.access.context, "cardoria");
      assert.equal(entered.data.access.liveId, "LIVE-ENTER-ADMIN");
      assert.equal(entered.data.access.title, "Live Cardoria Admin Enter");
      assert.equal(entered.data.access.ownerRole, "admin");
      assert.match(entered.data.access.url, /\/live\.html\?session=LIVE-ENTER-ADMIN/);
      assert.ok(entered.data.access.grantToken);
      assert.equal(entered.data.paymentCreated, false);
      assert.equal(entered.data.checkoutCreated, false);
      assert.equal(entered.data.commissionCreated, false);
      assert.equal(listLiveCheckouts({ liveId: "LIVE-ENTER-ADMIN" }).length, beforeCheckouts);
      assert.equal(listPayments({ limit: 500 }).length, beforePayments);
      assert.equal(listAdminLiveAccess({ liveId: "LIVE-ENTER-ADMIN" }).length, 1);

      const viaGrant = await requestJson(base, "/api/live/sessions/LIVE-ENTER-ADMIN/admin-access", {
        grant: entered.data.access.grantToken
      });
      assert.equal(viaGrant.status, 200);
      assert.equal(viaGrant.data.accessRole, "admin");
      assert.equal(viaGrant.data.accessContext, "cardoria");
    });
  } finally {
    admin.cleanup();
    __resetLiveStoreForTests();
  }
});

test("anonyme, client et vendeur sont refusés ; bypass URL impossible", async () => {
  seedEnterLives();
  migrateAuth();
  migrateMarketplace();
  const client = makeTestUser("client", `${Date.now()}-c`);
  const sellerUser = makeTestUser("client", `${Date.now()}-s`);
  const seller = registerSeller({
    email: sellerUser.user.email,
    displayName: "Vendeur Enter",
    sellerType: "individual",
    authUserId: sellerUser.user.id
  });
  try {
    await withServer(async (base) => {
      const anonymous = await requestJson(base, "/api/admin/live/sessions/LIVE-ENTER-ADMIN/enter", {
        method: "POST",
        body: {}
      });
      assert.equal(anonymous.status, 401);

      const clientEnter = await requestJson(base, "/api/admin/live/sessions/LIVE-ENTER-ADMIN/enter", {
        method: "POST",
        body: {},
        token: client.token
      });
      assert.ok(clientEnter.status === 401 || clientEnter.status === 403);

      const sellerEnter = await requestJson(base, "/api/admin/live/sessions/LIVE-ENTER-SELLER/enter", {
        method: "POST",
        body: {},
        token: sellerUser.token
      });
      assert.ok(sellerEnter.status === 401 || sellerEnter.status === 403);

      const sellerOwn = await requestJson(base, `/api/live/seller/sessions/${seller.id}/enter`, {
        method: "POST",
        body: {},
        token: sellerUser.token
      });
      assert.notEqual(sellerOwn.status, 200);

      const flagged = await requestJson(base, "/api/live/sessions/LIVE-ENTER-ADMIN?admin=1&free=1&noFee=1");
      assert.equal(flagged.status, 200);
      assert.equal(flagged.data.session.id, "LIVE-ENTER-ADMIN");
      assert.equal(flagged.data.accessRole, undefined);
      assert.equal(flagged.data.accessContext, undefined);

      const fakeGrant = await requestJson(base, "/api/live/sessions/LIVE-ENTER-ADMIN/admin-access?admin=1&free=1&noFee=1");
      assert.equal(fakeGrant.status, 401);

      assert.throws(
        () => grantAdminLiveAccess("LIVE-ENTER-SELLER", { role: "seller", sellerId: "SEL-ENTER-1", id: "SEL-ENTER-1" }),
        (error) => error.status === 403
      );
      assert.equal(resolveAdminLiveAccess({
        liveId: "LIVE-ENTER-ADMIN",
        grantToken: "",
        actor: { role: "client", id: client.user.id }
      }), null);
    });
  } finally {
    client.cleanup();
    sellerUser.cleanup();
    __resetLiveStoreForTests();
  }
});

test("entrée admin sur Live vendeur ne change pas PayPal ni les commissions", async () => {
  seedEnterLives();
  migrateAuth();
  const admin = makeTestUser("admin", `${Date.now()}-p`);
  try {
    const access = grantAdminLiveAccess("LIVE-ENTER-SELLER", admin.user);
    assert.equal(access.session.ownerRole, "seller");
    assert.equal(access.session.paymentProvider, "paypal");
    assert.equal(access.paymentCreated, false);
    assert.equal(listLiveCheckouts({ liveId: "LIVE-ENTER-SELLER" }).length, 0);
    const checkout = planLiveCheckout({
      liveId: "LIVE-ENTER-SELLER",
      productId: "LOT-ENTER-SELLER",
      qty: 1,
      customerEmail: "buyer-enter@example.com",
      customerName: "Buyer"
    });
    assert.equal(checkout.provider, "paypal");
    assert.equal(checkout.channel, "live_seller");
    assert.ok(checkout.platformFee > 0);
    assert.ok(checkout.sellerNet < checkout.amount);
    assert.equal(listLiveCheckouts({ liveId: "LIVE-ENTER-SELLER" }).filter((item) => item.provider === "paypal").length, 1);
  } finally {
    admin.cleanup();
    __resetLiveStoreForTests();
  }
});
