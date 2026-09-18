const htmlEscape = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function positivePrice(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function safeImage(value) {
  try {
    const url = new URL(String(value || ''));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function attribute(tag, name) {
  return new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag)?.slice(1).find((value) => value !== undefined) || '';
}

// Only remove metadata the server regenerates. Keep verification, CSS, icons,
// accessibility, scripts and unrelated tags intact. Normalize old relative menu links.
export function cleanSeoTemplate(template) {
  return String(template).replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, (head) => head
    .replace(/<link\b[^>]*>/gi, (tag) => attribute(tag, 'rel').toLowerCase() === 'canonical' ? '' : tag)
    .replace(/<meta\b[^>]*>/gi, (tag) => {
      const name = attribute(tag, 'name').toLowerCase();
      const property = attribute(tag, 'property').toLowerCase();
      return name === 'robots' || name === 'googlebot' || name.startsWith('twitter:') || property.startsWith('og:') ? '' : tag;
    })
  ).replace(/\bhref=(['"])([a-z0-9-]+\.html(?:[?#][^'"<>]*)?)\1/gi, (_match, quote, target) => {
    const normalized = target === 'index.html' ? '/' : '/' + target;
    return `href=${quote}${normalized}${quote}`;
  });
}

// Reference data, not a stock listing: do not create Offer/AggregateOffer or
// imply that a card is for sale. Missing market data must not become a zero price.
export function renderCardMain(card) {
  const license = card.license || card.licenseSlug || 'pokemon';
  const licenseName = card.licenseName || license;
  const name = card.name || 'Carte';
  const detail = (label, value) => `<div class="engine-meta-item"><label>${htmlEscape(label)}</label><strong>${htmlEscape(value || 'Non renseigné')}</strong></div>`;
  const money = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  const prices = card.prices || {};
  const priceBox = (label, value, recommended = false) => {
    const amount = positivePrice(value);
    return `<div class="engine-price-box${recommended ? ' recommended' : ''}"><label>${htmlEscape(label)}</label><strong>${amount === null ? 'Non disponible' : htmlEscape(money(amount))}</strong></div>`;
  };
  const image = safeImage(card.imageHd) || safeImage(card.imageThumb);
  const visual = image
    ? `<img src="${htmlEscape(image)}" alt="${htmlEscape([name, card.extension, card.number].filter(Boolean).join(' — '))}" loading="eager" fetchpriority="high" width="360" height="504">`
    : '<div class="placeholder" aria-label="Visuel indisponible">Visuel indisponible</div>';
  return `<main class="container engine-hero" id="cardPage" data-server-rendered="true">
<nav class="engine-breadcrumb" aria-label="Fil d’Ariane"><a href="/">Accueil</a> › <a href="/pages/licences/${encodeURIComponent(license)}/">${htmlEscape(licenseName)}</a> › ${htmlEscape(name)}</nav>
<h1>${htmlEscape(name)}</h1>
<div class="engine-card-layout"><div class="engine-card-visual">${visual}</div><div>
<div class="engine-meta-grid">${detail('Extension', card.extension)}${detail('Numéro', card.number)}${detail('Rareté', card.rarity)}${detail('Illustrateur', card.illustration)}${detail('État réf.', card.condition)}${detail('Licence', licenseName)}</div>
<div class="engine-prices">${priceBox('Prix moyen', prices.avg)}${priceBox('Prix bas', prices.low)}${priceBox('Prix haut', prices.high)}${priceBox('Prix conseillé', prices.recommended, true)}</div>
<p class="small">Données de référence lorsqu’elles sont disponibles, et non une offre de vente. La valeur dépend notamment de l’état, de la langue et de la version de la carte.</p>
<div class="actions" style="margin-top:18px"><a class="btn btn-primary" href="/estimation.html?card=${encodeURIComponent(card.id || '')}">Faire estimer cette carte</a> <a class="btn btn-secondary" href="/rachat-cartes.html">Vendre à Cardoria</a></div>
</div></div></main>`;
}
