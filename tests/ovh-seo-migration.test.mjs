import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("production sitemap generators default to the canonical OVH domain", () => {
  for (const path of ["scripts/generate-sitemap.mjs", "scripts/generate-launch-sitemap.mjs"]) {
    const source = read(path);
    assert.match(source, /https:\/\/www\.cardoriashop\.fr/);
    assert.doesNotMatch(source, /onrender\.com|cardoria\.vercel\.app/);
  }
});

test("public SEO files use canonical HTTPS URLs without a global crawl block", () => {
  const robots = read("robots.txt");
  const sitemap = read("sitemap.xml");
  const sitemapIndex = read("sitemap-index.xml");

  assert.doesNotMatch(robots, /^Disallow:\s*\/$/m);
  assert.match(robots, /Sitemap: https:\/\/www\.cardoriashop\.fr\/sitemap\.xml/);
  const locations = [...`${sitemap}\n${sitemapIndex}`.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(locations.length > 0);
  for (const location of locations) {
    assert.match(location, /^https:\/\/www\.cardoriashop\.fr\//);
    assert.doesNotMatch(location, /onrender\.com|vercel\.app/);
  }
});
