import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../routes/live-realtime.js", import.meta.url), "utf8");
const transport = fs.readFileSync(new URL("../lib/live/cloudflare-realtime.js", import.meta.url), "utf8");
const registry = fs.readFileSync(new URL("../lib/live/realtime-sessions.js", import.meta.url), "utf8");
const live = fs.readFileSync(new URL("../routes/live.js", import.meta.url), "utf8");

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
