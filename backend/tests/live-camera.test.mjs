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
import {
  LIVE_PERMISSIONS_POLICY,
  buildGetUserMediaAttempts,
  explainGetUserMediaError,
  isMobileUserAgent,
  permissionStateBlocksCamera
} from "../lib/live/camera-media.js";
import { __resetRealtimeStoreForTests } from "../lib/live/realtime-sessions.js";
import { __resetLiveStoreForTests, __setLiveStoreForTests } from "../lib/live/sessions.js";
import { applySecurityMiddleware } from "../lib/security/index.js";
import liveRoutes from "../routes/live.js";
import liveAdminRoutes from "../routes/live-admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");
const readRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const DUMMY_OFFER = {
  type: "offer",
  sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n"
};
const DUMMY_TRACKS = [{ mid: "0", trackName: "primary-camera", kind: "video" }];

function seedCameraLive() {
  __setLiveStoreForTests({
    sessions: [{
      id: "LIVE-CAM-ADMIN",
      title: "Live caméra admin",
      ownerRole: "admin",
      ownerId: "cardoria",
      status: "live",
      products: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    checkouts: [],
    adminAccess: []
  });
}

async function withServer(fn) {
  const app = express();
  applySecurityMiddleware(app);
  app.use(express.json());
  app.get("/admin-live.html", (req, res) => res.status(200).type("html").send("<html>admin-live</html>"));
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
    __resetRealtimeStoreForTests();
  }
}

async function requestJson(base, pathname, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, headers: response.headers };
}

function makeAdmin(suffix) {
  migrateAuth();
  const email = `live-cam-admin-${suffix}-${Math.random().toString(16).slice(2)}@cardoria.test`;
  const user = createUser({ email, password: "LiveCameraPass1!", role: "admin", name: "Cam Admin" });
  const session = createSession(user.id, { ip: "127.0.0.1", userAgent: "live-camera-test" });
  return {
    user,
    token: session.token,
    cleanup() {
      const db = getDb();
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM auth_users WHERE id = ?").run(user.id);
    }
  };
}

test("Permissions-Policy autorise camera=(self) et microphone=(self)", () => {
  assert.equal(LIVE_PERMISSIONS_POLICY, "camera=(self), microphone=(self), geolocation=(), payment=(self)");
  const security = readRepo("backend/lib/security/index.js");
  assert.match(security, /LIVE_PERMISSIONS_POLICY/);
  assert.doesNotMatch(security, /camera=\(\)/);
  assert.match(security, /media-src 'self' blob:/);
  const nginx = readRepo("oracle/nginx-cardoria-ssl.conf");
  assert.doesNotMatch(nginx, /add_header\s+["']?Permissions-Policy/i);
});

test("contraintes getUserMedia : PC sans environment, téléphone arrière puis avant", () => {
  assert.equal(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
  assert.equal(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  const desktop = buildGetUserMediaAttempts({ isMobile: false });
  assert.equal(desktop.some((item) => JSON.stringify(item).includes("environment")), false);
  assert.equal(desktop[0].video, true);
  const mobile = buildGetUserMediaAttempts({ isMobile: true });
  assert.deepEqual(mobile[0].video, { facingMode: { ideal: "environment" } });
  assert.deepEqual(mobile[1].video, { facingMode: { ideal: "user" } });
});

test("messages français pour NotAllowedError et les autres erreurs média", () => {
  const denied = explainGetUserMediaError({ name: "NotAllowedError", message: "Permission denied" });
  assert.equal(denied.code, "NotAllowedError");
  assert.equal(denied.retry, true);
  assert.match(denied.text, /autorisez Caméra et Microphone/i);
  assert.match(denied.text, /cardoriashop\.fr/);
  assert.doesNotMatch(denied.text, /^Permission denied$/);
  assert.equal(explainGetUserMediaError({ name: "NotFoundError" }).code, "NotFoundError");
  assert.equal(explainGetUserMediaError({ name: "NotReadableError" }).code, "NotReadableError");
  assert.equal(explainGetUserMediaError({ name: "OverconstrainedError" }).code, "OverconstrainedError");
  assert.equal(permissionStateBlocksCamera({ camera: "denied" }), true);
});

test("frontend admin/publisher : pas d’alerte Permission denied, pas de facingMode forcé PC", () => {
  const admin = readRepo("js/admin/admin-live.js");
  assert.match(admin, /Caméra 1/);
  assert.match(admin, /Caméra 2 PC/);
  assert.match(admin, /Caméra 2 \/ téléphone/);
  assert.match(admin, /Réessayer/);
  assert.match(admin, /Cardoria\/Admin = SumUp/);
  assert.match(admin, /isMobile: false/);
  assert.doesNotMatch(admin, /Permission denied/);
  assert.doesNotMatch(admin, /facingMode:\s*["']environment["']/);
  const publisher = readRepo("js/cardoria-live-publisher.js");
  assert.match(publisher, /CardoriaLiveMedia/);
  assert.match(publisher, /\/api\/live\/webrtc\/publisher\/start/);
  assert.doesNotMatch(publisher, /facingMode:\s*opts\.facingMode\s*\|\|\s*["']environment["']/);
  const media = readRepo("js/cardoria-live-media.js");
  assert.match(media, /NotAllowedError/);
  assert.match(media, /OverconstrainedError/);
  const cameraPage = readRepo("live-camera.html");
  assert.match(cameraPage, /pairToken:pair/);
  assert.match(cameraPage, /Réessayer/);
  assert.match(cameraPage, /isMobile: true/);
});

test("runtime : header Permissions-Policy sur admin-live.html", async () => {
  seedCameraLive();
  await withServer(async (base) => {
    const response = await fetch(base + "/admin-live.html");
    assert.equal(response.status, 200);
    const policy = String(response.headers.get("permissions-policy") || "");
    assert.equal(policy, LIVE_PERMISSIONS_POLICY);
    const csp = String(response.headers.get("content-security-policy") || "");
    assert.match(csp, /media-src 'self' blob:/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  });
});

test("webrtc pair/start sans Live → 404 ; publish, stop, reconnexion, spectateur", async () => {
  seedCameraLive();
  migrateAuth();
  const admin = makeAdmin(`${Date.now()}`);
  try {
    await withServer(async (base) => {
      const missing = await requestJson(base, "/api/live/webrtc/publisher/pair", {
        method: "POST",
        body: { liveSessionId: "LIVE-DOES-NOT-EXIST", sourceId: "secondary" },
        token: admin.token
      });
      assert.equal(missing.status, 404);

      const viewerBefore = await requestJson(base, "/api/live/webrtc/viewer/start", {
        method: "POST",
        body: { liveSessionId: "LIVE-CAM-ADMIN" }
      });
      assert.equal(viewerBefore.status, 404);

      const published = await requestJson(base, "/api/live/webrtc/publisher/start", {
        method: "POST",
        body: { liveSessionId: "LIVE-CAM-ADMIN", sourceId: "primary", offer: DUMMY_OFFER, tracks: DUMMY_TRACKS },
        token: admin.token
      });
      assert.equal(published.status, 200);
      assert.equal(published.data.mode, "p2p");

      const viewer = await requestJson(base, "/api/live/webrtc/viewer/start", {
        method: "POST",
        body: { liveSessionId: "LIVE-CAM-ADMIN" }
      });
      assert.equal(viewer.status, 200);
      assert.ok(viewer.data.viewerId);

      const stopped = await requestJson(base, "/api/live/webrtc/publisher/stop", {
        method: "POST",
        body: { liveSessionId: "LIVE-CAM-ADMIN", sourceId: "primary" },
        token: admin.token
      });
      assert.equal(stopped.status, 200);

      const afterStop = await requestJson(base, "/api/live/webrtc/viewer/start", {
        method: "POST",
        body: { liveSessionId: "LIVE-CAM-ADMIN" }
      });
      assert.equal(afterStop.status, 404);

      const reconnected = await requestJson(base, "/api/live/webrtc/publisher/start", {
        method: "POST",
        body: { liveSessionId: "LIVE-CAM-ADMIN", sourceId: "primary", offer: DUMMY_OFFER, tracks: DUMMY_TRACKS },
        token: admin.token
      });
      assert.equal(reconnected.status, 200);

      const pair = await requestJson(base, "/api/live/webrtc/publisher/pair", {
        method: "POST",
        body: { liveSessionId: "LIVE-CAM-ADMIN", sourceId: "secondary" },
        token: admin.token
      });
      assert.equal(pair.status, 200);
      assert.match(pair.data.url, /\/live-camera\.html#pair=/);
    });
  } finally {
    admin.cleanup();
    __resetLiveStoreForTests();
    __resetRealtimeStoreForTests();
  }
});
