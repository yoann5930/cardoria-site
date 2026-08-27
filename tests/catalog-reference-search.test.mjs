import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('backend/lib/engine/cards.js', 'utf8');
const ui = fs.readFileSync('js/admin/admin-catalog-reference-search.js', 'utf8');

test('printed French Pokemon references are normalized for catalog search', () => {
  assert.match(source, /referenceSearchAliases/);
  assert.match(source, /replace\(\/fr\(\?=\\d\)\/g, ""\)/);
  assert.match(source, /extension_code/);
  assert.match(source, /COALESCE\(c\.number/);
  assert.match(source, /LOWER\(c\.id\) LIKE/);
  assert.match(source, /LOWER\(c\.slug\) LIKE/);
});

test('catalog UI explicitly documents printed reference lookup', () => {
  assert.match(ui, /SVPFR 031/);
  assert.match(ui, /SVPFR031/);
  assert.match(ui, /SVPFR-031/);
  assert.match(ui, /référence imprimée/i);
});
