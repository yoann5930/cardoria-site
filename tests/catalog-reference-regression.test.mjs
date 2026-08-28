import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const syncSource = fs.readFileSync('backend/lib/engine/tcgdex-sync.js','utf8');
const sealedEngine = fs.readFileSync('backend/lib/engine/sealed-products.js','utf8');
const sealedSchedule = fs.readFileSync('backend/lib/engine/sealed-catalog-schedule.js','utf8');
const engineDb = fs.readFileSync('backend/lib/engine/database.js','utf8');
const persistence = fs.readFileSync('backend/lib/marketplace/persistence.js','utf8');
const engineAdmin = fs.readFileSync('backend/routes/engine-admin.js','utf8');
const catalogHtml = fs.readFileSync('admin-catalogue.html','utf8');
const integratedSealed = fs.readFileSync('js/admin/admin-catalog-sealed-shortcuts.js','utf8');
const core = fs.readFileSync('js/admin/admin-core.js','utf8');
const legacySealedPage = fs.readFileSync('admin-references-scelles.html','utf8');

test('missing Pokemon images are repaired from detailed TCGdex cards', () => {
  assert.match(syncSource, /IMAGE_REPAIR_BATCH\s*=\s*600/);
  assert.match(syncSource, /ORDER BY CASE WHEN image_hd='' OR image_hd IS NULL OR image_thumb='' OR image_thumb IS NULL THEN 0 ELSE 1 END/);
  assert.match(syncSource, /imagesRepaired/);
  assert.match(syncSource, /missingImagesBefore/);
  assert.match(syncSource, /missingImagesAfter/);
  assert.match(syncSource, /image_hd=CASE WHEN \?<>'' THEN \? ELSE image_hd END/);
});

test('sealed products live directly inside the reference catalog', () => {
  assert.match(catalogHtml, /admin-catalog-sealed-shortcuts\.js/);
  assert.match(integratedSealed, /sealedReferenceCatalog/);
  assert.match(integratedSealed, /Produits scellés/);
  assert.match(integratedSealed, /Prix de vente/);
  assert.match(integratedSealed, /scSalePrice/);
  assert.match(integratedSealed, /\/api\/admin\/engine\/sealed/);
  assert.match(core, /Catalogue de référence/);
  assert.doesNotMatch(core, /Référence produits scellés/);
  assert.match(legacySealedPage, /admin-catalogue\.html#scelles/);
});

test('sealed catalog has a real persistent database, product images and market prices', () => {
  assert.match(engineDb, /CREATE TABLE IF NOT EXISTS sealed_products/);
  assert.match(sealedEngine, /CREATE TABLE IF NOT EXISTS sealed_products/);
  assert.match(sealedEngine, /tcgplayer_id/);
  assert.match(sealedEngine, /image_url/);
  assert.match(sealedEngine, /sale_price REAL/);
  assert.match(sealedEngine, /market_price REAL/);
  assert.match(sealedEngine, /https:\/\/tcgcsv\.com\/tcgplayer/);
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
  for (const type of ['booster','blister','duopack','tripack','quadpack','bundle','mini_bundle','demi_display','display','case_display','etb','etb_pokemon_center','upc','coffret','collection_box','tin','pokebox','mini_tin','build_battle','build_battle_stadium','deck','theme_deck','battle_deck','league_battle_deck','starter_deck','premium_collection','poster_collection','binder_collection','calendar','advent_calendar','case_carton','master_case']) {
    assert.match(integratedSealed, new RegExp('\\["' + type + '",'));
    assert.match(sealedEngine, new RegExp('"' + type + '"'));
  }
});

test('reference catalog exposes image repair controls', () => {
  assert.match(integratedSealed, /repairMissingImages/);
  assert.match(integratedSealed, /market-prices\/status/);
  assert.match(integratedSealed, /sync\/pokemon-reference/);
  assert.match(integratedSealed, /priceLimit:2000/);
});
