import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pages = [
  "live-vendeur.html",
  "live-camera.html",
  "marketplace-paiement-succes.html",
  "marketplace-paiement-echec.html"
];

const security = fs.readFileSync(new URL("../backend/lib/security/index.js", import.meta.url), "utf8");
const sitemap = fs.readFileSync(new URL("../backend/lib/seo/sitemap.js", import.meta.url), "utf8");
const staticPages = sitemap.split("const STATIC_PAGES = [")[1].split("];")[0];

test("technical live and marketplace payment pages declare noindex in both public mirrors", () => {
  for (const page of pages) {
    const root = fs.readFileSync(new URL("../" + page, import.meta.url), "utf8");
    const mirror = fs.readFileSync(new URL("../backend/public/" + page, import.meta.url), "utf8");
    assert.equal(root, mirror, page + " frontend/runtime mirror mismatch");
    assert.match(root, /<meta name="robots" content="noindex,nofollow,noarchive">/i, page);
  }
});

test("security middleware sends X-Robots-Tag noindex for technical pages", () => {
  for (const page of pages) {
    assert.ok(security.includes('"/' + page + '"'), page);
  }
  assert.match(security, /PRIVATE_PUBLIC_INDEX_PATHS\.has\(path\)/);
  assert.match(security, /X-Robots-Tag", "noindex, nofollow, noarchive"/);
});

test("technical pages are disallowed in robots and absent from core sitemap static pages", () => {
  for (const page of pages) {
    assert.ok(sitemap.includes('"Disallow: /' + page + '"'), page);
    assert.ok(!staticPages.includes('"/' + page + '"'), page);
  }
});
