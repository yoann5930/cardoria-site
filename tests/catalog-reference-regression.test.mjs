import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const syncSource = fs.readFileSync('backend/lib/engine/tcgdex-sync.js','utf8');
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
  assert.match(integratedSealed, /id=\\?"?sealedReferenceCatalog/);
  assert.match(integratedSealed, /Produits scellés/);
  assert.match(integratedSealed, /Prix de vente/);
  assert.match(integratedSealed, /scSalePrice/);
  assert.match(integratedSealed, /SALE_PRICE/);
  assert.match(core, /Catalogue de référence/);
  assert.doesNotMatch(core, /Référence produits scellés/);
  assert.match(legacySealedPage, /admin-catalogue\.html#scelles/);
});

test('all important Pokemon sealed families are integrated', () => {
  for (const type of ['booster','blister','duopack','tripack','quadpack','bundle','mini_bundle','demi_display','display','case_display','etb','etb_pokemon_center','upc','coffret','collection_box','tin','pokebox','mini_tin','build_battle','build_battle_stadium','deck','theme_deck','battle_deck','league_battle_deck','starter_deck','premium_collection','poster_collection','binder_collection','calendar','advent_calendar','case_carton','master_case']) {
    assert.match(integratedSealed, new RegExp('\\["' + type + '",'));
  }
});

test('reference catalog exposes image repair controls', () => {
  assert.match(integratedSealed, /repairMissingImages/);
  assert.match(integratedSealed, /market-prices\/status/);
  assert.match(integratedSealed, /sync\/pokemon-reference/);
  assert.match(integratedSealed, /priceLimit:2000/);
});
