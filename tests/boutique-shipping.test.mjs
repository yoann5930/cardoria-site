import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  boutiqueTrackingUrl,
  colissimoLabelBlock,
  isMondialRelayOrder,
  normalizePickupPoint,
  publicClientOrder,
  resolveBoutiqueOrderWeight,
  resolveBoutiqueShippingSelection
} from "../backend/lib/boutique/shipping.js";

const pickup = {
  id: "012345",
  name: "Tabac du Centre",
  address: "10 rue des Arts",
  postalCode: "59300",
  city: "Valenciennes"
};

test("Mondial Relay pickup is required and normalized without dropping identity fields", () => {
  const point = normalizePickupPoint({ ...pickup, street: "10 rue des Arts", houseNumber: "", sendcloudServicePointId: "987654321" });
  assert.equal(point.id, "012345");
  assert.equal(point.name, "Tabac du Centre");
  assert.equal(point.address, "10 rue des Arts");
  assert.equal(point.postalCode, "59300");
  assert.equal(point.city, "Valenciennes");
  assert.equal(point.sendcloudServicePointId, "987654321");
  const selected = resolveBoutiqueShippingSelection({ shippingMethod: "mondial_relay", pickupPoint: pickup });
  assert.equal(selected.carrier, "Mondial Relay");
  assert.equal(selected.pickupPoint.id, "012345");
  assert.throws(() => resolveBoutiqueShippingSelection({ shippingMethod: "mondial_relay" }), /Point Relais/);
});

test("unknown parcel weight never invents grams and blocks Colissimo labels", () => {
  const order = {
    paymentStatus: "paid",
    status: "À préparer",
    carrier: "Colissimo (La Poste)",
    items: [{ ref: "PKM-1", name: "Carte", qty: 2 }]
  };
  const weight = resolveBoutiqueOrderWeight(order);
  assert.equal(weight.known, false);
  assert.equal(weight.grams, null);
  const block = colissimoLabelBlock(order);
  assert.equal(block.code, "COLISSIMO_WEIGHT_REQUIRED");
  assert.equal(block.status, 400);
});

test("catalog or admin weight can be used, but a second label stays locked", () => {
  const order = {
    paymentStatus: "paid",
    status: "À préparer",
    carrier: "Colissimo (La Poste)",
    items: [{ ref: "PKM-1", name: "Carte", qty: 2, shippingWeightGrams: 15 }]
  };
  assert.equal(resolveBoutiqueOrderWeight(order).grams, 30);
  assert.equal(colissimoLabelBlock(order), null);
  assert.equal(colissimoLabelBlock({ ...order, colissimoParcelNumber: "6A1" }).code, "COLISSIMO_LABEL_ALREADY_CREATED");
  assert.equal(colissimoLabelBlock({
    ...order,
    colissimoLabelAttempt: { status: "creation_pending", requestedAt: new Date().toISOString() }
  }).code, "COLISSIMO_LABEL_IN_PROGRESS");
});

test("Mondial Relay orders cannot buy a Colissimo label", () => {
  const order = { paymentStatus: "paid", shippingMethod: "mondial_relay", pickupPoint: pickup, items: [{ shippingWeightGrams: 80, qty: 1 }] };
  assert.equal(isMondialRelayOrder(order), true);
  assert.equal(colissimoLabelBlock(order).code, "COLISSIMO_WRONG_CARRIER");
});

test("client order payload never leaks internals and keeps pickup + tracking URL", () => {
  const exposed = publicClientOrder({
    id: "CMD-1",
    date: "2026-09-21",
    email: "a@example.com",
    paymentStatus: "paid",
    status: "Expédiée",
    shipping: "Mondial Relay Point Relais",
    shippingMethod: "mondial_relay",
    carrier: "Mondial Relay",
    tracking: "TRACK-1",
    pickupPoint: pickup,
    address: "SECRET-ADDRESS",
    phone: "SECRET-PHONE",
    internalNote: "SECRET-NOTE",
    sumupCheckoutId: "SECRET-SUMUP",
    total: 12
  });
  const json = JSON.stringify(exposed);
  assert.equal(exposed.status, "Expédiée");
  assert.equal(exposed.statusLabel, "Commande expédiée");
  assert.equal(exposed.delivery.pickupPoint.id, "012345");
  assert.equal(exposed.trackingUrl, boutiqueTrackingUrl("Mondial Relay", "TRACK-1"));
  assert.equal(json.includes("SECRET-"), false);
  assert.equal("phone" in exposed, false);
  assert.equal("internalNote" in exposed, false);
  assert.equal("sumupCheckoutId" in exposed, false);
});

test("checkout persists Point Relais and preparation triggers one real shipment flow", () => {
  const checkout = fs.readFileSync("backend/lib/boutique/checkout.js", "utf8");
  const boutique = fs.readFileSync("js/boutique.js", "utf8");
  const admin = fs.readFileSync("js/admin/admin-orders.js", "utf8");
  const client = fs.readFileSync("js/client-orders.js", "utf8");
  const routes = fs.readFileSync("backend/routes/payments-admin.js", "utf8");
  const creation = fs.readFileSync("backend/lib/boutique/shipment-creation.js", "utf8");

  assert.match(checkout, /pickupPoint: selection\.pickupPoint/);
  assert.match(boutique, /shippingMethod: shippingMethod\(\)/);
  assert.match(boutique, /\/api\/sendcloud\/service-points/);
  assert.match(boutique, /sendcloudServicePointId/);
  assert.match(admin, /data-shipping-label/);
  assert.match(admin, /Marquer comme expédiée/);
  assert.match(admin, /readonly placeholder="Enregistré par le parcours d’expédition"/);
  assert.doesNotMatch(admin, /data-colissimo-create|Synchroniser suivi Sendcloud|autoSyncRelayTracking/);
  assert.match(client, /Commande expédiée/);
  assert.match(client, /POINT RELAIS MONDIAL RELAY/);
  assert.match(routes, /createBoutiqueShipmentForPreparation/);
  assert.match(routes, /ADMIN_SHIPPING_READ_ONLY/);
  assert.match(creation, /creation_pending/);
  assert.match(creation, /reconciliation_required/);
  assert.match(creation, /findSendcloudShipmentByOrderNumber/);
  const sumup = fs.readFileSync("backend/lib/payments/sumup.js", "utf8");
  assert.match(sumup, /o\.shipmentStatus\s*=\s*shipmentStatusOf\(o\)/);
});
