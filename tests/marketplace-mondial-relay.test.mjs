import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeMarketplacePickupPoint,
  resolveMarketplaceShippingSelection
} from "../backend/lib/marketplace/shipping.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("Mondial Relay pickup normalization preserves the carrier id including leading zeroes", () => {
  const point = normalizeMarketplacePickupPoint({
    id: "024688",
    carrierServicePointId: "024688",
    name: "ALL VAPS",
    street: "17 AVENUE MARCEL AIME",
    postalCode: "59330",
    city: "HAUTMONT",
    countryCode: "FR"
  });
  assert.ok(point);
  assert.equal(point.id, "024688");
  assert.equal(point.carrierServicePointId, "024688");
  assert.equal(point.address, "17 AVENUE MARCEL AIME");
  assert.equal(point.carrierCode, "mondial_relay");
});

test("Marketplace PayPal cannot accept Mondial Relay without a real selected pickup point", () => {
  assert.throws(
    () => resolveMarketplaceShippingSelection({
      carrierId: "mondial_relay",
      shippingAddress: "1 rue Test, 59330 Hautmont",
      pickupPoint: null
    }),
    { code: "MONDIAL_RELAY_PICKUP_REQUIRED" }
  );
});

test("Marketplace Mondial Relay selection retains buyer address and structured pickup point", () => {
  const result = resolveMarketplaceShippingSelection({
    carrierId: "mondial_relay",
    shippingAddress: "12 rue Test, 59330 Hautmont",
    pickupPoint: {
      id: "024688",
      name: "ALL VAPS",
      address: "17 AVENUE MARCEL AIME",
      postalCode: "59330",
      city: "HAUTMONT",
      countryCode: "FR"
    }
  });
  assert.equal(result.carrierId, "mondial_relay");
  assert.equal(result.shippingAddress, "12 rue Test, 59330 Hautmont");
  assert.equal(result.pickupPoint.id, "024688");
});

test("Home carriers keep the delivery address and ignore an irrelevant relay payload", () => {
  const result = resolveMarketplaceShippingSelection({
    carrierId: "colissimo",
    shippingAddress: "12 rue Test, 59330 Hautmont",
    pickupPoint: { id: "024688" }
  });
  assert.equal(result.carrierId, "colissimo");
  assert.equal(result.shippingAddress, "12 rue Test, 59330 Hautmont");
  assert.equal(result.pickupPoint, null);
});

test("Marketplace checkout, persistence and public mirrors are wired for pickup points", () => {
  const route = read("backend/routes/marketplace-paypal.js");
  const cartLib = read("backend/lib/marketplace/v1/cart.js");
  const orders = read("backend/lib/marketplace/orders.js");
  const migration = read("backend/lib/marketplace/v1/migrate.js");
  const persistence = read("backend/lib/marketplace/persistence.js");
  const pg = read("backend/sql/marketplace-postgres.sql");
  const browser = read("js/marketplace-cart-page.js");
  const browserMirror = read("backend/public/js/marketplace-cart-page.js");

  assert.match(route, /resolveMarketplaceShippingSelection/);
  assert.match(route, /pickupPoint:\s*body\.pickupPoint/);
  assert.match(cartLib, /shippingPickupPoint/);
  assert.match(orders, /shipping_pickup_point_json/);
  assert.match(orders, /shippingPickupPoint:\s*parsePickupPoint/);
  assert.match(migration, /shipping_pickup_point_json/);
  assert.match(persistence, /ALTER TABLE mk_orders ADD COLUMN IF NOT EXISTS shipping_pickup_point_json/);
  assert.match(pg, /shipping_pickup_point_json TEXT DEFAULT ''/);
  assert.match(browser, /\/api\/mondial-relay\/service-points/);
  assert.match(browser, /pickupPoint:\s*carrier === "mondial_relay" \? selectedRelay : null/);
  assert.equal(browserMirror, browser);
});

test("Buyer and seller views expose the saved relay selection", () => {
  const buyer = read("js/marketplace-orders.js");
  const seller = read("js/marketplace-seller-dashboard.js");
  assert.match(buyer, /shippingPickupPoint/);
  assert.match(seller, /shippingPickupPoint/);
});
