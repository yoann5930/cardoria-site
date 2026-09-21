import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  boutiqueShippingCost,
  listBoutiqueShippingOptions,
  resolveBoutiqueShipping
} from "../lib/boutique/shipping.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("Boutique shipping rates depend on the selected carrier", () => {
  assert.equal(boutiqueShippingCost("La Poste"), 6.5);
  assert.equal(boutiqueShippingCost("Mondial Relay"), 4.95);
  assert.equal(resolveBoutiqueShipping("").id, "La Poste");
  assert.throws(() => resolveBoutiqueShipping("Chronopost"), { status: 400 });
  assert.throws(() => resolveBoutiqueShipping("Relais Colis"), { status: 400 });
  const options = listBoutiqueShippingOptions();
  assert.equal(options.length, 2);
  assert.ok(options.every((option) => option.cost > 0));
});

test("Boutique checkout charges server shipping and ignores a client shippingCost of 0", () => {
  const checkout = read("../lib/boutique/checkout.js");
  assert.match(checkout, /resolveBoutiqueShipping/);
  assert.match(checkout, /shippingOption\.cost/);
  assert.doesNotMatch(checkout, /shippingCost = 0/);
  assert.doesNotMatch(checkout, /body\.shippingCost|requestedShippingCost/);
});

test("Boutique and Marketplace dropdowns show priced shipping methods", () => {
  const html = read("../../boutique.html");
  const boutiqueJs = read("../../js/boutique.js");
  const marketJs = read("../../js/marketplace-cart-page.js");
  assert.match(html, /<select id="shopCarrier"/);
  assert.match(html, /La Poste — Colissimo à domicile — 6,50 €/);
  assert.match(html, /Mondial Relay — Point Relais — 4,95 €/);
  assert.doesNotMatch(html, /type="radio" name="shopCarrier"/);
  assert.match(boutiqueJs, /id="shopCarrier"|qs\("shopCarrier"\)/);
  assert.match(boutiqueJs, /6\.5/);
  assert.match(boutiqueJs, /4\.95/);
  assert.match(marketJs, /buyCarrier/);
  assert.match(marketJs, /\/shipping\/options/);
  assert.match(marketJs, /Frais de port/);
});
