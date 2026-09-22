import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PUBLIC_LICENSE_SITEMAP_SLUGS,
  extensionSitemapEntry,
  isIndexableExtensionSitemapEntry,
  isIndexableLicenseSitemapSlug,
  slugifyExtensionName
} from "../backend/lib/seo/sitemap-urls.js";

test("starwars stays out of sitemaps until a public licence page exists", () => {
  assert.equal(isIndexableLicenseSitemapSlug("starwars"), false);
  assert.equal(isIndexableLicenseSitemapSlug("pokemon"), true);
  assert.equal(fs.existsSync("pages/licences/starwars/index.html"), false);
  assert.equal(fs.existsSync("pages/licences/pokemon/index.html"), true);
});

test("licence sitemap allowlist matches public licence templates", () => {
  const dirs = fs.readdirSync("pages/licences", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync("pages/licences/" + entry.name + "/index.html"))
    .map((entry) => entry.name);
  assert.deepEqual([...PUBLIC_LICENSE_SITEMAP_SLUGS].sort(), dirs.sort());
});

test("extension names that slugify to nothing cannot enter the sitemap", () => {
  assert.equal(slugifyExtensionName("★ ★ ★"), "");
  assert.equal(slugifyExtensionName("..."), "");
  assert.equal(slugifyExtensionName("Base Set"), "base-set");
  assert.equal(extensionSitemapEntry({ extension: "★", license_slug: "pokemon", card_count: 3 }), null);
  assert.equal(extensionSitemapEntry({ extension: "", license_slug: "pokemon" }), null);
  assert.deepEqual(extensionSitemapEntry({ extension: "Base Set", license_slug: "pokemon", card_count: 12 }), {
    extension: "Base Set",
    license: "pokemon",
    cardCount: 12,
    slug: "base-set",
    url: "/extensions/pokemon/base-set"
  });
});

test("incomplete /extensions/:license/ paths are rejected", () => {
  assert.equal(isIndexableExtensionSitemapEntry({ url: "/extensions/pokemon/", license: "pokemon", slug: "" }), false);
  assert.equal(isIndexableExtensionSitemapEntry({ url: "/extensions/pokemon" }), false);
  assert.equal(isIndexableExtensionSitemapEntry({ url: "/extensions/pokemon/base-set", license: "pokemon", slug: "base-set" }), true);
  assert.equal(isIndexableExtensionSitemapEntry({ url: "https://localhost/extensions/pokemon/base-set" }), false);
});
