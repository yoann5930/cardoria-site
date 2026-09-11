import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../routes/live-realtime.js", import.meta.url), "utf8");
const transport = fs.readFileSync(new URL("../lib/live/cloudflare-realtime.js", import.meta.url), "utf8");
const registry = fs.readFileSync(new URL("../lib/live/realtime-sessions.js", import.meta.url), "utf8");
const live = fs.readFileSync(new URL("../routes/live.js", import.meta.url), "utf8");
const viewer = fs.readFileSync(new URL("../../js/cardoria-live-viewer.js", import.meta.url), "utf8");
const publisher = fs.readFileSync(new URL("../../js/cardoria-live-publisher.js", import.meta.url), "utf8");
const livePage = fs.readFileSync(new URL("../../live.html", import.meta.url), "utf8");

test("Live API mounts the WebRTC transport", () => {
  assert.match(live, /router\.use\("\/webrtc", liveRealtimeRoutes\)/);
  assert.match(route, /\/publisher\/start/);
  assert.match(route, /\/publisher\/stop/);
  assert.match(route, /\/viewer\/start/);
  assert.match(route, /\/viewer\/answer/);
  assert.match(route, /\/viewer\/heartbeat/);
  assert.match(route, /\/viewer\/stop/);
});

test("Cloudflare credentials stay server side", () => {
  assert.match(transport, /CLOUDFLARE_REALTIME_APP_ID/);
  assert.match(transport, /CLOUDFLARE_REALTIME_APP_SECRET/);
  assert.match(transport, /Authorization: `Bearer \$\{secret\}`/);
  assert.doesNotMatch(route, /APP_SECRET/);
});

test("Realtime registry expires viewers and binds publishers to Cardoria live sessions", () => {
  assert.match(registry, /VIEWER_TTL_MS = 90_000/);
  assert.match(registry, /getLiveSession\(liveId\)/);
  assert.match(registry, /LIVE_PUBLISHER_MISMATCH/);
  assert.match(registry, /heartbeatRealtimeViewer/);
});

test("Realtime provider is Cloudflare and does not change payment routing", () => {
  assert.match(route, /provider: "cloudflare-realtime"/);
  assert.match(live, /PAYMENT_MATRIX/);
  assert.match(live, /provider: "paypal"/);
});

test("frontend Live uses Cardoria WebRTC and has no Render studio dependency", () => {
  assert.doesNotMatch(viewer, /onrender\.com/);
  assert.doesNotMatch(viewer, /whatnot-live/);
  assert.doesNotMatch(livePage, /onrender\.com/);
  assert.doesNotMatch(livePage, /whatnot-live/);
  assert.match(viewer, /\/api\/live\/webrtc\/viewer\/start/);
  assert.match(viewer, /\/api\/live\/sessions\?status=live/);
  assert.match(publisher, /getUserMedia/);
  assert.match(publisher, /\/api\/live\/webrtc\/publisher\/start/);
  assert.match(registry, /super_admin/);
  assert.match(registry, /LIVE_PUBLISHER_ADMIN_ROLES/);
});

test("Cardoria admin roles can publish Admin Live; sellers cannot", async () => {
  const { isLivePublisher } = await import("../lib/live/realtime-sessions.js");
  const live = { ownerRole: "admin", ownerId: "cardoria", status: "live" };
  assert.equal(isLivePublisher(live, { role: "super_admin", id: "u1" }), true);
  assert.equal(isLivePublisher(live, { role: "admin", id: "u1" }), true);
  assert.equal(isLivePublisher(live, { role: "employee", id: "u1" }), true);
  assert.equal(isLivePublisher(live, { role: "seller", id: "s1", sellerId: "s1" }), false);
  assert.equal(isLivePublisher({ ownerRole: "seller", ownerId: "s1", status: "live" }, { role: "seller", id: "s1", sellerId: "s1" }), true);
  assert.equal(isLivePublisher({ ownerRole: "seller", ownerId: "A", status: "live" }, { role: "seller", id: "B", sellerId: "B" }), false);
  assert.equal(isLivePublisher(live, { role: "client", id: "c1" }), false);
  assert.equal(isLivePublisher(live, null), false);
});
