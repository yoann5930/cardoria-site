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
const marketplaceSitemap = fs.readFileSync("backend/lib/seo/marketplace-sitemap.js", "utf8");
const marketplaceListings = fs.readFileSync("backend/lib/marketplace/v1/listings.js", "utf8");
const marketplaceSearch = fs.readFileSync("backend/lib/marketplace/listings.js", "utf8");
const marketplaceBrowse = fs.readFileSync("js/marketplace-browse.js", "utf8");
const marketplaceSeller = fs.readFileSync("js/marketplace-seller.js", "utf8");
const marketplaceListing = fs.readFileSync("js/marketplace-listing.js", "utf8");

test("estimation aliases use HTTP redirects to the canonical URL", () => {
  assert.match(
    server,
    /app\.get\(\["\/estimation", "\/estimation\/", "\/pages\/estimation", "\/pages\/estimation\/"\], \(req, res\) => res\.redirect\(308, "\/estimation\.html"\)\);/
  );
});

test("generic card, listing and extension templates redirect to useful canonical surfaces", () => {
  assert.match(server, /app\.get\("\/annonce\.html"[\s\S]*?return res\.redirect\(301, "\/marketplace\.html"\);/);
  assert.match(server, /app\.get\("\/carte\.html"[\s\S]*?return res\.redirect\(301, "\/pages\/licences\/"\);/);
  assert.match(server, /app\.get\(\["\/pages\/extension", "\/pages\/extension\/"\][\s\S]*?return res\.redirect\(301, "\/pages\/licences\/"\);/);
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
  assert.match(marketplaceSitemap, /const SITE = "https:\/\/www\.cardoriashop\.fr";/);
  assert.match(marketplaceRoutes, /generateMarketplaceSitemapXml\(entries\)/);
  assert.doesNotMatch(marketplaceRoutes, /MARKETPLACE_FRONTEND_URL \|\| process\.env\.FRONTEND_URL/);
});

test("marketplace listings use crawlable clean canonical URLs with server rendering", () => {
  assert.match(marketplaceListings, /publicUrl: row\.slug \? `\/annonces\//);
  assert.match(marketplaceListings, /url: `\/annonces\//);
  assert.match(marketplaceSearch, /publicUrl: row\.slug \? `\/annonces\//);
  assert.match(server, /app\.get\("\/annonces\/:slug", sendMarketplaceListingSeoPage\)/);
  assert.match(server, /res\.redirect\(301, `\/annonces\/\$\{encodeURIComponent\(req\.query\.slug\)\}`\)/);
  assert.match(server, /const listing = getListingV1\(String\(req\.query\.id\)\)/);
  assert.match(server, /"@type": "Product"/);
  assert.match(server, /"@type": "BreadcrumbList"/);
  assert.match(marketplaceBrowse, /listing\.publicUrl \|\| M\.listingUrl\(listing\.id\)/);
  assert.match(marketplaceSeller, /l\.publicUrl \|\| M\.listingUrl\(l\.id\)/);
  assert.match(marketplaceListing, /location\.pathname\.match\(\/\^\\\/annonces\\\//);
});

test("homepage links directly to priority Pokemon search-intent pages", () => {
  assert.match(home, /href="\/pages\/prix-carte-pokemon\/"/);
  assert.match(home, /href="\/pages\/combien-vaut-ma-carte-pokemon\/"/);
});

test("runtime mirrors stay identical for SEO-critical files", () => {
  assert.equal(fs.readFileSync("backend/public/index.html", "utf8"), home);
  assert.equal(fs.readFileSync("backend/public/js/layout.js", "utf8"), layout);
  assert.equal(fs.readFileSync("backend/public/pages/licences/index.html", "utf8"), licences);
  assert.equal(fs.readFileSync("backend/public/scanner.html", "utf8"), scanner);
  assert.equal(fs.readFileSync("backend/public/souhaits.html", "utf8"), wishlist);
  assert.equal(fs.readFileSync("backend/public/panier-marketplace.html", "utf8"), marketplaceCart);
  assert.equal(fs.readFileSync("backend/public/js/marketplace-browse.js", "utf8"), marketplaceBrowse);
  assert.equal(fs.readFileSync("backend/public/js/marketplace-seller.js", "utf8"), marketplaceSeller);
  assert.equal(fs.readFileSync("backend/public/js/marketplace-listing.js", "utf8"), marketplaceListing);
  assert.equal(fs.readFileSync("backend/public/robots.txt", "utf8"), fs.readFileSync("robots.txt", "utf8"));
});
