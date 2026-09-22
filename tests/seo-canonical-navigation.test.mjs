import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("backend/server.js", "utf8");
const home = fs.readFileSync("index.html", "utf8");
const layout = fs.readFileSync("js/layout.js", "utf8");
const licences = fs.readFileSync("pages/licences/index.html", "utf8");
const scanner = fs.readFileSync("scanner.html", "utf8");
const wishlist = fs.readFileSync("souhaits.html", "utf8");
const marketplaceCart = fs.readFileSync("panier-marketplace.html", "utf8");
const marketplaceRoutes = fs.readFileSync("backend/routes/marketplace-v1.js", "utf8");

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

test("scanner exposes complete initial SEO metadata", () => {
  assert.match(scanner, /<title>Scanner cartes Pokémon & TCG \| CardoriaShop<\/title>/);
  assert.match(scanner, /<link rel="canonical" href="https:\/\/www\.cardoriashop\.fr\/scanner\.html">/);
  assert.match(scanner, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">/);
  assert.match(scanner, /<meta property="og:title"/);
  assert.match(scanner, /<script src="\/js\/seo\.js"><\/script>/);
});

test("private utility surfaces stay out of the search index", () => {
  assert.match(wishlist, /<meta name="robots" content="noindex,follow">/);
  assert.match(marketplaceCart, /<meta name="robots" content="noindex,follow">/);
});

test("marketplace sitemap always emits the canonical production host", () => {
  assert.match(marketplaceRoutes, /const base = "https:\/\/www\.cardoriashop\.fr";/);
  assert.doesNotMatch(marketplaceRoutes, /MARKETPLACE_FRONTEND_URL \|\| process\.env\.FRONTEND_URL/);
});

test("runtime mirrors stay identical for SEO-critical files", () => {
  assert.equal(fs.readFileSync("backend/public/index.html", "utf8"), home);
  assert.equal(fs.readFileSync("backend/public/js/layout.js", "utf8"), layout);
  assert.equal(fs.readFileSync("backend/public/pages/licences/index.html", "utf8"), licences);
  assert.equal(fs.readFileSync("backend/public/scanner.html", "utf8"), scanner);
  assert.equal(fs.readFileSync("backend/public/souhaits.html", "utf8"), wishlist);
  assert.equal(fs.readFileSync("backend/public/panier-marketplace.html", "utf8"), marketplaceCart);
  assert.equal(fs.readFileSync("backend/public/robots.txt", "utf8"), fs.readFileSync("robots.txt", "utf8"));
});
