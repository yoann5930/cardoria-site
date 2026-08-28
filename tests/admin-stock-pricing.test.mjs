import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadStockInternals() {
  const raw = fs.readFileSync("js/admin/admin-stock.js", "utf8");
  const marker = "})();";
  const index = raw.lastIndexOf(marker);
  assert.ok(index > 0, "admin-stock IIFE ending not found");
  const instrumented = raw.slice(0, index) + `
    globalThis.__stockTest = {
      isExternalSource,
      median,
      cardMarketPrice,
      sealedMarketPrice,
      enrichProduct,
      normalizeCondition,
      normalizedSoldOverride
    };
  ` + raw.slice(index);

  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: "", innerHTML: "", style: {}, addEventListener() {} });
    return nodes.get(selector);
  };
  const admin = {
    protectAdmin: () => true,
    renderShell() {},
    euro: (value) => `${Number(value || 0).toFixed(2)} €`,
    qs: node,
    adminFetch: async () => ({ ok: true, purchases: [] })
  };
  const context = {
    console,
    Promise,
    setTimeout,
    clearTimeout,
    alert() {},
    CSS: { escape: (value) => String(value) },
    document: {
      querySelectorAll: () => [],
      querySelector: () => null
    },
    window: { CardoriaAdmin: admin }
  };
  context.globalThis = context;
  vm.runInNewContext(instrumented, context, { filename: "admin-stock.js" });
  return context.__stockTest;
}

const Stock = loadStockInternals();

test("stock excludes Cardoria/manual from market price and uses external median", () => {
  assert.equal(Stock.isExternalSource("cardoria"), false);
  assert.equal(Stock.isExternalSource("manual"), false);
  assert.equal(Stock.isExternalSource("cardoria-import"), false);
  assert.equal(Stock.isExternalSource("cardmarket"), true);

  const card = {
    priceSources: [
      { source: "cardoria", price: 100 },
      { source: "manual", price: 80 },
      { source: "cardmarket", price: 10 },
      { source: "tcgplayer-tcgcsv", price: 20 }
    ]
  };
  assert.equal(Stock.cardMarketPrice(card), 15);
});

test("stock subtracts proven sold units and applies condition only to card market price", () => {
  const product = {
    cardId: "pokemon-test",
    card: {
      priceSources: [
        { source: "cardmarket", price: 10 },
        { source: "tcgplayer-tcgcsv", price: 20 }
      ],
      salesStats: { inventoryUnits: 3 }
    },
    sealedRef: null,
    quantityPurchased: 10,
    soldOverride: null,
    condition: "EX"
  };
  Stock.enrichProduct(product);
  assert.equal(product.marketPrice, 15);
  assert.equal(product.salePrice, 12.75);
  assert.equal(product.sold, 3);
  assert.equal(product.remainingQuantity, 7);

  product.soldOverride = 4;
  Stock.enrichProduct(product);
  assert.equal(product.sold, 4);
  assert.equal(product.remainingQuantity, 6);
});

test("stock uses linked sealed external price without inventing a condition adjustment", () => {
  const sealed = {
    sealedId: "sealed-tcgplayer-1",
    sealedRef: { marketPrice: 50, priceSource: "tcgcsv-tcgplayer", source: "tcgcsv" },
    card: null,
    quantityPurchased: 2,
    soldOverride: 1,
    condition: "EX"
  };
  Stock.enrichProduct(sealed);
  assert.equal(sealed.marketPrice, 50);
  assert.equal(sealed.salePrice, 50);
  assert.equal(sealed.sold, 1);
  assert.equal(sealed.remainingQuantity, 1);

  const manual = {
    sealedRef: { marketPrice: 99, priceSource: "manual", source: "manual" },
    card: null,
    quantityPurchased: 1,
    soldOverride: null,
    condition: ""
  };
  Stock.enrichProduct(manual);
  assert.equal(manual.marketPrice, 0);
  assert.equal(manual.salePrice, 0);
});

test("stock never produces a negative remaining quantity", () => {
  const product = {
    card: null,
    sealedRef: null,
    quantityPurchased: 2,
    soldOverride: 7,
    condition: ""
  };
  Stock.enrichProduct(product);
  assert.equal(product.sold, 7);
  assert.equal(product.remainingQuantity, 0);
});
