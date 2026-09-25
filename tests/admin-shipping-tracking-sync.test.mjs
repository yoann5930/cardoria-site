import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("Boutique admin never contacts Sendcloud or creates a label", () => {
  const route = read("backend/routes/payments-admin.js");
  const ui = read("js/admin/admin-orders.js");
  assert.doesNotMatch(route, /boutique-orders\/:id\/sync-shipping/);
  assert.doesNotMatch(route, /findSendcloudShipmentByOrderNumber/);
  assert.doesNotMatch(route, /createColissimoLabel/);
  assert.match(route, /ADMIN_SHIPPING_READ_ONLY/);
  assert.doesNotMatch(ui, /Synchroniser suivi Sendcloud|autoSyncRelayTracking|data-colissimo-create/);
  assert.match(ui, /readonly placeholder="Enregistré par le parcours d’expédition"/);
  assert.match(ui, /l’Admin ne crée pas d’étiquette et ne récupère pas le suivi/);
});

test("Marketplace admin never contacts Sendcloud, creates a label or writes tracking", () => {
  const route = read("backend/routes/marketplace-admin.js");
  const ui = read("js/admin/admin-marketplace.js");
  assert.doesNotMatch(route, /orders\/:id\/sync-shipping/);
  assert.doesNotMatch(route, /findSendcloudShipmentByOrderNumber/);
  assert.doesNotMatch(route, /generateShippingLabel/);
  assert.match(route, /orders\/:id\/shipping-label/);
  assert.match(route, /orders\/:id\/tracking/);
  assert.match(route, /ADMIN_SHIPPING_READ_ONLY/);
  assert.doesNotMatch(ui, /Synchroniser Sendcloud|sync-shipping/);
  assert.match(ui, /<strong>Suivi :<\/strong>/);
  assert.match(ui, /\/status/);
  assert.doesNotMatch(ui, /\/tracking/);
});

test("Live admin only displays shipment data already persisted by the live flow", () => {
  const route = read("backend/routes/live-admin.js");
  const ui = read("js/admin/admin-live.js");
  assert.match(route, /listLiveShipments/);
  assert.match(ui, /liveShipmentsBody/);
  assert.match(ui, /trackingNumber/);
  assert.doesNotMatch(ui, /sendcloud|shipping-label|sync-shipping/i);
});
