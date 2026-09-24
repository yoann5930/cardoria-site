import fs from 'node:fs/promises';

// Public GET requests only: no credentials, administration endpoints or mutations.
// These checks do not query Search Console or prove Google indexing.
const BASE = 'https://www.cardoriashop.fr';
const ALLOWED = new Set(['www.cardoriashop.fr', 'cardoriashop.fr']);
const report = { checkedAt: new Date().toISOString(), checks: [], warnings: [], indexingVerified: false };

function allowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('Redirect or sitemap URL outside the permitted public HTTPS origins');
  }
  return url;
}

async function readPublic(address) {
  const check = { requestedUrl: address, redirects: [] };
  report.checks.push(check);
  try {
    let url = allowedUrl(address);
    for (let hop = 0; hop < 5; hop += 1) {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'CardoriaSEOAudit/1.0', Accept: 'text/html,application/xml,text/plain,*/*;q=0.5' }
      });
      check.status = response.status;
      check.finalUrl = url.href;
      check.contentType = response.headers.get('content-type');
      check.xRobotsTag = response.headers.get('x-robots-tag');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect without Location');
        const next = new URL(location, url);
        check.redirects.push({ status: response.status, from: url.href, to: next.href });
        await response.body?.cancel();
        url = allowedUrl(next.href);
        continue;
      }
      // Bound downloaded sitemap/HTML size to 5 MiB.
      const reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 5 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('Response exceeds the 5 MiB audit limit');
          }
          chunks.push(value);
        }
      }
      check.bytes = size;
      if (!response.ok) report.warnings.push(`${address}: HTTP ${response.status}`);
      return { check, text: Buffer.concat(chunks).toString('utf8') };
    }
    throw new Error('Too many redirects');
  } catch (error) {
    check.error = error.cause?.code || error.message;
    report.warnings.push(`${address}: ${check.error}`);
    return { check, text: '' };
  }
}

function attribute(tag, name) {
  return new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(tag)?.[1] || '';
}
function pageMetadata(result) {
  const { check, text } = result;
  check.title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim() || '';
  check.canonical = [...text.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0]).filter((tag) => attribute(tag, 'rel').toLowerCase() === 'canonical')
    .map((tag) => attribute(tag, 'href'));
  check.robots = [...text.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0]).filter((tag) => ['robots', 'googlebot'].includes(attribute(tag, 'name').toLowerCase()))
    .map((tag) => attribute(tag, 'content'));
  check.h1Count = [...text.matchAll(/<h1\b/gi)].length;
  check.structuredDataBlocks = [...text.matchAll(/<script\b[^>]*type=["']application\/ld\+json["']/gi)].length;
  if (text && check.status === 200 && !check.title) report.warnings.push(`${check.requestedUrl}: missing HTML title`);
  if (text && check.status === 200 && check.canonical.length !== 1) report.warnings.push(`${check.requestedUrl}: expected one canonical`);
  if ([...check.robots, check.xRobotsTag || ''].some((value) => /\bnoindex\b/i.test(value))) report.warnings.push(`${check.requestedUrl}: noindex present`);
}
function locations(text) {
  return [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, '&'));
}

pageMetadata(await readPublic(BASE + '/'));
await readPublic('https://cardoriashop.fr/');
const robots = await readPublic(BASE + '/robots.txt');
robots.check.rules = robots.text.slice(0, 4000);
const index = await readPublic(BASE + '/sitemap.xml');
const maps = locations(index.text);
index.check.xmlKind = /<sitemapindex\b/.test(index.text) ? 'sitemapindex' : /<urlset\b/.test(index.text) ? 'urlset' : 'unknown';
index.check.entryCount = maps.length;
index.check.sampleLocations = maps.slice(0, 5);
if (index.text && index.check.xmlKind === 'unknown') report.warnings.push('The public sitemap response is not a sitemap XML document');
if (index.check.xmlKind === 'sitemapindex') {
  for (const address of maps.slice(0, 2)) {
    const child = await readPublic(address);
    const urls = locations(child.text);
    child.check.entryCount = urls.length;
    child.check.sampleLocations = urls.slice(0, 3);
    child.check.lastmodCount = [...child.text.matchAll(/<lastmod>/g)].length;
    if (/\bnoindex\b/i.test(child.check.xRobotsTag || '')) {
      report.warnings.push(`${address}: sitemap response must not carry noindex`);
    }
    if (child.check.status === 200 && !/xml/i.test(child.check.contentType || '')) {
      report.warnings.push(`${address}: sitemap content-type is not XML`);
    }
    const sampleCard = urls.find((url) => url.startsWith(BASE + '/cartes/'));
    if (sampleCard) pageMetadata(await readPublic(sampleCard));
  }
}
pageMetadata(await readPublic(BASE + '/pages/licences/pokemon/'));
await fs.writeFile('seo-public-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
// Report diagnostics without equating temporary remote failures with code test failures.
if (report.warnings.length) console.log('PUBLIC_AUDIT_WARNINGS=' + report.warnings.length);
