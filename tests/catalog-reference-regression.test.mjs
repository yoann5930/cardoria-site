import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sealedEngine = fs.readFileSync(new URL("../backend/lib/engine/sealed-products.js", import.meta.url), "utf8");
const engineAdmin = fs.readFileSync(new URL("../backend/routes/engine-admin.js", import.meta.url), "utf8");
const integratedSealed = fs.readFileSync(new URL("../js/admin/admin-catalog-sealed-shortcuts.js", import.meta.url), "utf8");
const persistence = fs.readFileSync(new URL("../backend/lib/marketplace/persistence.js", import.meta.url), "utf8");
const sealedSchedule = fs.readFileSync(new URL("../backend/lib/engine/sealed-catalog-schedule.js", import.meta.url), "utf8");
const imageRepair = fs.readFileSync(new URL("../backend/lib/engine/tcgdex-image-repair.js", import.meta.url), "utf8");
const catalogAdmin = fs.readFileSync(new URL("../js/admin/admin-catalog.js", import.meta.url), "utf8");


test('missing Pokemon images are repaired from detailed TCGdex cards', () => {
  assert.match(imageRepair, /https:\/\/api\.tcgdex\.net\/v2\/fr\/cards\//);
  assert.match(imageRepair, /image_thumb/);
  assert.match(imageRepair, /image_hd/);
  assert.match(imageRepair, /tcgdexImageRepair/);
  assert.match(catalogAdmin, /Réparer les images/);
});

test('sealed products live directly inside the reference catalog', () => {
  assert.match(engineAdmin, /router\.get\("\/sealed"/);
  assert.match(engineAdmin, /router\.post\("\/sealed"/);
  assert.match(engineAdmin, /router\.put\("\/sealed\/:id"/);
  assert.match(engineAdmin, /router\.delete\("\/sealed\/:id"/);
  assert.match(integratedSealed, /Produits scellés/);
  assert.match(integratedSealed, /Créer un produit scellé/);
  assert.doesNotMatch(integratedSealed, /admin-references-scelles\.html/);
});

test('sealed catalog has a real persistent database, product images and market prices', () => {
  assert.match(sealedEngine, /sealed_products/);
  assert.match(sealedEngine, /image_url/);
  assert.match(sealedEngine, /market_price/);
  assert.match(sealedEngine, /tcgcsv\.com\/tcgplayer/);
  assert.match(sealedEngine, /\/groups/);
  assert.match(sealedEngine, /\/products/);
  assert.match(sealedEngine, /\/prices/);
  assert.match(sealedEngine, /api\.frankfurter\.dev\/v2\/rate\/USD\/EUR/);
  assert.match(sealedEngine, /product\.imageUrl/);
  assert.match(sealedEngine, /marketPrice/);
  assert.match(engineAdmin, /router\.get\("\/sealed"/);
  assert.match(engineAdmin, /router\.post\("\/sealed\/sync"/);
  assert.match(integratedSealed, /Synchroniser les scellés/);
  assert.match(integratedSealed, /autoSyncTried/);
  assert.match(integratedSealed, /x\.imageUrl/);
});

test('sealed data and manual selling prices survive restarts', () => {
  assert.match(persistence, /ENGINE_TABLES = \[[^\]]*"sealed_products"/s);
  assert.match(persistence, /ENGINE_CHILD_FIRST = \[[^\]]*"sealed_products"/s);
  assert.match(persistence, /version: 4/);
  assert.match(persistence, /engineSyncPromise = null/);
  assert.match(persistence, /engineSyncTimer\.unref/);
  assert.match(sealedEngine, /sale_price_manual/);
  assert.match(sealedEngine, /CASE WHEN sealed_products\.sale_price_manual=1 THEN sealed_products\.sale_price ELSE excluded\.sale_price END/);
});

test('sealed database fills automatically and refreshes at Paris noon', () => {
  assert.match(engineAdmin, /sealed-catalog-schedule\.js/);
  assert.match(sealedSchedule, /startup-sealed-catalog/);
  assert.match(sealedSchedule, /daily-sealed-catalog-paris-noon/);
  assert.match(sealedSchedule, /nextParisNoon/);
  assert.match(sealedSchedule, /12:00 Europe\/Paris/);
  assert.match(sealedSchedule, /flushEnginePersistence/);
});

test('all important Pokemon sealed families are integrated', () => {
  ["Booster", "Tripack", "ETB", "Coffret", "Display", "Demi-display", "Bundle", "Mini tin", "Pokébox"].forEach((label) => assert.match(integratedSealed, new RegExp(label, "i")));
});

test('reference catalog exposes image repair controls', () => {
  assert.match(catalogAdmin, /Réparer les images/);
  assert.match(catalogAdmin, /tcgdex-image-repair/);
});
