import { setSellerPlan } from "../lib/subscriptions/seller-plans.js";
import { updateSellerPayPal } from "../lib/marketplace/sellers.js";
import { createOrder, updateOrderStatus } from "../lib/marketplace/orders.js";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const password = "Seller-E2E-Password-2026!";

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
const buyer = await register("buyer");
const sellerA = await registerSeller(sellerAccountA, "Seller A");
const sellerB = await registerSeller(sellerAccountB, "Seller B");

const publicProfile = await json(`/api/marketplace/v1/sellers/${sellerA.id}/public`);
assert(publicProfile.response.status === 200 && publicProfile.body.seller?.id === sellerA.id, "Public seller profile unavailable");
for (const privateField of ["email", "authUserId", "paypalMerchantId", "paypalTrackingId", "paypalOnboardingStatus", "paypalConnectedAt"]) {
  assert(!(privateField in publicProfile.body.seller), `Public seller profile leaks ${privateField}`);
}

const ownSubscription = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/subscription`);
assert(ownSubscription.response.status === 200 && ownSubscription.body.subscription?.sellerId === sellerA.id, "Seller cannot read own subscription");
const foreignSubscription = await auth(sellerAccountB.token, `/api/marketplace/v1/sellers/${sellerA.id}/subscription`);
assert(foreignSubscription.response.status === 403, "Seller B can read Seller A subscription");

const draft = await auth(sellerAccountA.token, "/api/marketplace/v1/listings", {
  method: "POST",
  body: JSON.stringify({ sellerId: sellerA.id, title: `Seller draft ${suffix}`, description: "Seller E2E draft", price: 29.9, stock: 2, status: "draft" })
});
assert(draft.response.status === 201 && draft.body.listing?.status === "draft", "Seller cannot create draft without active subscription");

const publishInactive = await auth(sellerAccountA.token, `/api/marketplace/v1/listings/${draft.body.listing.id}`, {
  method: "PUT",
  body: JSON.stringify({ status: "active" })
});
assert(publishInactive.response.status === 409, "Seller can publish without active subscription");

setSellerPlan(sellerA.id, "starter", { status: "active" });
const publishNoPaypal = await auth(sellerAccountA.token, `/api/marketplace/v1/listings/${draft.body.listing.id}`, {
  method: "PUT",
  body: JSON.stringify({ status: "active" })
});
assert(publishNoPaypal.response.status === 409, "Seller can publish without PayPal ready");

updateSellerPayPal(sellerA.id, { merchantId: `MERCHANT-${suffix}`, onboardingStatus: "ready", paymentsReceivable: true, connectedAt: new Date().toISOString() });
const published = await auth(sellerAccountA.token, `/api/marketplace/v1/listings/${draft.body.listing.id}`, {
  method: "PUT",
  body: JSON.stringify({ status: "active" })
});
assert(published.response.status === 200 && published.body.listing?.status === "active", "Ready seller cannot publish own listing");

const ownListings = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/listings`);
assert(ownListings.response.status === 200 && ownListings.body.listings?.some((x) => x.id === draft.body.listing.id), "Seller cannot list own listings");
const foreignListings = await auth(sellerAccountB.token, `/api/marketplace/v1/sellers/${sellerA.id}/listings`);
assert(foreignListings.response.status === 403, "Seller B can access Seller A private listings");

const order = createOrder({
  listingId: draft.body.listing.id,
  buyerEmail: buyer.email,
  buyerName: "Buyer",
  buyerId: buyer.user.id,
  qty: 1,
  shippingCarrier: "colissimo",
  shippingCost: 2.5,
  shippingAddress: "1 rue Seller E2E, 59000 Lille"
});

const foreignOrders = await auth(sellerAccountB.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders`);
assert(foreignOrders.response.status === 403, "Seller B can access Seller A private orders");
const ownOrders = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders`);
assert(ownOrders.response.status === 200 && ownOrders.body.orders?.some((x) => x.id === order.id), "Seller cannot read own orders");

const unpaidShipment = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "shipped", tracking: "UNPAID-MUST-FAIL" })
});
assert(unpaidShipment.response.status === 409, "Seller can ship an unpaid order");

const invalidStatus = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "cancelled" })
});
assert(invalidStatus.response.status === 400, "Invalid seller fulfillment status is silently accepted");

updateOrderStatus(order.id, "paid", { paymentStatus: "paid", paymentMethod: "paypal" });
const skipToDelivered = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "delivered" })
});
assert(skipToDelivered.response.status === 409, "Seller can skip paid order directly to delivered");

const preparing = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "preparing" })
});
assert(preparing.response.status === 200 && preparing.body.order?.status === "preparing", "Seller cannot prepare paid order");

const prematureDelivered = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "delivered" })
});
assert(prematureDelivered.response.status === 409, "Seller can skip preparing order directly to delivered");

const shipped = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "shipped", tracking: "SELLER-E2E-TRACK" })
});
assert(shipped.response.status === 200 && shipped.body.order?.status === "shipped" && shipped.body.order?.shippingTracking === "SELLER-E2E-TRACK", "Seller shipping update failed");

const delivered = await auth(sellerAccountA.token, `/api/marketplace/v1/sellers/${sellerA.id}/orders/${order.id}/tracking`, {
  method: "PUT",
  body: JSON.stringify({ status: "delivered" })
});
assert(delivered.response.status === 200 && delivered.body.order?.status === "delivered", "Seller cannot mark shipped order delivered");

console.log("SELLER_CORE_E2E_PASS");
