import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sessions = fs.readFileSync(new URL("../lib/live/sessions.js", import.meta.url), "utf8");
const realtime = fs.readFileSync(new URL("../lib/live/realtime-sessions.js", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../routes/live-realtime.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../routes/live-admin.js", import.meta.url), "utf8");
const sellerRoutes = fs.readFileSync(new URL("../routes/live.js", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../../js/admin/admin-live.js", import.meta.url), "utf8");
const adminRuntime = fs.readFileSync(new URL("../public/js/admin/admin-live.js", import.meta.url), "utf8");
const seller = fs.readFileSync(new URL("../../js/live-vendeur.js", import.meta.url), "utf8");
const sellerRuntime = fs.readFileSync(new URL("../public/js/live-vendeur.js", import.meta.url), "utf8");
const phone = fs.readFileSync(new URL("../../live-camera.html", import.meta.url), "utf8");

test("Live rooms can be created without product or price for Admin and seller", () => {
  assert.match(sessions, /normalizeProducts\(raw\)\{if\(!Array\.isArray\(raw\)\|\|!raw\.length\)return \[\];/);
  assert.match(sessions, /products=\[\]/);
  assert.match(admin, /products:\[\]/);
  assert.match(seller, /products:\[\]/);
  assert.doesNotMatch(admin, /19,90|9,90|Revolut/i);
  assert.doesNotMatch(seller, /19\.90|9\.90|Revolut/i);
});

test("payment routing is explicit: Admin SumUp, seller PayPal", () => {
  assert.match(admin, /Cardoria\/Admin = SumUp/);
  assert.match(admin, /Vendeur tiers = PayPal/);
  assert.match(seller, /Paiement des ventes : PayPal/);
  assert.match(sellerRoutes, /provider: "paypal"/);
});

test("Admin and seller studios expose live payment paid pending failed states", () => {
  for (const source of [admin, seller]) {
    assert.match(source, /Autorisé \/ Payé/);
    assert.match(source, /Pending \/ En attente/);
    assert.match(source, /Refusé \/ Échoué/);
    assert.match(source, /setInterval\([^,]+,3000\)/);
  }
  assert.match(adminRoutes, /router\.get\("\/checkouts"/);
  assert.match(sellerRoutes, /router\.get\("\/seller\/checkouts"/);
});

test("frontend runtime mirrors are synchronized", () => {
  assert.equal(adminRuntime, admin);
  assert.equal(sellerRuntime, seller);
});

test("Live supports two publishers and secure phone pairing", () => {
  assert.match(realtime, /MAX_PUBLISHERS_PER_LIVE = 2/);
  assert.match(realtime, /createPublisherPair/);
  assert.match(realtime, /PAIR_TTL_MS = 10 \* 60_000/);
  assert.match(routes, /\/publisher\/pair/);
  assert.match(routes, /pairToken/);
  assert.match(admin, /Caméra 2 \/ téléphone/);
  assert.match(seller, /Caméra 2 \/ téléphone/);
  assert.match(phone, /pairToken:pair/);
});

test("phone pair token is one-use and not stored in clear", () => {
  assert.match(realtime, /createHash\("sha256"\)/);
  assert.match(realtime, /pair\.used = true/);
  assert.match(realtime, /publisherPairs\.delete\(hash\)/);
});
