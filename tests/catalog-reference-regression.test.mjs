import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const syncSource = fs.readFileSync('backend/lib/engine/tcgdex-sync.js','utf8');
const catalogHtml = fs.readFileSync('admin-catalogue.html','utf8');
const shortcuts = fs.readFileSync('js/admin/admin-catalog-sealed-shortcuts.js','utf8');
const sealed = fs.readFileSync('js/admin/admin-sealed-references.js','utf8');

test('missing Pokemon images are repaired from detailed TCGdex cards', () => {
  assert.match(syncSource, /IMAGE_REPAIR_BATCH\s*=\s*600/);
  assert.match(syncSource, /ORDER BY CASE WHEN image_hd='' OR image_hd IS NULL OR image_thumb='' OR image_thumb IS NULL THEN 0 ELSE 1 END/);
  assert.match(syncSource, /imagesRepaired/);
  assert.match(syncSource, /missingImagesBefore/);
  assert.match(syncSource, /missingImagesAfter/);
  assert.match(syncSource, /image_hd=CASE WHEN \?<>'' THEN \? ELSE image_hd END/);
});

test('catalog exposes sealed reference families', () => {
  assert.match(catalogHtml, /admin-catalog-sealed-shortcuts\.js/);
  for (const type of ['booster','demi_display','display','etb','coffret','tin']) {
    assert.match(shortcuts, new RegExp('\\["' + type + '",'));
  }
});

test('sealed reference page accepts packaging deep links', () => {
  assert.match(sealed, /new URLSearchParams\(location\.search\)\.get\("packaging"\)/);
  assert.match(sealed, /Retour au catalogue/);
});
