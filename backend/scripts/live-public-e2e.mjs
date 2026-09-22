const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const password = "Live-Public-E2E-Password-2026!";

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

const email = `live-public-${suffix}@cardoria.invalid`;
const registration = await json("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, name: "Live Public Seller" })
});
assert(registration.response.status === 201 && registration.body.token && registration.body.user?.id, "Seller client registration failed");
const token = registration.body.token;

const sellerRegistration = await auth(token, "/api/marketplace/v1/paypal/sellers/register", {
  method: "POST",
  body: JSON.stringify({ displayName: "Live Public Seller", sellerType: "individual" })
});
assert(sellerRegistration.response.status === 200 && sellerRegistration.body.seller?.id, "Seller profile registration failed");

const maliciousTitle = `<img src=x onerror=alert(1)> Live Public ${suffix}`;
const maliciousProduct = `<script>alert(1)</script> Booster ${suffix}`;
const created = await auth(token, "/api/live/seller/sessions", {
  method: "POST",
  body: JSON.stringify({
    title: maliciousTitle,
    products: [{ id: `LOT-${suffix}`, name: maliciousProduct, qty: 1, stock: 1, price: 9.9, mode: "buy_now" }]
  })
});
assert(created.response.status === 200 && created.body.session?.id, "Seller live creation failed");
assert(created.body.session.status === "draft", "New seller live should start as draft");
const liveId = created.body.session.id;

const draftDirectory = await json("/api/live/sessions");
assert(draftDirectory.response.status === 200, "Public live directory unavailable");
assert(!draftDirectory.body.sessions?.some((session) => session.id === liveId), "Draft live leaks into public directory");

const draftDetail = await json(`/api/live/sessions/${encodeURIComponent(liveId)}`);
assert(draftDetail.response.status === 404, "Draft live detail is publicly accessible");
const draftRealtime = await json(`/api/live/webrtc/status/${encodeURIComponent(liveId)}`);
assert(draftRealtime.response.status === 404, "Draft realtime status is publicly accessible");
const draftState = await json(`/api/live/actions/${encodeURIComponent(liveId)}/state`);
assert(draftState.response.status === 404, "Draft live action state is publicly accessible");
const draftViewer = await json("/api/live/webrtc/viewer/start", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ liveSessionId: liveId })
});
assert(draftViewer.response.status === 404, "Viewer can join a draft live");

// An incomplete sender profile must not silently pass the new live prerequisite.
const incomplete = await auth(token, `/api/live/seller/sessions/${encodeURIComponent(liveId)}/start`, { method: "POST", body: "{}" });
assert(incomplete.response.status === 409, "Missing sender address did not block live start");
const sellerId = sellerRegistration.body.seller.id;
const sender = await auth(token, `/api/marketplace/v1/sellers/${encodeURIComponent(sellerId)}/sender-profile`, {
  method: "PUT",
  body: JSON.stringify({ name: "Live Public Seller", addressLine1: "12 rue Test", postalCode: "59330", city: "Hautmont", countryCode: "FR", phone: "0600000000" })
});
assert(sender.response.status === 200 && sender.body.ready === true, "Sender profile setup failed");
const started = await auth(token, `/api/live/seller/sessions/${encodeURIComponent(liveId)}/start`, { method: "POST", body: "{}" });
assert(started.response.status === 200 && started.body.session?.status === "live", "Seller live start failed");

const directory = await json("/api/live/sessions");
assert(directory.response.status === 200, "Public live directory failed after start");
const listed = directory.body.sessions?.find((session) => session.id === liveId);
assert(listed, "Started live missing from public directory");
assert(!/[<>]/.test(String(listed.title || "")), "Public live title contains HTML markup characters");
assert(!/[<>]/.test(String(listed.products?.[0]?.name || "")), "Public product name contains HTML markup characters");
assert(!JSON.stringify(listed).includes("ownerEmail"), "Public live leaks ownerEmail");
assert(!JSON.stringify(listed).includes("<script") && !JSON.stringify(listed).includes("<img"), "Public live leaks executable markup");
assert(!JSON.stringify(listed).includes("12 rue Test"), "Public live leaks sender address");

const detail = await json(`/api/live/sessions/${encodeURIComponent(liveId)}`);
assert(detail.response.status === 200 && detail.body.session?.id === liveId, "Active live public detail unavailable");
assert(!JSON.stringify(detail.body.session).includes("ownerEmail"), "Public live detail leaks ownerEmail");
assert(!/[<>]/.test(String(detail.body.session?.title || "")), "Public live detail title is not sanitized");

const realtimeStatus = await json(`/api/live/webrtc/status/${encodeURIComponent(liveId)}`);
assert(realtimeStatus.response.status === 200 && realtimeStatus.body.liveId === liveId, "Active live realtime status unavailable");
const state = await json(`/api/live/actions/${encodeURIComponent(liveId)}/state`);
assert(state.response.status === 200 && state.body.ok === true, "Active live public action state unavailable");

const anonymousChat = await json(`/api/live/actions/${encodeURIComponent(liveId)}/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Anonymous", message: "Je ne dois pas pouvoir écrire" })
});
assert(anonymousChat.response.status === 401 && anonymousChat.body.code === "CLIENT_LOGIN_REQUIRED", "Anonymous viewer can write in live chat");
const accountChat = await auth(token, `/api/live/actions/${encodeURIComponent(liveId)}/chat`, {
  method: "POST",
  body: JSON.stringify({ name: "Forged nickname", message: "Bonjour depuis mon compte" })
});
assert(accountChat.response.status === 200, "Authenticated client cannot write in live chat");
assert(accountChat.body.message?.name === "Live Public Seller", "Live chat did not reuse account name");
assert(accountChat.body.message?.name !== "Forged nickname", "Live chat trusts forged browser nickname");
const publicChat = await json(`/api/live/actions/${encodeURIComponent(liveId)}/chat`);
assert(publicChat.response.status === 200 && publicChat.body.messages?.some((entry) => entry.message === "Bonjour depuis mon compte" && entry.name === "Live Public Seller"), "Public live chat does not expose authenticated message");

const noCameraViewer = await json("/api/live/webrtc/viewer/start", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ liveSessionId: liveId })
});
assert(noCameraViewer.response.status === 404 && noCameraViewer.body.code === "LIVE_STREAM_NOT_PUBLISHED", "Viewer start without a published camera is not rejected correctly");
const anonymousAdminAccess = await json(`/api/live/sessions/${encodeURIComponent(liveId)}/admin-access`);
assert(anonymousAdminAccess.response.status === 401, "Anonymous viewer obtained admin live access");
const stopped = await auth(token, `/api/live/seller/sessions/${encodeURIComponent(liveId)}/stop`, { method: "POST", body: "{}" });
assert(stopped.response.status === 200 && stopped.body.session?.status === "ended", "Seller live stop failed");
const endedDirectory = await json("/api/live/sessions");
assert(!endedDirectory.body.sessions?.some((session) => session.id === liveId), "Ended live remains in public directory");
const endedDetail = await json(`/api/live/sessions/${encodeURIComponent(liveId)}`);
assert(endedDetail.response.status === 404, "Ended live detail remains publicly accessible");
const endedRealtime = await json(`/api/live/webrtc/status/${encodeURIComponent(liveId)}`);
assert(endedRealtime.response.status === 404, "Ended live realtime status remains publicly accessible");
const endedState = await json(`/api/live/actions/${encodeURIComponent(liveId)}/state`);
assert(endedState.response.status === 404, "Ended live action state remains publicly accessible");
console.log("LIVE_PUBLIC_E2E_PASS");
