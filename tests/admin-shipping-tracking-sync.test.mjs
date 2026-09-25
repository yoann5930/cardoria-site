import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("Boutique preparation status is the only admin trigger for real label creation", () => {
  const route = read("backend/routes/payments-admin.js");
  const flow = read("backend/lib/boutique/shipment-creation.js");
  const ui = read("js/admin/admin-orders.js");

  assert.match(route, /nextStatus === "En préparation"/);
  assert.match(route, /createBoutiqueShipmentForPreparation\(current\.id/);
  assert.match(route, /shipmentCreated/);
  assert.match(flow, /createSendcloudShipment/);
  assert.match(flow, /createColissimoLabel/);
  assert.match(flow, /shipmentCreation = \{[\s\S]*status: "creation_pending"/);
  assert.match(flow, /reconciliation_required/);
  assert.doesNotMatch(ui, /data-colissimo-create|Synchroniser suivi Sendcloud|autoSyncRelayTracking/);
  assert.match(ui, /readonly placeholder="Enregistré par le parcours d’expédition"/);
  assert.match(ui, /Le passage à <strong>En préparation<\/strong> crée automatiquement l’étiquette réelle/);
});

test("Boutique missing relay can be repaired explicitly before preparation", () => {
  const route = read("backend/routes/payments-admin.js");
  const ui = read("js/admin/admin-orders.js");

  assert.match(route, /boutique-orders\/:id\/relay-options/);
  assert.match(route, /boutique-orders\/:id\/pickup-point/);
  assert.match(route, /searchMondialRelayServicePoints/);
  assert.match(route, /normalizePickupPoint/);
  assert.match(route, /Choisissez un Point Relais Mondial Relay avant de passer la commande en préparation/);
  assert.match(ui, /data-relay-options/);
  assert.match(ui, /data-relay-select/);
  assert.match(ui, /data-relay-save/);
  assert.match(ui, /Point Relais enregistré\. Vous pouvez maintenant passer la commande en préparation/);
});

test("Boutique label creation persists tracking and exposes only download/print afterwards", () => {
  const route = read("backend/routes/payments-admin.js");
  const flow = read("backend/lib/boutique/shipment-creation.js");
  const ui = read("js/admin/admin-orders.js");

  assert.match(flow, /current\.tracking = clean\(shipment\.trackingNumber/);
  assert.match(flow, /current\.sendcloudParcelId/);
  assert.match(flow, /current\.colissimoParcelNumber/);
  assert.match(flow, /current\.status = "En préparation"/);
  assert.match(route, /boutique-orders\/:id\/shipping-label/);
  assert.match(ui, /data-shipping-label/);
  assert.match(ui, /data-shipping-print/);
  assert.match(ui, /\/shipping-label/);
  assert.match(route, /ADMIN_SHIPPING_READ_ONLY/);
});

test("Marketplace admin remains read-only for carrier creation and tracking", () => {
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
