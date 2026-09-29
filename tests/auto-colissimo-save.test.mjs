import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("js/admin/admin-orders.js", "utf8");
const runtime = fs.readFileSync("backend/public/js/admin/admin-orders.js", "utf8");
const route = fs.readFileSync("backend/routes/payments-admin.js", "utf8");
const flow = fs.readFileSync("backend/lib/boutique/shipment-creation.js", "utf8");

test("moving a paid Boutique order to En préparation creates the shipment server-side", () => {
  assert.match(route, /nextStatus === "En préparation"/);
  assert.match(route, /createBoutiqueShipmentForPreparation\(current\.id/);
  assert.match(route, /shipmentCreated/);
  assert.match(flow, /createColissimoLabel/);
  assert.match(flow, /createSendcloudShipment/);
});

test("tracking is persisted by the shipment flow before the admin UI reloads the order", () => {
  assert.match(flow, /current\.tracking = clean\(shipment\.trackingNumber/);
  assert.match(flow, /current\.colissimoParcelNumber = clean\(shipment\.parcelNumber/);
  assert.match(flow, /current\.status = "En préparation"/);
  assert.match(source, /savedTracking=String\(d\.order\?\.tracking\|\|""\)\.trim\(\)/);
});

test("an existing Colissimo parcel number is displayed as a tracking fallback", () => {
  assert.match(source, /o\.tracking\|\|o\.colissimoParcelNumber\|\|""/);
});

test("automatic label purchase remains gated by server-side Colissimo production readiness", () => {
  assert.match(flow, /getColissimoStatus\(\)/);
  assert.match(flow, /!status\.configured \|\| !status\.senderConfigured \|\| !status\.labelPurchasesEnabled/);
  assert.match(flow, /COLISSIMO_NOT_READY/);
});

test("admin no longer contains a second manual Colissimo label purchase path", () => {
  assert.doesNotMatch(source, /\/colissimo-label/);
  assert.doesNotMatch(source, /data-colissimo-create/);
  assert.match(source, /\/shipping-label/);
});

test("source and OVH runtime stay identical", () => {
  assert.equal(runtime, source);
});
