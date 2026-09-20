import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("backend/lib/engine/pokemon-multisource-sync.js", "utf8");
const schedule = fs.readFileSync("backend/lib/engine/pokemon-multisource-schedule.js", "utf8");
const db = fs.readFileSync("backend/lib/engine/database.js", "utf8");
const admin = fs.readFileSync("backend/routes/engine-admin.js", "utf8");
const tcgdex = fs.readFileSync("backend/lib/engine/tcgdex-sync.js", "utf8");
const persistence = fs.readFileSync("backend/lib/marketplace/persistence.js", "utf8");
const server = fs.readFileSync("backend/server.js", "utf8");

test("multi-source catalog has resumable TCGCSV and Scrydex providers", () => {
  assert.match(source, /https:\/\/tcgcsv\.com\/tcgplayer/);
  assert.match(source, /https:\/\/api\.scrydex\.com\/pokemon\/v1/);
  assert.match(source, /syncPokemonTcgcsvCatalog/);
  assert.match(source, /syncPokemonScrydexCatalog/);
  assert.match(source, /catalog_sync_state/);
  assert.match(source, /cursor/);
  assert.match(source, /freshCompletion/);
});

test("TCGCSV can create missing English cards instead of only repairing existing rows", () => {
  assert.match(source, /pokemon-en-tcgplayer-/);
  assert.match(source, /INSERT INTO cards/);
  assert.match(source, /extendedValue\(product, \["number","card number"\]\)/);
  assert.match(source, /tcgplayerProductId/);
  assert.match(source, /chooseExisting/);
});

test("catalog provenance and external provider references are durable and exposed", () => {
  for (const field of ["catalog_source","catalog_source_url","catalog_sources_json","external_refs_json"]) {
    assert.match(db, new RegExp(field));
  }
  assert.match(db, /primarySource: row\.catalog_source/);
  assert.match(tcgdex, /catalog_sources_json/);
  assert.match(tcgdex, /tcgdexId/);
  assert.match(persistence, /"catalog_sync_state"/);
  assert.match(persistence, /version: 6/);
});

test("multi-source sync is available to admins and runs progressively in production", () => {
  assert.match(admin, /\/catalog\/multisource\/status/);
  assert.match(admin, /\/catalog\/multisource\/sync/);
  assert.match(admin, /syncPokemonMultiSourceCatalog/);
  assert.match(server, /pokemon-multisource-schedule\.js/);
  assert.match(schedule, /POKEMON_MULTISOURCE_INTERVAL_MS/);
  assert.match(schedule, /persistMultilingualCards/);
});

test("provider sync does not require inventing Scrydex secrets", () => {
  assert.match(source, /SCRYDEX_API_KEY/);
  assert.match(source, /SCRYDEX_TEAM_ID/);
  assert.match(source, /SCRYDEX_API_KEY_or_TEAM_ID_missing/);
  assert.doesNotMatch(source, /YOUR_API_KEY|YOUR_TEAM_ID/);
});
