import { getDb } from "../lib/engine/database.js";
import { createListingV1 } from "../lib/marketplace/v1/listings.js";
import { createOrder } from "../lib/marketplace/orders.js";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const password = "Marketplace-E2E-Password-2026!";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function json(path, options = {}) {
  const response = await fetch(BASE + path, options);
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}
function auth(token, path, options = {}) {
  options.headers = { ...(options.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
  return json(path, options);
}
async function register(label) {
  const email = `${label}-${suffix}@cardoria.invalid`;
  const result = await json("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: label })
  });
  assert(result.response.status === 201 && result.body.token && result.body.user?.id, `Registration failed for ${label}`);
  return { email, token: result.body.token, user: result.body.user };
}
async function registerSeller(account, displayName) {
  const result = await auth(account.token, "/api/marketplace/v1/paypal/sellers/register", {
    method: "POST",
    body: JSON.stringify({ displayName, sellerType: "individual" })
  });
  assert(result.response.status === 200 && result.body.seller?.id, `Seller registration failed for ${displayName}`);
  return result.body.seller;
}

const sellerAccountA = await register("seller-a");
const sellerAccountB = await register("seller-b");
const buyerA = await register("buyer-a");
const buyerB = await register("buyer-b");
const sellerA = await registerSeller(sellerAccountA, "Seller A");
const sellerB = await registerSeller(sellerAccountB, "Seller B");

const listingA = createListingV1({ sellerId: sellerA.id, title: `Marketplace A ${suffix}`, description: "Public listing", price: 24.9, stock: 4, status: "active" });
const listingB = createListingV1({ sellerId: sellerB.id, title: `Marketplace B ${suffix}`, description: "Other seller listing", price: 34.9, stock: 3, status: "active" });
getDb().prepare("UPDATE mk_listings SET moderation_locked=0, moderation_reason=?, moderated_by=?, moderated_at=? WHERE id=?")
  .run("INTERNAL-MODERATION-REASON", "private-admin@cardoria.invalid", new Date().toISOString(), listingA.id);

const publicDetail = await json(`/api/marketplace/v1/listings/${listingA.id}`);
assert(publicDetail.response.status === 200 && publicDetail.body.listing?.id === listingA.id, "Public listing detail unavailable");
for (const privateField of ["moderationLocked", "moderationReason", "moderatedBy", "moderatedAt"]) {
  assert(!(privateField in publicDetail.body.listing), `Public listing leaks ${privateField}`);
}
const rawPublic = JSON.stringify(publicDetail.body);
assert(!rawPublic.includes("INTERNAL-MODERATION-REASON") && !rawPublic.includes("private-admin@cardoria.invalid"), "Public listing leaks internal moderation data");

const crossEdit = await auth(sellerAccountA.token, `/api/marketplace/v1/listings/${listingB.id}`, {
  method: "PUT",
  body: JSON.stringify({ title: "Unauthorized edit" })
});
assert(crossEdit.response.status === 403, "Seller A can edit Seller B listing");

const order = createOrder({
  listingId: listingA.id,
  buyerEmail: buyerA.email,
  buyerName: "Buyer A",
  buyerId: buyerA.user.id,
  qty: 1,
  shippingCarrier: "colissimo",
  shippingCost: 2.5,
  shippingAddress: "1 rue E2E, 59000 Lille"
});

const anonymousOrders = await json("/api/marketplace/v1/orders");
assert(anonymousOrders.response.status === 401, "Marketplace orders accessible without session");

const buyerAOrders = await auth(buyerA.token, "/api/marketplace/v1/orders");
assert(buyerAOrders.response.status === 200 && buyerAOrders.body.orders?.some((x) => x.id === order.id), "Buyer A cannot see own order");
const buyerBOrders = await auth(buyerB.token, "/api/marketplace/v1/orders");
assert(buyerBOrders.response.status === 200 && !buyerBOrders.body.orders?.some((x) => x.id === order.id), "Buyer B sees Buyer A order");

const buyerBDetail = await auth(buyerB.token, `/api/marketplace/v1/orders/secure/${order.id}`);
assert(buyerBDetail.response.status === 403, "Buyer B can read Buyer A secure order");
const buyerADetail = await auth(buyerA.token, `/api/marketplace/v1/orders/secure/${order.id}`);
assert(buyerADetail.response.status === 200 && buyerADetail.body.order?.id === order.id, "Buyer A cannot read own secure order");

const sellerOrders = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders`);
assert(sellerOrders.response.status === 200 && sellerOrders.body.orders?.some((x) => x.id === order.id), "Seller cannot see own Marketplace order");
const foreignSellerOrders = await auth(sellerAccountB.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders`);
assert(foreignSellerOrders.response.status === 403, "Seller B can impersonate Seller A order endpoint");

const buyerTracking = await auth(buyerA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "shipped", tracking: "BUYER-MUST-NOT-EDIT" })
});
assert(buyerTracking.response.status === 403, "Buyer can modify seller tracking");
const sellerTracking = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "shipped", tracking: "CARDORIA-E2E-TRACK" })
});
assert(sellerTracking.response.status === 200 && sellerTracking.body.order?.shippingTracking === "CARDORIA-E2E-TRACK", "Seller tracking update failed");

const outsiderInvoice = await auth(buyerB.token, `/api/marketplace/v1/orders/${order.id}/invoice`);
assert(outsiderInvoice.response.status === 403, "Unrelated buyer can access Marketplace invoice");

const retiredCheckout = await auth(buyerA.token, "/api/marketplace/v1/cart/checkout", { method: "POST", body: "{}" });
assert(retiredCheckout.response.status === 410, "Retired Marketplace SumUp checkout is not blocked");
const wrongProvider = await auth(buyerA.token, "/api/marketplace/v1/paypal/checkout", {
  method: "POST",
  body: JSON.stringify({ provider: "sumup", userId: `USR-${suffix}`, amount: 1 })
});
assert(wrongProvider.response.status >= 400 && wrongProvider.body.expectedProvider === "paypal", "Marketplace checkout accepts a non-PayPal provider");

console.log("MARKETPLACE_CORE_E2E_PASS");
