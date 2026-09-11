import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sessions = fs.readFileSync(new URL("../lib/live/sessions.js", import.meta.url), "utf8");
const realtime = fs.readFileSync(new URL("../lib/live/realtime-sessions.js", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../routes/live-realtime.js", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../../js/admin/admin-live.js", import.meta.url), "utf8");
const phone = fs.readFileSync(new URL("../../live-camera.html", import.meta.url), "utf8");

test("Live room can be created without product or price", () => {
  assert.match(sessions, /normalizeProducts\(raw\)\{if\(!Array\.isArray\(raw\)\|\|!raw\.length\)return \[\];/);
  assert.match(sessions, /products=\[\]/);
  assert.match(admin, /products:\[\]/);
  assert.doesNotMatch(admin, /19,90|9,90|Revolut/i);
});

test("Cardoria admin UI exposes SumUp and seller PayPal", () => {
  assert.match(admin, /Cardoria\/Admin = SumUp/);
  assert.match(admin, /Vendeur tiers = PayPal/);
});

test("Live supports two publishers and secure phone pairing", () => {
  assert.match(realtime, /MAX_PUBLISHERS_PER_LIVE = 2/);
  assert.match(realtime, /createPublisherPair/);
  assert.match(realtime, /PAIR_TTL_MS = 10 \* 60_000/);
  assert.match(routes, /\/publisher\/pair/);
  assert.match(routes, /pairToken/);
  assert.match(admin, /Caméra 2 \/ téléphone/);
  assert.match(phone, /pairToken:pair/);
});

test("phone pair token is one-use and not stored in clear", () => {
  assert.match(realtime, /createHash\("sha256"\)/);
  assert.match(realtime, /pair\.used = true/);
  assert.match(realtime, /publisherPairs\.delete\(hash\)/);
});
