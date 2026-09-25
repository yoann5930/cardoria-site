import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("Boutique admin syncs Mondial Relay tracking from Sendcloud", () => {
  const route = read("backend/routes/payments-admin.js");
  const ui = read("js/admin/admin-orders.js");
  assert.match(route, /boutique-orders\/:id\/sync-shipping/);
  assert.match(route, /findSendcloudShipmentByOrderNumber\(order\.id\)/);
  assert.match(ui, /Synchroniser suivi Sendcloud/);
  assert.match(ui, /autoSyncRelayTracking/);
});

test("Marketplace admin exposes Sendcloud tracking sync", () => {
  const route = read("backend/routes/marketplace-admin.js");
  const ui = read("js/admin/admin-marketplace.js");
  assert.match(route, /orders\/:id\/sync-shipping/);
  assert.match(route, /findSendcloudShipmentByOrderNumber\(order\.id\)/);
  assert.match(ui, /Synchroniser Sendcloud/);
});

test("Live admin renders backend shipment tracking numbers", () => {
  const route = read("backend/routes/live-admin.js");
  const ui = read("js/admin/admin-live.js");
  assert.match(route, /listLiveShipments/);
  assert.match(ui, /liveShipmentsBody/);
  assert.match(ui, /trackingNumber/);
});
