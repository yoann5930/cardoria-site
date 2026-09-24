import fs from 'node:fs/promises';

// Temporary deep production SEO diagnostic. Public GET/HEAD requests only.
// This branch is diagnostic-only and must never be merged.
const BASE = 'https://www.cardoriashop.fr';
const ALLOWED = new Set(['www.cardoriashop.fr', 'cardoriashop.fr']);
const report = {
  checkedAt: new Date().toISOString(),
  productionBase: BASE,
  sitemap: {},
  licences: [],
  technicalPages: [],
  cards: {},
  warnings: [],
  indexingVerified: false
};

function allowed(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('URL outside allowed Cardoria HTTPS origins');
  }
  return url;
}

async function read(address, maxBytes = 20 * 1024 * 1024) {
  let url = allowed(address);
  const redirects = [];
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
      headers: {
        'User-Agent': 'CardoriaSEODeepAudit/1.0',
        Accept: 'text/html,application/xml,text/plain,*/*;q=0.5'
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without Location');
      const next = allowed(new URL(location, url).href);
      redirects.push({ status: response.status, from: url.href, to: next.href });
      await response.body?.cancel();
      url = next;
      continue;
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('Response exceeds audit size limit');
        }
        chunks.push(part.value);
      }
    }
    return {
      requestedUrl: address,
      finalUrl: url.href,
      redirects,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      xRobotsTag: response.headers.get('x-robots-tag') || '',
      text: Buffer.concat(chunks).toString('utf8'),
      bytes: size
    };
  }
  throw new Error('Too many redirects');
}

function xmlDecode(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function locs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => xmlDecode(m[1]));
}

function urlBlocks(xml) {
  return [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].map((m) => m[0]);
}

function attr(tag, name) {
  const match = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? '';
}

function stripHtml(value) {
  return xmlDecode(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function metaByName(html, name) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (attr(tag, 'name').toLowerCase() === name.toLowerCase()) return attr(tag, 'content');
  }
  return '';
}

function metaByProperty(html, name) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (attr(tag, 'property').toLowerCase() === name.toLowerCase()) return attr(tag, 'content');
  }
  return '';
}

function canonical(html) {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (attr(tag, 'rel').toLowerCase() === 'canonical') return attr(tag, 'href');
  }
  return '';
}

function findProduct(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }
  const type = value['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return value;
  if (value['@graph']) {
    const found = findProduct(value['@graph']);
    if (found) return found;
  }
  return null;
}

function pageSeo(result) {
  const html = result.text;
  const title = stripHtml(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  const description = metaByName(html, 'description');
  const robots = metaByName(html, 'robots');
  const h1 = stripHtml(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || '');
  const alts = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((m) => attr(m[0], 'alt'))
    .filter(Boolean)
    .slice(0, 12);
  const ld = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { ld.push(JSON.parse(m[1])); } catch {}
  }
  let product = null;
  for (const item of ld) {
    product = findProduct(item);
    if (product) break;
  }
  return {
    status: result.status,
    finalUrl: result.finalUrl,
    xRobotsTag: result.xRobotsTag,
    title,
    description,
    canonical: canonical(html),
    robots,
    h1,
    h1Count: [...html.matchAll(/<h1\b/gi)].length,
    structuredDataBlocks: ld.length,
    productPresent: Boolean(product),
    productHasImage: Boolean(product && Object.prototype.hasOwnProperty.call(product, 'image')),
    productImage: product?.image || null,
    productHasOffers: Boolean(product && Object.prototype.hasOwnProperty.call(product, 'offers')),
    ogImage: metaByProperty(html, 'og:image') || null,
    twitterImage: metaByName(html, 'twitter:image') || null,
    imageAlts: alts
  };
}

async function safeRead(address, maxBytes) {
  try {
    return await read(address, maxBytes);
  } catch (error) {
    report.warnings.push(address + ': ' + (error.cause?.code || error.message));
    return null;
  }
}

const robots = await safeRead(BASE + '/robots.txt', 2 * 1024 * 1024);
report.robots = robots ? {
  status: robots.status,
  bytes: robots.bytes,
  sitemapDeclared: /Sitemap:\s*https:\/\/www\.cardoriashop\.fr\/sitemap\.xml/i.test(robots.text),
  blocksTechnicalLivePayment: [
    '/live-vendeur.html',
    '/live-camera.html',
    '/marketplace-paiement-succes.html',
    '/marketplace-paiement-echec.html'
  ].every((path) => robots.text.includes('Disallow: ' + path))
} : null;

const index = await safeRead(BASE + '/sitemap.xml');
if (!index) throw new Error('Cannot read production sitemap index');
const childMaps = locs(index.text);
report.sitemap.index = {
  status: index.status,
  contentType: index.contentType,
  xRobotsTag: index.xRobotsTag,
  childCount: childMaps.length
};

let totalUrls = 0;
let totalImageEntries = 0;
let sampleWithImage = '';
let sampleWithoutImage = '';
const childReports = [];
let coreLocs = [];

for (const mapUrl of childMaps) {
  const child = await safeRead(mapUrl);
  if (!child) continue;
  const blocks = urlBlocks(child.text);
  const urls = blocks.map((block) => locs(block)[0]).filter(Boolean);
  const imageEntries = [...child.text.matchAll(/<image:image\b/gi)].length;
  totalUrls += urls.length;
  totalImageEntries += imageEntries;
  if (mapUrl.endsWith('/api/seo/core.xml')) coreLocs = urls;
  if (mapUrl.includes('/api/seo/cards-')) {
    if (!sampleWithImage) {
      const block = blocks.find((item) => /<image:image\b/i.test(item));
      if (block) sampleWithImage = locs(block)[0] || '';
    }
    if (!sampleWithoutImage) {
      const block = blocks.find((item) => !/<image:image\b/i.test(item));
      if (block) sampleWithoutImage = locs(block)[0] || '';
    }
  }
  childReports.push({
    url: mapUrl,
    status: child.status,
    contentType: child.contentType,
    xRobotsTag: child.xRobotsTag,
    urlCount: urls.length,
    imageEntries
  });
}

report.sitemap.totalUrls = totalUrls;
report.sitemap.totalImageEntries = totalImageEntries;
report.sitemap.children = childReports;

const licenceSlugs = ['pokemon', 'dragonball', 'lorcana', 'magic', 'onepiece', 'sports', 'yugioh'];
for (const slug of licenceSlugs) {
  const address = BASE + '/pages/licences/' + slug + '/';
  const page = await safeRead(address, 3 * 1024 * 1024);
  if (!page) continue;
  const robotsMeta = metaByName(page.text, 'robots');
  const noindex = /\bnoindex\b/i.test(robotsMeta + ' ' + page.xRobotsTag);
  report.licences.push({
    slug,
    status: page.status,
    inCoreSitemap: coreLocs.includes(address),
    xRobotsTag: page.xRobotsTag,
    robots: robotsMeta,
    noindex,
    title: stripHtml(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(page.text)?.[1] || ''),
    h1: stripHtml(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(page.text)?.[1] || '')
  });
}

const technical = [
  '/live-vendeur.html',
  '/live-camera.html',
  '/marketplace-paiement-succes.html',
  '/marketplace-paiement-echec.html',
  '/espace-vendeur.html',
  '/mes-annonces.html'
];
for (const path of technical) {
  const page = await safeRead(BASE + path, 3 * 1024 * 1024);
  if (!page) continue;
  const robotsMeta = metaByName(page.text, 'robots');
  report.technicalPages.push({
    path,
    status: page.status,
    redirects: page.redirects,
    xRobotsTag: page.xRobotsTag,
    robots: robotsMeta,
    noindex: /\bnoindex\b/i.test(robotsMeta + ' ' + page.xRobotsTag),
    nofollow: /\bnofollow\b/i.test(robotsMeta + ' ' + page.xRobotsTag)
  });
}

if (sampleWithImage) {
  const page = await safeRead(sampleWithImage, 5 * 1024 * 1024);
  report.cards.withImage = page ? { sitemapUrl: sampleWithImage, ...pageSeo(page) } : { sitemapUrl: sampleWithImage, error: true };
}
if (sampleWithoutImage) {
  const page = await safeRead(sampleWithoutImage, 5 * 1024 * 1024);
  report.cards.withoutImage = page ? { sitemapUrl: sampleWithoutImage, ...pageSeo(page) } : { sitemapUrl: sampleWithoutImage, error: true };
}

const emptyLicenceProblems = report.licences.filter((x) => x.slug !== 'pokemon' && (!x.noindex || x.inCoreSitemap));
if (emptyLicenceProblems.length) {
  report.warnings.push('Empty licence SEO policy mismatch: ' + emptyLicenceProblems.map((x) => x.slug).join(','));
}
const technicalProblems = report.technicalPages.filter((x) => !x.noindex || !x.nofollow);
if (technicalProblems.length) {
  report.warnings.push('Technical page robots mismatch: ' + technicalProblems.map((x) => x.path).join(','));
}
if (report.cards.withoutImage?.productHasImage) {
  report.warnings.push('No-image card still exposes Product.image');
}
if (report.cards.withImage && !report.cards.withImage.productHasImage) {
  report.warnings.push('Image card does not expose Product.image');
}

await fs.writeFile('seo-public-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log('SEO_DEEP_AUDIT=' + JSON.stringify(report));
if (report.warnings.length) console.log('SEO_DEEP_AUDIT_WARNINGS=' + report.warnings.length);
