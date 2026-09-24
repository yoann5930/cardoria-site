import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCardPageSeo, extensionMetaDescription } from "../backend/lib/seo/card-meta.js";
import {
  isCrawlableSitemapPath,
  isTechnicalNoindexPath,
  sitemapImageLoc,
  TECHNICAL_NOINDEX_PATHS
} from "../backend/lib/seo/sitemap-urls.js";
import { isPrivateIndexPath } from "../backend/lib/security/index.js";

const TECHNICAL_FILES = [
  "live-vendeur.html",
  "live-camera.html",
  "marketplace-paiement-succes.html",
  "marketplace-paiement-echec.html"
];

test("technical pages are noindex in both public copies and blocked from sitemaps", () => {
  for (const file of TECHNICAL_FILES) {
    for (const root of [".", "backend/public"]) {
      const html = fs.readFileSync(`${root}/${file}`, "utf8");
      assert.match(html, /name="robots" content="noindex,nofollow"/, file);
    }
    assert.equal(isTechnicalNoindexPath("/" + file), true);
    assert.equal(isPrivateIndexPath("/" + file), true);
  }
  assert.equal(isTechnicalNoindexPath("/cartes/pokemon/jirachi"), false);
  assert.equal(isPrivateIndexPath("/cartes/pokemon/jirachi"), false);
});

test("public sitemap XML stays crawlable, including the marketplace sitemap", () => {
  for (const path of ["/sitemap.xml", "/sitemap-index.xml", "/api/seo/core.xml", "/api/seo/cards-1.xml", "/api/marketplace/v1/sitemap.xml"]) {
    assert.equal(isCrawlableSitemapPath(path), true, path);
    assert.equal(isPrivateIndexPath(path), false, path);
  }
  assert.equal(isPrivateIndexPath("/api/health"), true);
  assert.equal(isCrawlableSitemapPath("/admin-seo.html"), false);
});

test("card titles name the card, and missing images produce no sitemap image URL", () => {
  const seo = buildCardPageSeo({
    name: "Jirachi",
    number: "9",
    extension: "EX Deoxys",
    language: "fr",
    license: "pokemon",
    licenseName: "Pokémon",
    rarity: "Rare"
  });
  assert.equal(seo.title, "Jirachi 9 EX Deoxys FR – Carte Pokémon, prix & cote | Cardoria");
  assert.equal(seo.h1, "Jirachi 9 — EX Deoxys");
  assert.match(seo.description, /Jirachi 9/);
  assert.match(seo.description, /Rare/);
  assert.match(seo.description, /EX Deoxys/);
  assert.match(seo.description, /\(FR\)/);
  assert.equal(sitemapImageLoc(""), "");
  assert.equal(sitemapImageLoc("   "), "");
  assert.equal(sitemapImageLoc("not a url"), "");
  assert.equal(sitemapImageLoc("javascript:alert(1)"), "");
  assert.equal(sitemapImageLoc("https://images.example/card.webp"), "https://images.example/card.webp");
});

test("extension descriptions stay unique per licence and extension", () => {
  const deoxys = extensionMetaDescription("Pokémon", "EX Deoxys");
  const base = extensionMetaDescription("Pokémon", "Set de Base");
  assert.match(deoxys, /extension EX Deoxys/);
  assert.notEqual(deoxys, base);
  assert.equal(TECHNICAL_NOINDEX_PATHS.includes("/live-camera.html"), true);
});

test("static sitemap targets exist as public files and are not technical pages", () => {
  const source = fs.readFileSync("backend/lib/seo/sitemap.js", "utf8");
  const block = source.slice(source.indexOf("const STATIC_PAGES"), source.indexOf("];", source.indexOf("const STATIC_PAGES")));
  const locs = [...block.matchAll(/loc: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(locs.includes("/"));
  assert.ok(locs.includes("/pages/licences/"));
  for (const loc of locs) {
    assert.equal(TECHNICAL_NOINDEX_PATHS.includes(loc), false, loc);
    const relative = loc === "/" ? "index.html" : loc.endsWith("/") ? loc.slice(1) + "index.html" : loc.slice(1);
    assert.equal(fs.existsSync(relative), true, relative);
    assert.equal(fs.existsSync("backend/public/" + relative), true, "backend/public/" + relative);
  }
});
