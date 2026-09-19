import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("backend/server.js", "utf8");
const home = fs.readFileSync("index.html", "utf8");
const layout = fs.readFileSync("js/layout.js", "utf8");
const licences = fs.readFileSync("pages/licences/index.html", "utf8");

test("estimation aliases use HTTP redirects to the canonical URL", () => {
  assert.match(
    server,
    /app\.get\(\["\/estimation", "\/estimation\/", "\/pages\/estimation", "\/pages\/estimation\/"\], \(req, res\) => res\.redirect\(308, "\/estimation\.html"\)\);/
  );
});

test("homepage does not link to redirect aliases", () => {
  assert.doesNotMatch(home, /href="\/pages\/(?:boutique|estimation)\/?"/);
  assert.match(home, /href="\/boutique\.html"/);
  assert.match(home, /href="\/estimation\.html"/);
});

test("shared navigation uses root-relative canonical URLs", () => {
  assert.doesNotMatch(layout, /pageBase\(/);
  assert.doesNotMatch(layout, /pages\/boutique\//);
  assert.doesNotMatch(layout, /pages\/estimation\//);
  assert.match(layout, /href="\/boutique\.html"/);
  assert.match(layout, /href="\/estimation\.html"/);
  assert.match(layout, /href="\/pages\/licences\//);
});

test("licence hub exposes crawlable links and explicit metadata without JavaScript", () => {
  assert.match(licences, /<link rel="canonical" href="https:\/\/www\.cardoriashop\.fr\/pages\/licences\/">/);
  assert.match(licences, /<meta name="description"/);
  for (const slug of ["pokemon", "yugioh", "onepiece", "lorcana", "magic", "dragonball", "sports"]) {
    assert.match(licences, new RegExp('href="/pages/licences/' + slug + '/"'));
  }
});

test("runtime mirrors stay identical for SEO-critical files", () => {
  assert.equal(fs.readFileSync("backend/public/index.html", "utf8"), home);
  assert.equal(fs.readFileSync("backend/public/js/layout.js", "utf8"), layout);
  assert.equal(fs.readFileSync("backend/public/pages/licences/index.html", "utf8"), licences);
});
