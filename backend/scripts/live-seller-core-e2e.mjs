const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const password = "Live-Seller-E2E-2026!";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function json(path, options = {}) {
  const response = await fetch(BASE + path, options);
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}
function auth(token, path, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
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

const sellerAccountA = await register("live-seller-a");
const sellerAccountB = await register("live-seller-b");
const buyer = await register("live-buyer");
const sellerA = await registerSeller(sellerAccountA, "Live Seller A");
const sellerB = await registerSeller(sellerAccountB, "Live Seller B");

for (const [account,seller,city] of [[sellerAccountA,sellerA,"Paris"],[sellerAccountB,sellerB,"Lille"]]) {
  const sender = await auth(account.token, `/api/marketplace/v1/sellers/${seller.id}/sender-profile`, {
    method: "PUT",
    body: JSON.stringify({ name: seller.displayName, addressLine1: "1 rue Test", postalCode: city === "Paris" ? "75001" : "59000", city, countryCode: "FR", phone: "0600000000" })
  });
  assert(sender.response.status === 200 && sender.body.ready === true, "Seller sender profile setup failed");
}

const anonymousSessions = await json("/api/live/seller/sessions");
assert(anonymousSessions.response.status === 401, "Anonymous user can read seller Live sessions");

const created = await auth(sellerAccountA.token, "/api/live/seller/sessions", {
  method: "POST",
  body: JSON.stringify({
    title: `Live seller E2E ${suffix}`,
    products: [{ id: "LOT-E2E", name: "Lot vendeur E2E", mode: "auction", price: 20, qty: 2, stock: 2 }]
  })
});
assert(created.response.status === 200, "Seller A cannot create Live");
assert(created.body.provider === "paypal", "Seller Live creation is not routed to PayPal");
assert(created.body.session?.ownerRole === "seller" && created.body.session?.ownerId === sellerA.id, "Seller Live owner is invalid");
assert(created.body.session?.paymentProvider === "paypal", "Seller Live public session provider is not PayPal");
assert(!("ownerEmail" in (created.body.session || {})), "Seller Live response leaks ownerEmail");
const liveId = created.body.session.id;

const sellerBList = await auth(sellerAccountB.token, "/api/live/seller/sessions");
assert(sellerBList.response.status === 200 && !sellerBList.body.sessions?.some((x) => x.id === liveId), "Seller B can list Seller A Live");

const foreignPatch = await auth(sellerAccountB.token, `/api/live/seller/sessions/${liveId}`, {
  method: "PATCH",
  body: JSON.stringify({ title: "Hijacked" })
});
assert(foreignPatch.response.status === 403, "Seller B can edit Seller A Live");

const foreignStart = await auth(sellerAccountB.token, `/api/live/seller/sessions/${liveId}/start`, {
  method: "POST",
  body: "{}"
});
assert(foreignStart.response.status === 403, "Seller B can start Seller A Live");

const preStartPlan = await json("/api/live/checkout/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ liveId, productId: "LOT-E2E", qty: 1, customerEmail: buyer.email, customerName: "Buyer", provider: "paypal", amount: 20 })
});
assert(preStartPlan.response.status === 409, "Seller Live accepts payment before start");

const started = await auth(sellerAccountA.token, `/api/live/seller/sessions/${liveId}/start`, {
  method: "POST",
  body: "{}"
});
assert(started.response.status === 200 && started.body.session?.status === "live", "Seller A cannot start own Live");
assert(started.body.provider === "paypal" && started.body.session?.paymentProvider === "paypal", "Started seller Live is not PayPal routed");

const publicList = await json("/api/live/sessions");
const publicLive = publicList.body.sessions?.find((x) => x.id === liveId);
assert(publicList.response.status === 200 && publicLive, "Active seller Live is missing from public listing");
assert(publicLive.ownerRole === "seller" && publicLive.paymentProvider === "paypal", "Public seller Live routing is invalid");
assert(!("ownerEmail" in publicLive), "Public seller Live leaks ownerEmail");

const wrongProvider = await json("/api/live/checkout/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ liveId, productId: "LOT-E2E", qty: 1, customerEmail: buyer.email, customerName: "Buyer", provider: "sumup", amount: 20 })
});
assert(wrongProvider.response.status >= 400, "Seller Live accepts SumUp instead of PayPal");
assert(wrongProvider.body.expectedProvider === "paypal" || wrongProvider.body.provider === "paypal", "Wrong-provider rejection does not identify PayPal");

const planned = await json("/api/live/checkout/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ liveId, productId: "LOT-E2E", qty: 1, customerEmail: buyer.email, customerName: "Buyer", provider: "paypal", amount: 20 })
});
assert(planned.response.status === 200 && planned.body.provider === "paypal", "Valid seller Live PayPal plan failed");
assert(planned.body.checkout?.ownerId === sellerA.id && planned.body.checkout?.ownerRole === "seller", "Seller checkout ownership is invalid");
assert(Number(planned.body.checkout?.platformFee) > 0, "Seller Live commission is not applied");
assert(Number(planned.body.checkout?.sellerNet) < Number(planned.body.checkout?.amount), "Seller net does not subtract Cardoria commission");

const sellerACheckouts = await auth(sellerAccountA.token, "/api/live/seller/checkouts");
assert(sellerACheckouts.response.status === 200 && sellerACheckouts.body.checkouts?.some((x) => x.liveId === liveId), "Seller A cannot read own Live checkout");
const sellerBCheckouts = await auth(sellerAccountB.token, "/api/live/seller/checkouts");
assert(sellerBCheckouts.response.status === 200 && !sellerBCheckouts.body.checkouts?.some((x) => x.liveId === liveId), "Seller B can read Seller A Live checkout");

const foreignAuction = await auth(sellerAccountB.token, `/api/live/actions/seller/${liveId}/auction/start`, {
  method: "POST",
  body: JSON.stringify({ productId: "LOT-E2E", startPrice: 20, durationSeconds: 30 })
});
assert(foreignAuction.response.status === 403, "Seller B can control Seller A auction");

const auctionStart = await auth(sellerAccountA.token, `/api/live/actions/seller/${liveId}/auction/start`, {
  method: "POST",
  body: JSON.stringify({ productId: "LOT-E2E", startPrice: 20, durationSeconds: 30 })
});
assert(auctionStart.response.status === 200 && auctionStart.body.auction, "Seller A cannot start own auction");
const auctionStop = await auth(sellerAccountA.token, `/api/live/actions/seller/${liveId}/auction/stop`, {
  method: "POST",
  body: "{}"
});
assert(auctionStop.response.status === 200, "Seller A cannot stop own auction");

const stopped = await auth(sellerAccountA.token, `/api/live/seller/sessions/${liveId}/stop`, {
  method: "POST",
  body: "{}"
});
assert(stopped.response.status === 200 && stopped.body.session?.status === "ended", "Seller A cannot stop own Live");

const publicEnded = await json(`/api/live/sessions/${liveId}`);
assert(publicEnded.response.status === 404, "Ended seller Live remains public");

const afterStopPlan = await json("/api/live/checkout/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ liveId, productId: "LOT-E2E", qty: 1, customerEmail: `after-${buyer.email}`, customerName: "Buyer", provider: "paypal", amount: 20 })
});
assert(afterStopPlan.response.status === 409, "Ended seller Live still accepts payment");

const reopen = await auth(sellerAccountA.token, `/api/live/seller/sessions/${liveId}/start`, {
  method: "POST",
  body: "{}"
});
assert(reopen.response.status === 409, "Ended seller Live can be reopened");

console.log("LIVE_SELLER_CORE_E2E_PASS");
