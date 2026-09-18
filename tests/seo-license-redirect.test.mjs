import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { once } from 'node:events';
import { createRequire } from 'node:module';

// Use the backend's exact Express dependency and the actual route registrations.
// The page renderer is stubbed; no production database or server bootstrap runs.
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
const source = await fs.readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
const start = source.indexOf('app.get("/pages/licences/:license",');
const end = source.indexOf('app.get("/extensions/:license/:slug",', start);
assert.ok(start >= 0 && end > start, 'Production license route block must exist');
const routeSource = source.slice(start, end);
let server;
let base;

before(async () => {
  const app = express();
  vm.runInNewContext(routeSource, {
    app,
    encodeURIComponent,
    sendLicenseSeoPage(req, res) {
      if (req.params.license === 'missing') return res.status(404).send('Unknown license');
      return res.status(200).type('html').send(`<h1>${req.params.license}</h1>`);
    }
  }, { timeout: 1000 });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, method = 'GET') {
  const response = await fetch(base + path, { method, redirect: 'manual', signal: AbortSignal.timeout(3000) });
  return { status: response.status, location: response.headers.get('location'), text: await response.text() };
}

test('canonical Pokemon URL is served instead of redirecting to itself', async () => {
  const response = await request('/pages/licences/pokemon/');
  assert.equal(response.status, 200);
  assert.equal(response.location, null);
  assert.equal(response.text, '<h1>pokemon</h1>');
});

test('URL without trailing slash redirects exactly once to the working canonical', async () => {
  const first = await request('/pages/licences/pokemon');
  assert.equal(first.status, 308);
  assert.equal(first.location, '/pages/licences/pokemon/');
  const second = await request(first.location);
  assert.equal(second.status, 200);
  assert.equal(second.location, null);
});

test('canonical URL with query parameters does not loop', async () => {
  const response = await request('/pages/licences/pokemon/?utm_source=test');
  assert.equal(response.status, 200);
  assert.equal(response.location, null);
});

test('HEAD request to canonical URL does not redirect', async () => {
  const response = await request('/pages/licences/pokemon/', 'HEAD');
  assert.equal(response.status, 200);
  assert.equal(response.location, null);
  assert.equal(response.text, '');
});

test('unknown canonical license reaches the renderer 404 rather than a redirect loop', async () => {
  const response = await request('/pages/licences/missing/');
  assert.equal(response.status, 404);
  assert.equal(response.location, null);
});

test('the guard applies to every dynamic license slug, not just Pokemon', async () => {
  for (const slug of ['one-piece', 'lorcana', 'magic']) {
    const response = await request(`/pages/licences/${slug}/`);
    assert.equal(response.status, 200, slug);
    assert.equal(response.location, null, slug);
  }
});
