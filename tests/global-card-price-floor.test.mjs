import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CARD_MIN_PRICE_EUR, floorCardPrice, normalizeCardSalePrice } from "../backend/lib/pricing/card-price-floor.js";

test("positive card prices below one euro are exposed at exactly one euro",()=>{
  assert.equal(CARD_MIN_PRICE_EUR,1);
  assert.equal(floorCardPrice(0.01),1);
  assert.equal(floorCardPrice(0.76),1);
  assert.equal(floorCardPrice("0.99"),1);
  assert.equal(floorCardPrice(1),1);
  assert.equal(floorCardPrice(1.01),1.01);
});

test("missing card price stays missing instead of inventing one euro",()=>{
  assert.equal(floorCardPrice(0),0);
  assert.equal(floorCardPrice(null),0);
  assert.equal(floorCardPrice(""),0);
});

test("sale price normalization clamps sub-euro values and rejects non-positive values",()=>{
  assert.equal(normalizeCardSalePrice(0.76),1);
  assert.equal(normalizeCardSalePrice(1),1);
  assert.equal(normalizeCardSalePrice(4.25),4.25);
  assert.throws(()=>normalizeCardSalePrice(0),/supérieur à 0/);
});

test("catalog, Boutique and Marketplace all enforce the global floor",()=>{
  const database=fs.readFileSync("backend/lib/engine/database.js","utf8");
  const pricing=fs.readFileSync("backend/lib/engine/pricing.js","utf8");
  const stock=fs.readFileSync("backend/lib/boutique/stock.js","utf8");
  const listings=fs.readFileSync("backend/lib/marketplace/listings.js","utf8");
  const v1=fs.readFileSync("backend/lib/marketplace/v1/listings.js","utf8");
  const cart=fs.readFileSync("backend/lib/marketplace/v1/cart.js","utf8");
  const migration=fs.readFileSync("backend/lib/marketplace/migrate.js","utf8");
  assert.match(database,/floorCardPrice\(row\.recommended_price\)/);
  assert.match(database,/recommended_price=1 WHERE recommended_price>0 AND recommended_price<1/);
  assert.match(pricing,/floorCardPrice\(recommended\)/);
  assert.match(stock,/isCardPackaging\(line\.packaging\) \? floorCardPrice\(rawPrice\)/);
  assert.match(listings,/normalizeCardSalePrice\(data\.price\)/);
  assert.match(v1,/normalizeCardSalePrice\(data\.price\)/);
  assert.match(cart,/floorCardPrice\(r\.current_price\)/);
  assert.match(migration,/UPDATE mk_listings SET price=1 WHERE price>0 AND price<1/);
});

test("automatic Pokemon price imports cannot reintroduce sub-euro public prices",()=>{
  for(const path of [
    "backend/lib/engine/tcgdex-sync.js",
    "backend/lib/engine/visible-prices.js",
    "backend/lib/engine/tcgcsv-card-repair.js",
    "backend/lib/engine/zebradex-price-repair.js"
  ]){
    const source=fs.readFileSync(path,"utf8");
    assert.match(source,/floorCardPrice/,"missing floor in "+path);
  }
});

test("seller and admin card-price inputs communicate the one-euro minimum",()=>{
  const seller=fs.readFileSync("js/marketplace-sell.js","utf8");
  const sellerRuntime=fs.readFileSync("backend/public/js/marketplace-sell.js","utf8");
  const stockAdmin=fs.readFileSync("js/admin/admin-stock.js","utf8");
  const stockRuntime=fs.readFileSync("backend/public/js/admin/admin-stock.js","utf8");
  assert.match(seller,/id="sPrice" type="number" min="1"/);
  assert.match(seller,/prix minimum d’une carte est de 1,00 €/i);
  assert.match(stockAdmin,/item\.packaging === "carte_unite"/);
  assert.match(stockAdmin,/boutiquePrice = "1\.00"/);
  assert.equal(sellerRuntime,seller);
  assert.equal(stockRuntime,stockAdmin);
});
