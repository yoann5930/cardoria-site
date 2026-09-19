import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual production module; only database-backed imports are stubbed.
// Run with: node --experimental-vm-modules --test tests/seo-sitemap-lastmod.test.mjs
const sourceUrl = process.env.SEO_SITEMAP_SOURCE
  ? new URL(process.env.SEO_SITEMAP_SOURCE)
  : new URL('../backend/lib/seo/sitemap.js', import.meta.url);
const source = await fs.readFile(sourceUrl, 'utf8');
const SITE = 'https://www.cardoriashop.fr';

async function load({ cards = [], posts = [], licenses = [], extensions = [], count = cards.length } = {}) {
  const calls = [];
  const context = vm.createContext({});
  const imports = {
    './blog.js': { listBlogPosts: () => posts },
    './generator.js': { SITE, listExtensions: () => extensions, listGeneratedPages: () => [] },
    '../engine/licenses.js': { listLicenses: () => licenses },
    '../engine/cards.js': {
      getCardCount: () => count,
      getSitemapCards: (limit, offset) => { calls.push({ limit, offset }); return cards; }
    }
  };
  const module = new vm.SourceTextModule(source, { context, identifier: sourceUrl.href });
  await module.link((specifier) => {
    const bindings = imports[specifier];
    assert.ok(bindings, `Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(bindings), function () {
      for (const [name, value] of Object.entries(bindings)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, calls };
}

const tags = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, 'g'))].map((match) => match[1]);

test('index omits fabricated modification dates and keeps every card partition', async () => {
  const { api } = await load({ count: 20001 });
  const xml = api.generateSitemapIndexXml();
  assert.deepEqual(tags(xml, 'lastmod'), []);
  assert.deepEqual(tags(xml, 'loc'), [
    `${SITE}/api/seo/core.xml`, `${SITE}/api/seo/cards-1.xml`,
    `${SITE}/api/seo/cards-2.xml`, `${SITE}/api/seo/cards-3.xml`
  ]);
  assert.equal(api.generateSitemapXml(), xml);
});

test('static, license and extension pages do not pretend to change every day', async () => {
  const { api } = await load({
    licenses: [{ slug: 'pokemon' }],
    extensions: [{ url: '/extensions/pokemon/test', license: 'pokemon' }]
  });
  const xml = api.generateCoreSitemapXml();
  assert.deepEqual(tags(xml, 'lastmod'), []);
  assert.ok(tags(xml, 'loc').includes(`${SITE}/boutique.html`));
  assert.ok(tags(xml, 'loc').includes(`${SITE}/pages/licences/pokemon/`));
  assert.ok(tags(xml, 'loc').includes(`${SITE}/extensions/pokemon/test`));
  // URLs carrying explicit noindex directives must never be advertised as sitemap targets.
  assert.ok(!tags(xml, 'loc').includes(`${SITE}/rachat-cartes.html`));
  assert.ok(!tags(xml, 'loc').includes(`${SITE}/licence.html`));
});

test('blog keeps genuine update and creation dates', async () => {
  const { api } = await load({ posts: [
    { url: '/pages/blog/updated/', updatedAt: '2025-08-14T12:30:45.123Z', createdAt: '2025-07-01' },
    { url: '/pages/blog/created/', createdAt: '2025-06-10' }
  ] });
  assert.deepEqual(tags(api.generateCoreSitemapXml(), 'lastmod'), ['2025-08-14', '2025-06-10']);
});

test('blog with no stored date has no invented lastmod', async () => {
  const { api } = await load({ posts: [{ url: '/pages/blog/undated/' }] });
  assert.deepEqual(tags(api.generateCoreSitemapXml(), 'lastmod'), []);
});

test('card keeps its database update date, SQL or ISO timestamp', async () => {
  const { api } = await load({ cards: [
    { license_slug: 'pokemon', slug: 'one', updated_at: '2025-08-10 14:20:30' },
    { license_slug: 'pokemon', slug: 'two', updated_at: '2025-08-11T23:20:30+02:00' }
  ] });
  assert.deepEqual(tags(api.generateCardsSitemapXml(), 'lastmod'), ['2025-08-10', '2025-08-11']);
});

test('card with no stored date remains listed without invented lastmod', async () => {
  const { api } = await load({ cards: [{ license_slug: 'pokemon', slug: 'undated', updated_at: null }] });
  const xml = api.generateCardsSitemapXml();
  assert.deepEqual(tags(xml, 'lastmod'), []);
  assert.deepEqual(tags(xml, 'loc'), [`${SITE}/cartes/pokemon/undated`]);
});

test('invalid dates are omitted instead of emitted as malformed XML date values', async () => {
  const invalid = ['', 'not-a-date', '2025-02-30', '2025-13-01', '2025-02-29', '2025-08-10T99:99:99Z', '<invalid>', 123];
  for (const updated_at of invalid) {
    const { api } = await load({ cards: [{ license_slug: 'pokemon', slug: 'invalid', updated_at }] });
    assert.deepEqual(tags(api.generateCardsSitemapXml(), 'lastmod'), [], String(updated_at));
  }
});

test('valid leap-day date is preserved', async () => {
  const { api } = await load({ cards: [{ license_slug: 'pokemon', slug: 'leap', updated_at: '2024-02-29' }] });
  assert.deepEqual(tags(api.generateCardsSitemapXml(), 'lastmod'), ['2024-02-29']);
});

test('card pagination and URL escaping are unchanged', async () => {
  const { api, calls } = await load({ cards: [{ license_slug: 'pokemon', slug: 'a b&c', updated_at: '2025-08-10' }] });
  const xml = api.generateCardsSitemapXml(SITE + '/', 2, 10000);
  assert.deepEqual(calls, [{ limit: 10000, offset: 10000 }]);
  assert.deepEqual(tags(xml, 'loc'), [`${SITE}/cartes/pokemon/a%20b%26c`]);
});

test('empty catalogue keeps the core sitemap and no phantom card partitions', async () => {
  const { api } = await load();
  assert.deepEqual(tags(api.generateSitemapIndexXml(), 'loc'), [`${SITE}/api/seo/core.xml`]);
});

test('robots keeps public cards crawlable and advertises the canonical sitemap', async () => {
  const { api } = await load();
  const robots = api.generateRobotsTxt();
  assert.match(robots, /Allow: \/cartes\//);
  assert.match(robots, /Disallow: \/admin/);
  assert.ok(robots.endsWith(`Sitemap: ${SITE}/sitemap.xml`));
});


test('card sitemap exposes only real catalogue images with escaped metadata', async () => {
  const { api } = await load({ cards: [
    {
      license_slug: 'pokemon',
      slug: 'image-card',
      name: 'Pikachu & Friends',
      extension: 'Test <Set>',
      number: '1/100',
      image_hd: 'https://images.example/card?a=1&b=2',
      image_thumb: '',
      updated_at: '2026-09-19'
    },
    {
      license_slug: 'pokemon',
      slug: 'no-image',
      name: 'No image',
      image_hd: '',
      image_thumb: '',
      updated_at: '2026-09-19'
    }
  ] });
  const xml = api.generateCardsSitemapXml();
  assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(xml, /<image:image>/);
  assert.match(xml, /<image:loc>https:\/\/images\.example\/card\?a=1&amp;b=2<\/image:loc>/);
  assert.match(xml, /<image:title>Pikachu &amp; Friends — Test &lt;Set&gt; — 1\/100<\/image:title>/);
  assert.equal((xml.match(/<image:image>/g) || []).length, 1);
});
