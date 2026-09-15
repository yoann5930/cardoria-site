import { createUser } from "../lib/auth/users.js";
import { createSession } from "../lib/auth/session.js";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const OFFER = { type: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n" };
const VIDEO_TRACKS = [{ mid: "0", trackName: "primary-camera", kind: "video" }];
const AUDIO_TRACKS = [{ mid: "0", trackName: "primary-microphone", kind: "audio" }];

function assert(condition, message) { if (!condition) throw new Error(message); }
async function request(path, options = {}) {
  const response = await fetch(BASE + path, options);
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}
function auth(token, path, options = {}) {
  return request(path, {
    ...options,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
}

const admin = createUser({ email: `camera1-admin-${suffix}@cardoria.invalid`, password: "Camera1-E2E-2026!", role: "admin", name: "Camera 1 Admin" });
const client = createUser({ email: `camera1-client-${suffix}@cardoria.invalid`, password: "Camera1-Client-2026!", role: "client", name: "Camera 1 Client" });
const adminToken = createSession(admin.id).token;
const clientToken = createSession(client.id).token;

const create = await auth(adminToken, "/api/admin/live/sessions", { method: "POST", body: JSON.stringify({ title: `Camera 1 E2E ${suffix}`, ownerRole: "admin", products: [] }) });
assert(create.response.status === 200 && create.body.session?.id, "Cannot create Admin Live for Camera 1 test");
const liveId = create.body.session.id;

const beforeLive = await auth(adminToken, "/api/live/webrtc/publisher/start", { method: "POST", body: JSON.stringify({ liveSessionId: liveId, sourceId: "primary", offer: OFFER, tracks: VIDEO_TRACKS }) });
assert(beforeLive.response.status === 404, "Camera 1 can publish before Live starts");

const startLive = await auth(adminToken, `/api/admin/live/sessions/${encodeURIComponent(liveId)}/start`, { method: "POST", body: "{}" });
assert(startLive.response.status === 200 && startLive.body.session?.status === "live", "Cannot start Live for Camera 1 test");

const unauth = await request("/api/live/webrtc/publisher/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liveSessionId: liveId, sourceId: "primary", offer: OFFER, tracks: VIDEO_TRACKS }) });
assert(unauth.response.status >= 400, "Anonymous user can publish Camera 1");

const clientPublish = await auth(clientToken, "/api/live/webrtc/publisher/start", { method: "POST", body: JSON.stringify({ liveSessionId: liveId, sourceId: "primary", offer: OFFER, tracks: VIDEO_TRACKS }) });
assert(clientPublish.response.status >= 400, "Client account can publish Camera 1");

const audioOnly = await auth(adminToken, "/api/live/webrtc/publisher/start", { method: "POST", body: JSON.stringify({ liveSessionId: liveId, sourceId: "primary", offer: OFFER, tracks: AUDIO_TRACKS }) });
assert(audioOnly.response.status === 400 && audioOnly.body.code === "LIVE_CAMERA_VIDEO_TRACK_REQUIRED", "Camera 1 accepts an audio-only publisher as a camera");

const published = await auth(adminToken, "/api/live/webrtc/publisher/start", { method: "POST", body: JSON.stringify({ liveSessionId: liveId, sourceId: "primary", offer: OFFER, tracks: VIDEO_TRACKS }) });
assert(published.response.status === 200, "Camera 1 primary publication failed");
assert(published.body.sourceId === "primary", "Camera 1 source is not primary");
assert(["p2p", "cloudflare"].includes(String(published.body.mode || "")), "Camera 1 publication returned invalid mode");

const status = await request(`/api/live/webrtc/status/${encodeURIComponent(liveId)}`);
assert(status.response.status === 200 && status.body.published === true, "Camera 1 is not reported as published");
assert(status.body.sources?.includes("primary"), "Camera 1 primary source missing from realtime status");
assert(Number(status.body.publishers || 0) === 1, "Unexpected publisher count after Camera 1 start");

const viewer = await request("/api/live/webrtc/viewer/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liveSessionId: liveId }) });
assert(viewer.response.status === 200 && viewer.body.viewerId, "Spectator cannot subscribe after Camera 1 publication");
assert(Number(viewer.body.sourceCount || 0) === 1, "Spectator does not see exactly one Camera 1 source");

const stopped = await auth(adminToken, "/api/live/webrtc/publisher/stop", { method: "POST", body: JSON.stringify({ liveSessionId: liveId, sourceId: "primary" }) });
assert(stopped.response.status === 200 && Number(stopped.body.sourceCount || 0) === 0, "Camera 1 stop failed");

const statusAfterStop = await request(`/api/live/webrtc/status/${encodeURIComponent(liveId)}`);
assert(statusAfterStop.response.status === 200 && statusAfterStop.body.published === false, "Camera 1 remains published after stop");

const viewerAfterStop = await request("/api/live/webrtc/viewer/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liveSessionId: liveId }) });
assert(viewerAfterStop.response.status === 404, "Spectator can start after Camera 1 stopped");

const reconnected = await auth(adminToken, "/api/live/webrtc/publisher/start", { method: "POST", body: JSON.stringify({ liveSessionId: liveId, sourceId: "primary", offer: OFFER, tracks: VIDEO_TRACKS }) });
assert(reconnected.response.status === 200, "Camera 1 cannot reconnect after stop");

console.log("CAMERA1_CORE_E2E_PASS");
