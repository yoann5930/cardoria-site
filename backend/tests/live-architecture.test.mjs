import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PAYMENT_MATRIX, RETIRED_PROVIDERS, assertSaleProvider, assertServerAmount, resolvePaymentRoute } from "../lib/payments/routing.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const norm = (text) => text.replace(/\r\n/g, "\n");

const LIVE_RUNTIME = [
  "live.html",
  "live-vendeur.html",
  "admin-live.html",
  "live-camera.html",
  "js/cardoria-live-viewer.js",
  "js/cardoria-live-publisher.js",
  "js/cardoria-live-media.js",
  "js/live-vendeur.js",
  "js/admin/admin-live.js",
  "js/live-studio-actions-ui.js",
  "backend/public/live.html",
  "backend/public/live-vendeur.html",
  "backend/public/admin-live.html",
  "backend/public/live-camera.html",
  "backend/public/js/cardoria-live-viewer.js",
  "backend/public/js/cardoria-live-publisher.js",
  "backend/public/js/cardoria-live-media.js",
  "backend/public/js/live-vendeur.js",
  "backend/public/js/admin/admin-live.js",
  "backend/public/js/live-studio-actions-ui.js",
  "backend/routes/live.js",
  "backend/routes/live-realtime.js",
  "backend/routes/live-admin.js"
];

const MIRRORS = [
  ["live.html", "backend/public/live.html"],
  ["live-vendeur.html", "backend/public/live-vendeur.html"],
  ["admin-live.html", "backend/public/admin-live.html"],
  ["js/cardoria-live-viewer.js", "backend/public/js/cardoria-live-viewer.js"],
  ["js/cardoria-live-publisher.js", "backend/public/js/cardoria-live-publisher.js"],
  ["js/live-vendeur.js", "backend/public/js/live-vendeur.js"],
  ["js/admin/admin-live.js", "backend/public/js/admin/admin-live.js"],
  ["js/cardoria-live-media.js", "backend/public/js/cardoria-live-media.js"],
  ["js/live-studio-actions-ui.js", "backend/public/js/live-studio-actions-ui.js"],
  ["css/admin.css", "backend/public/css/admin.css"],
  ["live-camera.html", "backend/public/live-camera.html"]
];

test("Live payment architecture is SumUp admin + PayPal seller + retired Revolut", () => {
  assert.deepEqual(PAYMENT_MATRIX, {
    boutique: "sumup",
    live_admin: "sumup",
    live_seller: "paypal",
    marketplace: "paypal"
  });
  assert.equal(PAYMENT_MATRIX.live_admin, "sumup");
  assert.equal(PAYMENT_MATRIX.live_seller, "paypal");
  assert.deepEqual(RETIRED_PROVIDERS, ["revolut"]);
  assert.equal(resolvePaymentRoute({ channel: "live", ownerRole: "admin" }).provider, "sumup");
  assert.equal(resolvePaymentRoute({ channel: "live", ownerRole: "seller" }).provider, "paypal");
});

test("live matrix route never announces SumUp retired and never activates Revolut", () => {
  const live = read("backend/routes/live.js");
  assert.match(live, /retired:\s*\[\s*"revolut"\s*\]/);
  assert.doesNotMatch(live, /sumup:\s*"retired"/);
  assert.doesNotMatch(live, /live_admin:\s*"revolut"/);
  assert.doesNotMatch(read("backend/lib/payments/routing.js"), /live_admin:\s*"revolut"/);
});

test("frontend cannot change Live provider or amount", () => {
  assert.throws(
    () => assertSaleProvider({ channel: "live", ownerRole: "admin", requestedProvider: "paypal" }),
    (error) => error.status === 403 && error.expectedProvider === "sumup"
  );
  assert.throws(
    () => assertSaleProvider({ channel: "live", ownerRole: "seller", requestedProvider: "sumup" }),
    (error) => error.status === 403 && error.expectedProvider === "paypal"
  );
  assert.throws(
    () => assertSaleProvider({ channel: "live", ownerRole: "admin", requestedProvider: "revolut" }),
    (error) => error.status === 410 && error.expectedProvider === "sumup"
  );
  assert.throws(() => assertServerAmount(19.9, 1), (error) => error.status === 403);
});

test("active Live runtime has no Render studio dependency", () => {
  for (const relative of LIVE_RUNTIME) {
    const source = read(relative);
    assert.doesNotMatch(source, /whatnot-live-studio-api-b3n5\.onrender\.com/, relative);
    assert.doesNotMatch(source, /whatnot-live-studio-web-w1r2\.onrender\.com/, relative);
    assert.doesNotMatch(source, /whatnot-live/, relative);
  }
});

test("Live frontend mirrors stay identical", () => {
  for (const [source, mirror] of MIRRORS) {
    assert.equal(norm(read(source)), norm(read(mirror)), `${source} != ${mirror}`);
  }
});

test("viewer and publisher expose WebRTC lifecycle without infinite Render polling", () => {
  const viewer = read("js/cardoria-live-viewer.js");
  const publisher = read("js/cardoria-live-publisher.js");
  assert.match(viewer, /Service vidéo Live indisponible/);
  assert.match(viewer, /\/api\/live\/webrtc\/status/);
  assert.match(viewer, /\/api\/live\/webrtc\/viewer\/heartbeat/);
  assert.match(viewer, /\/api\/live\/webrtc\/viewer\/stop/);
  assert.match(publisher, /getUserMedia/);
  assert.match(publisher, /RTCPeerConnection/);
  assert.match(publisher, /track\.stop\(\)/);
  assert.match(publisher, /pc\.close\(\)/);
  assert.match(publisher, /\/api\/live\/webrtc\/publisher\/start/);
  assert.match(publisher, /\/api\/live\/webrtc\/publisher\/stop/);
});
