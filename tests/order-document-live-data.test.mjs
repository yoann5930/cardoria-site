import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("document-commande.html", "utf8");
const runtimeHtml = fs.readFileSync("backend/public/document-commande.html", "utf8");
const js = fs.readFileSync("js/document-commande.js", "utf8");
const runtimeJs = fs.readFileSync("backend/public/js/document-commande.js", "utf8");
const adminRoutes = fs.readFileSync("backend/routes/payments-admin.js", "utf8");

test("order document uses the dedicated live-order client", () => {
  assert.match(html, /\/js\/document-commande\.js\?v=20260921-live-order-1/);
  assert.doesNotMatch(html, /script\.js\?v=6/);
  assert.equal(runtimeHtml, html);
  assert.equal(runtimeJs, js);
});

test("order document fetches only the exact Boutique order requested", () => {
  assert.match(js, /\/api\/admin\/payments\/boutique-orders\//);
  assert.match(js, /encodeURIComponent\(id\)/);
  assert.match(js, /String\(data\.order\.id\) !== id/);
  assert.match(js, /Authorization: "Bearer " \+ token/);
  assert.doesNotMatch(js, /orders\.json/);
  assert.doesNotMatch(js, /allOrders\[0\]/);
});

test("missing or unknown order can never fall back to a test order", () => {
  assert.match(js, /Commande introuvable/);
  assert.match(js, /response\.status === 404/);
  assert.match(js, /Aucun identifiant de commande n'a été fourni/);
});

test("server exposes one protected exact-order endpoint", () => {
  assert.match(adminRoutes, /router\.get\("\/boutique-orders\/:id"/);
  assert.match(adminRoutes, /const order = findBoutiqueOrder\(req\.params\.id\)/);
  assert.match(adminRoutes, /Commande Boutique introuvable/);
  assert.match(adminRoutes, /res\.json\(\{ ok: true, order \}\)/);
});
