import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { applySecurityMiddleware } from "../backend/lib/security/index.js";
import { generateMarketplaceSitemapXml } from "../backend/lib/seo/marketplace-sitemap.js";

const MARKETPLACE_SITEMAP = "/api/marketplace/v1/sitemap.xml";

test("empty marketplace sitemap remains valid crawlable XML", () => {
  const xml = generateMarketplaceSitemapXml([]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<\/urlset>$/);
  assert.doesNotMatch(xml, /<url>/);
});

test("marketplace sitemap emits only clean public listing URLs", () => {
  const xml = generateMarketplaceSitemapXml([
    { url: "/annonces/pikachu-ex-123", lastmod: "2026-09-24" },
    { url: "/annonces/test?a=1&b=2", lastmod: "invalid" },
    { url: "/admin-secret", lastmod: "2026-09-24" }
  ]);
  assert.match(xml, /<loc>https:\/\/www\.cardoriashop\.fr\/annonces\/pikachu-ex-123<\/loc>/);
  assert.match(xml, /<lastmod>2026-09-24<\/lastmod>/);
  assert.match(xml, /test\?a=1&amp;b=2/);
  assert.doesNotMatch(xml, /<lastmod>invalid<\/lastmod>/);
  assert.doesNotMatch(xml, /admin-secret/);
});

test("security middleware keeps marketplace sitemap crawlable while other API routes stay noindex", async () => {
  const require = createRequire(new URL("../backend/package.json", import.meta.url));
  const express = require("express");
  const app = express();
  applySecurityMiddleware(app);
  app.use((req, res) => res.status(200).send("ok"));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;

  try {
    const sitemap = await fetch(base + MARKETPLACE_SITEMAP, {
      method: "HEAD",
      headers: { Host: "www.cardoriashop.fr" }
    });
    assert.equal(sitemap.status, 200);
    assert.equal(
      sitemap.headers.get("x-robots-tag"),
      "index, follow, max-image-preview:large,max-snippet:-1,max-video-preview:-1"
    );

    const privateApi = await fetch(base + "/api/marketplace/v1/sitemap/listings", {
      method: "HEAD",
      headers: { Host: "www.cardoriashop.fr" }
    });
    assert.equal(privateApi.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
