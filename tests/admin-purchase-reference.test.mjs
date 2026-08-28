import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const routeSource = fs.readFileSync("backend/routes/admin.js", "utf8");
const formSource = fs.readFileSync("js/admin/admin-purchase-reference-capacity.js", "utf8");
const purchaseHtml = fs.readFileSync("admin-achats-cartes.html", "utf8");

function extractFunction(name, nextName) {
  const start = routeSource.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} missing`);
  const end = nextName ? routeSource.indexOf(`function ${nextName}`, start) : -1;
  assert.ok(end > start, `${nextName} missing after ${name}`);
  return routeSource.slice(start, end);
}

test("lot card ids keep the full 180-character engine identifier", () => {
  const source = extractFunction("cleanText", "normalizedBuyer") + extractFunction("extractLotCards", "normalizePurchase") + "\nglobalThis.extractLotCards=extractLotCards;";
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context);

  const longId = "pokemon-" + "x".repeat(172);
  assert.equal(longId.length, 180);
  const parsed = context.extractLotCards(`[LOT_CARDS] ${JSON.stringify([longId])}`);
  assert.deepEqual(Array.from(parsed), [longId]);
});

test("purchase references allow the catalog-card prefix plus a 180-character engine id", () => {
  const longId = "pokemon-" + "x".repeat(172);
  const reference = `catalog-card:${longId}`;
  assert.equal(reference.length, 193);
  assert.match(routeSource, /reference:\s*cleanText\(body\.reference \?\? existing\.reference,\s*240\)/);
  assert.ok(reference.length <= 240);
});

test("purchase form raises the reference input capacity to 240", () => {
  const reference = { maxLength: 120 };
  const context = {
    document: { getElementById: (id) => id === "pReference" ? reference : null }
  };
  vm.runInNewContext(formSource, context);
  assert.equal(reference.maxLength, 240);
  assert.match(purchaseHtml, /admin-purchase-reference-capacity\.js/);
});

test("legacy 120-character truncation is absent from purchase normalization", () => {
  assert.doesNotMatch(routeSource, /cleanText\(id,\s*120\)/);
  assert.doesNotMatch(routeSource, /reference:\s*cleanText\(body\.reference \?\? existing\.reference,\s*120\)/);
});
