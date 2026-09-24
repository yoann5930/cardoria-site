import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { cleanSeoTemplate, renderCardMain, positivePrice, safeImage } from '../backend/lib/seo/card-render.js';
import { buildCardSeoMeta } from '../backend/lib/seo/card-meta.js';

// Production functions and templates are executed; only catalogue storage is
// replaced with fixtures. No server bootstrap, payments or production database.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
const start = source.indexOf('function escapeHtml(');
const end = source.indexOf('function sendPublicFile(', start);
assert.ok(start >= 0 && end > start);
const SITE = 'https://www.cardoriashop.fr';
const card = { id: 'seo-fixture', slug: 'pikachu-test', license: 'pokemon', licenseName: 'Pokémon', language: 'fr', name: 'Pikachu', extension: 'Extension test', number: '25', rarity: 'Commune', imageThumb: 'https://images.example.test/card.png', prices: { avg: 0, low: 0, high: 0, recommended: 0 }, salesHistory: [] };
const CARD_PATH = '/cartes/pokemon/' + card.slug;

function renderers(publicRoot = ROOT) {
  const context = vm.createContext({ fs, path, PUBLIC_ROOT: publicRoot, cleanSeoTemplate, renderCardMain, positivePrice, safeImage, buildCardSeoMeta,
    getCardBySlug: (_license, slug) => slug === card.slug ? card : null,
    getLicense: (slug) => slug === 'pokemon' ? { slug, name: 'Pokémon' } : null,
    getLicenseSeoContent: () => ({ title: 'Catalogue Pokémon | Cardoria', metaDescription: 'Catalogue de cartes Pokémon.', h1: 'Cartes Pokémon', content: { intro: 'Retrouvez les cartes et leurs extensions.' } }),
    listExtensions: () => [{ slug: 'extension-test', extension: 'Extension test', cardCount: 1 }],
    searchCards: () => ({ cards: [card] })
  });
  vm.runInContext(source.slice(start, end), context, { timeout: 1000 });
  return context;
}
const api = renderers();
const html = (value = card) => api.buildCardSeoHtml({}, value);
const schemas = (value) => [...value.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const count = (value, pattern) => [...value.matchAll(pattern)].length;

test('real card renderer sends one H1, identifiers and image before JavaScript', () => {
  const output = html();
  assert.equal(count(output, /<h1\b/g), 1);
  assert.match(output, /<h1>Pikachu<\/h1>/);
  assert.match(output, /Extension test/);
  assert.match(output, /data-server-rendered="true"/);
  assert.match(output, /https:\/\/images.example.test\/card.png/);
  assert.doesNotMatch(output, /Chargement de la fiche carte/);
});

test('canonical, description and robots are unique in the real card response', () => {
  const output = html();
  assert.equal(count(output, /rel="canonical"/g), 1);
  assert.equal(count(output, /name="description"/g), 1);
  assert.equal(count(output, /name="robots"/g), 1);
  assert.ok(output.includes(`href="${SITE}${CARD_PATH}"`));
  assert.ok(output.indexOf('name="cardoria:server-seo"') < output.indexOf('src="/js/seo.js"'));
});

test('card SSR title and description include identity, extension, language and licence', () => {
  const jirachi = {
    ...card,
    slug: 'jirachi-ex-deoxys-9',
    name: 'Jirachi',
    number: '9',
    extension: 'EX Deoxys',
    rarity: 'Rare',
    language: 'fr'
  };
  const output = html(jirachi);
  assert.match(output, /<title>Jirachi 9 EX Deoxys FR – Carte Pokémon, prix &amp; cote \| Cardoria<\/title>/);
  assert.match(output, /<meta name="description" content="Jirachi 9, carte Pokémon de l&#39;extension EX Deoxys, version FR, rareté Rare\. Consultez son visuel, son prix et sa cote sur Cardoria\.">/);
});

test('card SEO language codes are explicit and metadata stays compact', () => {
  for (const [language, code] of [['fr', 'FR'], ['en', 'EN'], ['ja', 'JP'], ['ko', 'KR']]) {
    const meta = buildCardSeoMeta({ ...card, language });
    assert.match(meta.title, new RegExp(' ' + code + ' – Carte Pokémon, prix & cote \\| Cardoria
test('unknown prices are not zero-valued offers or reference estimates', () => {
  const output = html();
  assert.equal(count(output, />Non disponible</g), 4);
  const product = schemas(output).find((item) => item['@type'] === 'Product');
  assert.ok(product);
  assert.equal(product.offers, undefined);
  assert.equal(product.additionalProperty.some((item) => item.name === 'Prix conseillé'), false);
});

test('genuine positive reference price is retained without inventing sale offers', () => {
  const product = schemas(html({ ...card, prices: { recommended: 12.5 } })).find((item) => item['@type'] === 'Product');
  assert.equal(product.additionalProperty.find((item) => item.name === 'Prix conseillé').value, 12.5);
  assert.equal(product.offers, undefined);
});

test('price validation rejects absent, non-finite and nonnumeric values', () => {
  for (const value of [null, undefined, '', ' ', 0, -1, Infinity, NaN, true, {}, 'unknown']) assert.equal(positivePrice(value), null);
  assert.equal(positivePrice('12.50'), 12.5);
});

test('relative menu links resolve from the domain root, not inside a card slug', () => {
  const output = html();
  assert.match(output, /href="\/boutique.html"/);
  assert.match(output, /href="\/"/);
  assert.doesNotMatch(output, /href="[a-z-]+\.html"/);
  assert.match(output, /src="\/js\/carte.js"/);
});

test('markup and replacement tokens in catalogue text remain literal text', () => {
  const output = html({ ...card, name: '<script>bad()</script> $&', meta: { title: '<img> $&', description: '<test> $&' } });
  assert.doesNotMatch(output, /<script>bad\(\)<\/script>/);
  assert.match(output, /&lt;script&gt;bad\(\)&lt;\/script&gt; \$&amp;/);
  assert.match(output, /<title>&lt;img&gt; \$&amp;<\/title>/);
  assert.equal(schemas(output).find((item) => item['@type'] === 'Product').name, '<script>bad()</script> $&');
});

test('unsafe image schemes and embedded credentials are refused', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.test/x', '']) assert.equal(safeImage(url), '');
  const output = html({ ...card, imageHd: 'javascript:alert(1)' });
  assert.doesNotMatch(output, /javascript:alert/);
  assert.match(output, /images.example.test\/card.png/);
});

test('metadata cleanup preserves verification, styles and explicit noindex', () => {
  const template = '<html><head><meta name="google-site-verification" content="keep"><meta name="robots" content="noindex,nofollow"><meta name="googlebot" content="noindex"><link rel="stylesheet" href="/style.css"><link rel="canonical" href="https://wrong.test/"><meta property="og:title" content="old"></head><body></body></html>';
  const output = cleanSeoTemplate(template);
  assert.match(output, /google-site-verification" content="keep/);
  assert.match(output, /robots" content="noindex,nofollow/);
  assert.match(output, /googlebot" content="noindex/);
  assert.match(output, /rel="stylesheet"/);
  assert.doesNotMatch(output, /wrong.test|og:title/);
});

test('OVH mirror template receives the same useful initial card content', () => {
  const output = renderers(path.join(ROOT, 'backend/public')).buildCardSeoHtml({}, card);
  assert.match(output, /<h1>Pikachu<\/h1>/);
  assert.equal(count(output, /rel="canonical"/g), 1);
});

test('real license and extension renderers retain their own metadata and card links', () => {
  const license = api.buildLicenseSeoHtml({}, 'pokemon');
  const extension = api.buildExtensionSeoHtml({}, 'pokemon', 'extension-test');
  for (const output of [license, extension]) {
    assert.equal(count(output, /<h1\b/g), 1);
    assert.equal(count(output, /rel="canonical"/g), 1);
    assert.equal(count(output, /name="description"/g), 1);
    assert.match(output, /href="\/cartes\/pokemon\/pikachu-test"/);
    assert.ok(output.indexOf('cardoria:server-seo') < output.indexOf('/js/seo.js'));
  }
  assert.ok(license.includes(`href="${SITE}/pages/licences/pokemon/"`));
  assert.ok(extension.includes(`href="${SITE}/extensions/pokemon/extension-test"`));
  assert.match(
    extension,
    /<meta name="description" content="Découvrez les cartes Extension test \(Pokémon\) : liste, numéros, raretés et données de prix\. 1 cartes référencées sur Cardoria\.">/
  );
});

test('SSR injector adds a description when the public template has none', () => {
  const extension = api.buildExtensionSeoHtml({}, 'pokemon', 'extension-test');
  assert.equal(count(extension, /name="description"/g), 1);
  assert.ok(extension.indexOf('name="description"') < extension.indexOf('</head>'));
  assert.doesNotMatch(extension, /<meta name="description" content="">/);
});

test('missing card stays a real 404 with noindex', () => {
  let status, body;
  const response = { status(value) { status = value; return this; }, type() { return this; }, send(value) { body = value; return this; } };
  api.sendCardSeoPage({ params: { license: 'pokemon', slug: 'missing' } }, response, (error) => { throw error; });
  assert.equal(status, 404);
  assert.match(body, /content="noindex"/);
});

// Opt-in real Chromium tests. External requests are intercepted, catalogue API
// responses are fixtures, unrelated application scripts are not executed.
const browserOptions = { skip: process.env.SEO_BROWSER_TESTS !== '1', timeout: 60000 };
async function browserCheck({ javascript = true, apiFailure = false, pagePath = CARD_PATH }, check) {
  const { chromium } = await import('playwright');
  const require = createRequire(new URL('../backend/package.json', import.meta.url));
  const app = require('express')();
  const context = renderers(path.join(ROOT, 'backend/public'));
  context.app = app;
  const routesStart = source.indexOf('app.get(["/boutique"');
  const routesEnd = source.indexOf('app.get("/robots.txt"', routesStart);
  assert.ok(routesStart >= 0 && routesEnd > routesStart);
  vm.runInContext(source.slice(routesStart, routesEnd), context, { timeout: 1000 });
  app.use(require('express').static(path.join(ROOT, 'backend/public')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ javaScriptEnabled: javascript });
    const allowedScripts = new Set(['/js/seo-config.js', '/js/seo.js', '/js/engine-client.js', '/js/carte.js']);
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/engine/cards/')) {
        if (apiFailure) return route.abort('failed');
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, card }), headers: { 'access-control-allow-origin': '*' } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"trends":[],"history":{"points":[]}}', headers: { 'access-control-allow-origin': '*' } });
      if (url.origin !== base) return route.abort();
      if (request.resourceType() === 'script' && !allowedScripts.has(url.pathname)) return route.fulfill({ contentType: 'application/javascript', body: '// Outside focused SEO test.' });
      return route.continue();
    });
    const response = await page.goto(base + pagePath, { waitUntil: 'networkidle', timeout: 30000 });
    assert.equal(response.status(), 200);
    await check(page);
    await page.close();
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Chromium without JavaScript displays the full initial reference card', browserOptions, async () => {
  await browserCheck({ javascript: false }, async (page) => {
    assert.equal(await page.locator('#cardPage h1').textContent(), card.name);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), SITE + CARD_PATH);
    assert.equal(await page.locator('.engine-price-box strong').allTextContents().then((v) => v.join('|')), Array(4).fill('Non disponible').join('|'));
  });
});

test('Chromium with JavaScript keeps the card canonical and exactly one Product and breadcrumb', browserOptions, async () => {
  await browserCheck({}, async (page) => {
    await page.locator('#historyPeriods').waitFor(); // Proves carte.js rendered.
    assert.equal(await page.locator('#cardPage h1').textContent(), card.name);
    assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), SITE + CARD_PATH);
    assert.match(await page.title(), /Pikachu/);
    const json = await page.locator('script[type="application/ld+json"]').allTextContents();
    const data = json.map((value) => JSON.parse(value));
    assert.equal(data.filter((item) => item['@type'] === 'Product').length, 1);
    assert.equal(data.filter((item) => item['@type'] === 'BreadcrumbList').length, 1);
    assert.equal(data.some((item) => item.offers), false);
    assert.equal(await page.locator('.engine-price-box strong').first().textContent(), 'Non disponible');
  });
});

test('Chromium retains useful server HTML when the catalogue API is unavailable', browserOptions, async () => {
  await browserCheck({ apiFailure: true }, async (page) => {
    assert.equal(await page.locator('#cardPage h1').textContent(), card.name);
    assert.equal(await page.locator('#cardPage').getAttribute('data-server-rendered'), 'true');
    assert.doesNotMatch(await page.locator('#cardPage').textContent(), /Erreur de chargement/);
  });
});

test('Chromium generic SEO script preserves license and extension canonicals', browserOptions, async () => {
  for (const pagePath of ['/pages/licences/pokemon/', '/extensions/pokemon/extension-test']) {
    await browserCheck({ pagePath }, async (page) => {
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), SITE + pagePath);
      assert.equal(await page.locator('h1').count(), 1);
    });
  }
});
));
    assert.ok(meta.title.length <= 95, meta.title);
    assert.ok(meta.description.length <= 158, meta.description);
    assert.match(meta.description, new RegExp('version ' + code));
  }
});

test('unknown prices are not zero-valued offers or reference estimates', () => {
  const output = html();
  assert.equal(count(output, />Non disponible</g), 4);
  const product = schemas(output).find((item) => item['@type'] === 'Product');
  assert.ok(product);
  assert.equal(product.offers, undefined);
  assert.equal(product.additionalProperty.some((item) => item.name === 'Prix conseillé'), false);
});

test('genuine positive reference price is retained without inventing sale offers', () => {
  const product = schemas(html({ ...card, prices: { recommended: 12.5 } })).find((item) => item['@type'] === 'Product');
  assert.equal(product.additionalProperty.find((item) => item.name === 'Prix conseillé').value, 12.5);
  assert.equal(product.offers, undefined);
});

test('price validation rejects absent, non-finite and nonnumeric values', () => {
  for (const value of [null, undefined, '', ' ', 0, -1, Infinity, NaN, true, {}, 'unknown']) assert.equal(positivePrice(value), null);
  assert.equal(positivePrice('12.50'), 12.5);
});

test('relative menu links resolve from the domain root, not inside a card slug', () => {
  const output = html();
  assert.match(output, /href="\/boutique.html"/);
  assert.match(output, /href="\/"/);
  assert.doesNotMatch(output, /href="[a-z-]+\.html"/);
  assert.match(output, /src="\/js\/carte.js"/);
});

test('markup and replacement tokens in catalogue text remain literal text', () => {
  const output = html({ ...card, name: '<script>bad()</script> $&', meta: { title: '<img> $&', description: '<test> $&' } });
  assert.doesNotMatch(output, /<script>bad\(\)<\/script>/);
  assert.match(output, /&lt;script&gt;bad\(\)&lt;\/script&gt; \$&amp;/);
  assert.match(output, /<title>&lt;img&gt; \$&amp;<\/title>/);
  assert.equal(schemas(output).find((item) => item['@type'] === 'Product').name, '<script>bad()</script> $&');
});

test('unsafe image schemes and embedded credentials are refused', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.test/x', '']) assert.equal(safeImage(url), '');
  const output = html({ ...card, imageHd: 'javascript:alert(1)' });
  assert.doesNotMatch(output, /javascript:alert/);
  assert.match(output, /images.example.test\/card.png/);
});

test('metadata cleanup preserves verification, styles and explicit noindex', () => {
  const template = '<html><head><meta name="google-site-verification" content="keep"><meta name="robots" content="noindex,nofollow"><meta name="googlebot" content="noindex"><link rel="stylesheet" href="/style.css"><link rel="canonical" href="https://wrong.test/"><meta property="og:title" content="old"></head><body></body></html>';
  const output = cleanSeoTemplate(template);
  assert.match(output, /google-site-verification" content="keep/);
  assert.match(output, /robots" content="noindex,nofollow/);
  assert.match(output, /googlebot" content="noindex/);
  assert.match(output, /rel="stylesheet"/);
  assert.doesNotMatch(output, /wrong.test|og:title/);
});

test('OVH mirror template receives the same useful initial card content', () => {
  const output = renderers(path.join(ROOT, 'backend/public')).buildCardSeoHtml({}, card);
  assert.match(output, /<h1>Pikachu<\/h1>/);
  assert.equal(count(output, /rel="canonical"/g), 1);
});

test('real license and extension renderers retain their own metadata and card links', () => {
  const license = api.buildLicenseSeoHtml({}, 'pokemon');
  const extension = api.buildExtensionSeoHtml({}, 'pokemon', 'extension-test');
  for (const output of [license, extension]) {
    assert.equal(count(output, /<h1\b/g), 1);
    assert.equal(count(output, /rel="canonical"/g), 1);
    assert.equal(count(output, /name="description"/g), 1);
    assert.match(output, /href="\/cartes\/pokemon\/pikachu-test"/);
    assert.ok(output.indexOf('cardoria:server-seo') < output.indexOf('/js/seo.js'));
  }
  assert.ok(license.includes(`href="${SITE}/pages/licences/pokemon/"`));
  assert.ok(extension.includes(`href="${SITE}/extensions/pokemon/extension-test"`));
  assert.match(
    extension,
    /<meta name="description" content="Découvrez les cartes Extension test \(Pokémon\) : liste, numéros, raretés et données de prix\. 1 cartes référencées sur Cardoria\.">/
  );
});

test('SSR injector adds a description when the public template has none', () => {
  const extension = api.buildExtensionSeoHtml({}, 'pokemon', 'extension-test');
  assert.equal(count(extension, /name="description"/g), 1);
  assert.ok(extension.indexOf('name="description"') < extension.indexOf('</head>'));
  assert.doesNotMatch(extension, /<meta name="description" content="">/);
});

test('missing card stays a real 404 with noindex', () => {
  let status, body;
  const response = { status(value) { status = value; return this; }, type() { return this; }, send(value) { body = value; return this; } };
  api.sendCardSeoPage({ params: { license: 'pokemon', slug: 'missing' } }, response, (error) => { throw error; });
  assert.equal(status, 404);
  assert.match(body, /content="noindex"/);
});

// Opt-in real Chromium tests. External requests are intercepted, catalogue API
// responses are fixtures, unrelated application scripts are not executed.
const browserOptions = { skip: process.env.SEO_BROWSER_TESTS !== '1', timeout: 60000 };
async function browserCheck({ javascript = true, apiFailure = false, pagePath = CARD_PATH }, check) {
  const { chromium } = await import('playwright');
  const require = createRequire(new URL('../backend/package.json', import.meta.url));
  const app = require('express')();
  const context = renderers(path.join(ROOT, 'backend/public'));
  context.app = app;
  const routesStart = source.indexOf('app.get(["/boutique"');
  const routesEnd = source.indexOf('app.get("/robots.txt"', routesStart);
  assert.ok(routesStart >= 0 && routesEnd > routesStart);
  vm.runInContext(source.slice(routesStart, routesEnd), context, { timeout: 1000 });
  app.use(require('express').static(path.join(ROOT, 'backend/public')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ javaScriptEnabled: javascript });
    const allowedScripts = new Set(['/js/seo-config.js', '/js/seo.js', '/js/engine-client.js', '/js/carte.js']);
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/engine/cards/')) {
        if (apiFailure) return route.abort('failed');
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, card }), headers: { 'access-control-allow-origin': '*' } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"trends":[],"history":{"points":[]}}', headers: { 'access-control-allow-origin': '*' } });
      if (url.origin !== base) return route.abort();
      if (request.resourceType() === 'script' && !allowedScripts.has(url.pathname)) return route.fulfill({ contentType: 'application/javascript', body: '// Outside focused SEO test.' });
      return route.continue();
    });
    const response = await page.goto(base + pagePath, { waitUntil: 'networkidle', timeout: 30000 });
    assert.equal(response.status(), 200);
    await check(page);
    await page.close();
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Chromium without JavaScript displays the full initial reference card', browserOptions, async () => {
  await browserCheck({ javascript: false }, async (page) => {
    assert.equal(await page.locator('#cardPage h1').textContent(), card.name);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), SITE + CARD_PATH);
    assert.equal(await page.locator('.engine-price-box strong').allTextContents().then((v) => v.join('|')), Array(4).fill('Non disponible').join('|'));
  });
});

test('Chromium with JavaScript keeps the card canonical and exactly one Product and breadcrumb', browserOptions, async () => {
  await browserCheck({}, async (page) => {
    await page.locator('#historyPeriods').waitFor(); // Proves carte.js rendered.
    assert.equal(await page.locator('#cardPage h1').textContent(), card.name);
    assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), SITE + CARD_PATH);
    assert.match(await page.title(), /Pikachu/);
    const json = await page.locator('script[type="application/ld+json"]').allTextContents();
    const data = json.map((value) => JSON.parse(value));
    assert.equal(data.filter((item) => item['@type'] === 'Product').length, 1);
    assert.equal(data.filter((item) => item['@type'] === 'BreadcrumbList').length, 1);
    assert.equal(data.some((item) => item.offers), false);
    assert.equal(await page.locator('.engine-price-box strong').first().textContent(), 'Non disponible');
  });
});

test('Chromium retains useful server HTML when the catalogue API is unavailable', browserOptions, async () => {
  await browserCheck({ apiFailure: true }, async (page) => {
    assert.equal(await page.locator('#cardPage h1').textContent(), card.name);
    assert.equal(await page.locator('#cardPage').getAttribute('data-server-rendered'), 'true');
    assert.doesNotMatch(await page.locator('#cardPage').textContent(), /Erreur de chargement/);
  });
});

test('Chromium generic SEO script preserves license and extension canonicals', browserOptions, async () => {
  for (const pagePath of ['/pages/licences/pokemon/', '/extensions/pokemon/extension-test']) {
    await browserCheck({ pagePath }, async (page) => {
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), SITE + pagePath);
      assert.equal(await page.locator('h1').count(), 1);
    });
  }
});
