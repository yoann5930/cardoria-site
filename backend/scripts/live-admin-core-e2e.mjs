import { createUser } from "../lib/auth/users.js";
import { createSession } from "../lib/auth/session.js";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(BASE + path, options);
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

function auth(token, path, options = {}) {
  return request(path, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
}

const admin = createUser({
  email: `live-admin-${suffix}@cardoria.invalid`,
  password: "Live-Admin-E2E-2026!",
  role: "admin",
  name: "Live Admin E2E"
});
const client = createUser({
  email: `live-client-${suffix}@cardoria.invalid`,
  password: "Live-Client-E2E-2026!",
  role: "client",
  name: "Live Client E2E"
});
const adminToken = createSession(admin.id).token;
const clientToken = createSession(client.id).token;

const anonymousList = await request("/api/admin/live/sessions");
assert(anonymousList.response.status === 401, "Anonymous user can list Admin Lives");

const clientList = await auth(clientToken, "/api/admin/live/sessions");
assert(clientList.response.status === 403, "Client can access Admin Live control plane");

const productId = `ADMIN-LOT-${suffix}`;
const create = await auth(adminToken, "/api/admin/live/sessions", {
  method: "POST",
  body: JSON.stringify({
    title: `Admin Live E2E ${suffix}`,
    ownerRole: "admin",
    products: [{ id: productId, name: "Lot Admin E2E", qty: 2, stock: 2, price: 12, mode: "buy_now" }]
  })
});
assert(create.response.status === 200 && create.body.session?.id, "Admin Live creation failed");
assert(create.body.session.ownerRole === "admin", "Admin Live has wrong ownerRole");
assert(create.body.provider === "sumup" && create.body.session.paymentProvider === "sumup", "Admin Live is not routed to SumUp");
const liveId = create.body.session.id;

const draftPublic = await request(`/api/live/sessions/${encodeURIComponent(liveId)}`);
assert(draftPublic.response.status === 404, "Draft Admin Live is public");

const draftCheckout = await request("/api/live/checkout/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    liveId,
    productId,
    qty: 1,
    customerEmail: `buyer-${suffix}@cardoria.invalid`,
    customerName: "Buyer E2E",
    provider: "sumup",
    amount: 12
  })
});
assert(draftCheckout.response.status === 409, "Draft Admin Live accepts payment");

const clientStart = await auth(clientToken, `/api/admin/live/sessions/${encodeURIComponent(liveId)}/start`, { method: "POST", body: "{}" });
assert(clientStart.response.status === 403, "Client can start Admin Live");

const anonymousStudio = await request(`/api/live/admin-studio/${encodeURIComponent(liveId)}`);
assert(anonymousStudio.response.status === 401, "Anonymous user can access Admin Studio");

const enter = await auth(adminToken, `/api/admin/live/sessions/${encodeURIComponent(liveId)}/enter`, { method: "POST", body: "{}" });
assert(enter.response.status === 200 && enter.body.access?.grantToken, "Admin Live secure enter grant failed");
assert(enter.body.access.role === "admin" && enter.body.access.context === "cardoria", "Admin Live grant has wrong context");
assert(enter.body.paymentCreated === false && enter.body.checkoutCreated === false && enter.body.commissionCreated === false, "Entering Admin Live created an unexpected payment");
const grantToken = enter.body.access.grantToken;

const grantAccess = await request(`/api/live/sessions/${encodeURIComponent(liveId)}/admin-access`, {
  headers: { Accept: "application/json", "x-live-admin-grant": grantToken }
});
assert(grantAccess.response.status === 200 && grantAccess.body.accessRole === "admin" && grantAccess.body.accessContext === "cardoria", "Admin Live grant cannot be resolved");

const studioGrant = await request(`/api/live/admin-studio/${encodeURIComponent(liveId)}`, {
  headers: { Accept: "application/json", "x-live-admin-grant": grantToken }
});
assert(studioGrant.response.status === 200 && studioGrant.body.session?.id === liveId, "Admin Studio grant access failed");

const start = await auth(adminToken, `/api/admin/live/sessions/${encodeURIComponent(liveId)}/start`, { method: "POST", body: "{}" });
assert(start.response.status === 200 && start.body.session?.status === "live", "Admin Live start failed");
assert(start.body.provider === "sumup", "Started Admin Live changed payment provider");

const publicDirectory = await request("/api/live/sessions?status=live");
assert(publicDirectory.response.status === 200 && publicDirectory.body.sessions?.some((item) => item.id === liveId), "Active Admin Live missing from public directory");

const publicDetail = await request(`/api/live/sessions/${encodeURIComponent(liveId)}`);
assert(publicDetail.response.status === 200 && publicDetail.body.session?.id === liveId, "Active Admin Live public detail unavailable");
assert(!("ownerEmail" in publicDetail.body.session), "Public Admin Live leaks ownerEmail");

const wrongProvider = await request("/api/live/checkout/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    liveId,
    productId,
    qty: 1,
    customerEmail: `wrong-provider-${suffix}@cardoria.invalid`,
    customerName: "Wrong Provider",
    provider: "paypal",
    amount: 12
  })
});
assert(wrongProvider.response.status >= 400 && wrongProvider.body.expectedProvider === "sumup", "Admin Live accepts PayPal instead of SumUp");

const planned = await request("/api/live/checkout/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    liveId,
    productId,
    qty: 1,
    customerEmail: `buyer-${suffix}@cardoria.invalid`,
    customerName: "Buyer E2E",
    provider: "sumup",
    amount: 12
  })
});
assert(planned.response.status === 200 && planned.body.provider === "sumup", "Admin Live SumUp plan failed");
assert(planned.body.checkout?.provider === "sumup" && planned.body.checkout?.platformFee === 0, "Admin Live checkout has incorrect SumUp/commission values");

const auctionStart = await auth(adminToken, `/api/admin/live/sessions/${encodeURIComponent(liveId)}/actions/auction/start`, {
  method: "POST",
  body: JSON.stringify({ productId, startPrice: 5, durationSeconds: 30 })
});
assert(auctionStart.response.status === 200 && auctionStart.body.auction?.status === "running", "Admin auction start failed");
const auctionStop = await auth(adminToken, `/api/admin/live/sessions/${encodeURIComponent(liveId)}/actions/auction/stop`, { method: "POST", body: "{}" });
assert(auctionStop.response.status === 200 && auctionStop.body.auction?.status === "ended", "Admin auction stop failed");

const stop = await auth(adminToken, `/api/admin/live/sessions/${encodeURIComponent(liveId)}/stop`, { method: "POST", body: "{}" });
assert(stop.response.status === 200 && stop.body.session?.status === "ended", "Admin Live stop failed");

const endedPublic = await request(`/api/live/sessions/${encodeURIComponent(liveId)}`);
assert(endedPublic.response.status === 404, "Ended Admin Live remains publicly visible");

const endedCheckout = await request("/api/live/checkout/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    liveId,
    productId,
    qty: 1,
    customerEmail: `after-end-${suffix}@cardoria.invalid`,
    customerName: "After End",
    provider: "sumup",
    amount: 12
  })
});
assert(endedCheckout.response.status === 409, "Ended Admin Live accepts payment");

console.log("LIVE_ADMIN_CORE_E2E_PASS");
