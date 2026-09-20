import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const cards = fs.readFileSync("backend/lib/engine/cards.js", "utf8");
const route = fs.readFileSync("backend/routes/engine.js", "utf8");
const seo = fs.readFileSync("js/licence-seo-page.js", "utf8");
const seoRuntime = fs.readFileSync("backend/public/js/licence-seo-page.js", "utf8");
const page = fs.readFileSync("pages/licences/pokemon/index.html", "utf8");
const pageRuntime = fs.readFileSync("backend/public/pages/licences/pokemon/index.html", "utf8");

test("Pokemon showcase only requests illustrated featured cards", () => {
  const query = /sort=showcase&requireImage=1&featuredOnly=1/;
  assert.match(seo, query);
  assert.match(seoRuntime, query);
});

test("showcase excludes common cards and ranks premium hits first", () => {
  assert.match(cards, /featuredOnly = false/);
  assert.match(cards, /c\.hit_family IN/);
  assert.match(cards, /'Gold'/);
  assert.match(cards, /'SAR \/ Special Illustration Rare'/);
  assert.match(cards, /'AR \/ Illustration Rare'/);
  assert.match(cards, /'Full Art \/ Ultra Rare'/);
  assert.match(cards, /showcase:/);
  assert.match(cards, /COALESCE\(c\.image_hd,''\)<>''/);
  assert.doesNotMatch(cards, /featuredOnly[\s\S]{0,900}'Commune'/);
});

test("public cards API accepts showcase flags", () => {
  assert.match(route, /featuredOnly:/);
  assert.match(route, /requireImage:/);
  assert.match(route, /featured_only/);
  assert.match(route, /require_image/);
});

test("Pokemon landing page cache-buster is synced", () => {
  assert.match(page, /licence-seo-page\.js\?v=20260921-showcase/);
  assert.match(pageRuntime, /licence-seo-page\.js\?v=20260921-showcase/);
});
