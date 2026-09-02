/**
 * Générateur automatique de pages SEO — licences, extensions, cartes.
 */
import { getDb } from "../engine/database.js";
import { listLicenses } from "../engine/licenses.js";
import { getSitemapCards, getCardCount } from "../engine/cards.js";

const SITE = process.env.SITE_URL || "https://www.cardoriashop.fr";
const SITE_NAME = "CardoriaShop";

const LICENSE_SEO = {
  pokemon: {
    h1: "Cartes Pokémon TCG — Prix, cote, estimation, achat & vente",
    intro: "Explorez le catalogue Pokémon TCG sur CardoriaShop : cartes françaises, anglaises, japonaises ou coréennes selon disponibilité, extensions, raretés, prix, cote et estimation.",
    keywords: ["cartes pokemon", "prix carte pokemon", "cote carte pokemon", "estimation carte pokemon", "pokemon tcg france"]
  },
  yugioh: {
    h1: "Cartes Yu-Gi-Oh! — Catalogue, cote & prix du marché",
    intro: "Explorez les cartes Yu-Gi-Oh! référencées sur CardoriaShop, leurs extensions et leurs données de prix pour identifier, estimer et collectionner vos cartes.",
    keywords: ["yu-gi-oh france", "cartes yugioh prix", "cote carte yugioh"]
  },
  onepiece: {
    h1: "One Piece Card Game — Catalogue, prix & estimation",
    intro: "Explorez le One Piece Card Game sur CardoriaShop : cartes, extensions, raretés et informations de prix pour suivre votre collection et préparer vos achats ou ventes.",
    keywords: ["one piece tcg", "cartes one piece", "prix carte one piece"]
  },
  lorcana: {
    h1: "Disney Lorcana — Catalogue, cartes, prix & estimation",
    intro: "Explorez le catalogue Disney Lorcana sur CardoriaShop : cartes, extensions, tendances et données de prix pour les collectionneurs en France.",
    keywords: ["lorcana france", "cartes disney lorcana", "prix carte lorcana"]
  },
  magic: {
    h1: "Magic: The Gathering — Catalogue de cartes & prix",
    intro: "Retrouvez les cartes Magic: The Gathering référencées sur CardoriaShop avec leurs extensions, informations de collection et données de prix disponibles.",
    keywords: ["magic the gathering france", "cartes magic prix", "cote carte magic"]
  },
  dragonball: {
    h1: "Dragon Ball Card Game — Cartes, extensions & prix",
    intro: "CardoriaShop référence les cartes Dragon Ball : extensions, raretés, informations de collection et données de prix disponibles.",
    keywords: ["dragon ball card game", "cartes dragon ball", "prix carte dragon ball"]
  },
  sports: {
    h1: "Cartes sportives — Panini, Topps & collectibles",
    intro: "Football, NBA, F1 : explorez les cartes sportives référencées sur CardoriaShop, notamment Panini et Topps, avec leurs informations de collection et de prix.",
    keywords: ["cartes sportives", "panini prizm france", "topps france"]
  }
};

export function listExtensions(licenseSlug) {
  const db = getDb();
  const rows = licenseSlug
    ? db.prepare("SELECT DISTINCT extension, license_slug, COUNT(*) AS card_count FROM cards WHERE active = 1 AND license_slug = ? AND extension <> '' GROUP BY extension ORDER BY extension").all(licenseSlug)
    : db.prepare("SELECT DISTINCT extension, license_slug, COUNT(*) AS card_count FROM cards WHERE active = 1 AND extension <> '' GROUP BY extension, license_slug ORDER BY license_slug, extension").all();
  return rows.map((r) => ({
    extension: r.extension,
    license: r.license_slug,
    cardCount: r.card_count,
    slug: slugifyExt(r.extension),
    url: `/extensions/${encodeURIComponent(r.license_slug)}/${encodeURIComponent(slugifyExt(r.extension))}`
  }));
}

export function slugifyExt(name) {
  return String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function generateLicensePages() {
  const db = getDb();
  const now = new Date().toISOString();
  const licenses = listLicenses();
  let count = 0;

  licenses.forEach((lic) => {
    const seo = LICENSE_SEO[lic.slug] || {
      h1: `Cartes ${lic.name} — ${SITE_NAME}`,
      intro: lic.description || `Catalogue ${lic.name} sur ${SITE_NAME}.`,
      keywords: [lic.name.toLowerCase()]
    };
    const id = `lic-${lic.slug}`;
    const urlPath = `/pages/licences/${lic.slug}/`;
    db.prepare(`
      INSERT INTO seo_generated_pages (id, page_type, slug, license_slug, title, meta_description, h1, content_json, url_path, updated_at)
      VALUES (?, 'license', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, meta_description = excluded.meta_description,
        h1 = excluded.h1, content_json = excluded.content_json, url_path = excluded.url_path, updated_at = excluded.updated_at
    `).run(
      id, lic.slug, lic.slug,
      `${lic.name} TCG — Prix, cote & catalogue | ${SITE_NAME}`,
      seo.intro.slice(0, 158),
      seo.h1,
      JSON.stringify({ intro: seo.intro, keywords: seo.keywords, icon: lic.icon, cardCount: lic.cardCount }),
      urlPath, now
    );
    count++;
  });
  return count;
}

export function generateExtensionPages() {
  const db = getDb();
  const now = new Date().toISOString();
  const extensions = listExtensions();
  let count = 0;

  extensions.forEach((ext) => {
    if (!ext.extension) return;
    const lic = listLicenses().find((l) => l.slug === ext.license);
    const id = `ext-${ext.license}-${ext.slug}`;
    db.prepare(`
      INSERT INTO seo_generated_pages (id, page_type, slug, license_slug, extension_name, title, meta_description, h1, content_json, url_path, updated_at)
      VALUES (?, 'extension', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, meta_description = excluded.meta_description,
        h1 = excluded.h1, content_json = excluded.content_json, url_path = excluded.url_path, updated_at = excluded.updated_at
    `).run(
      id, ext.slug, ext.license, ext.extension,
      `${ext.extension} — cartes, prix & liste ${lic?.name || ext.license} | ${SITE_NAME}`,
      `Découvrez les cartes ${ext.extension} (${lic?.name || ext.license}) : liste, numéros, raretés et données de prix. ${ext.cardCount} cartes référencées sur ${SITE_NAME}.`,
      `Cartes ${ext.extension} — ${lic?.name || ext.license}`,
      JSON.stringify({ extension: ext.extension, cardCount: ext.cardCount }),
      ext.url, now
    );
    count++;
  });
  return count;
}

export function getGeneratedPage(type, slug, license) {
  const row = getDb().prepare(`
    SELECT * FROM seo_generated_pages WHERE page_type = ? AND slug = ? AND (? = '' OR license_slug = ?)
  `).get(type, slug, license || "", license || "");
  if (!row) return null;
  let content = {};
  try { content = JSON.parse(row.content_json || "{}"); } catch { /* ignore */ }
  return {
    id: row.id,
    type: row.page_type,
    slug: row.slug,
    license: row.license_slug,
    extension: row.extension_name,
    title: row.title,
    metaDescription: row.meta_description,
    h1: row.h1,
    content,
    urlPath: row.url_path,
    updatedAt: row.updated_at
  };
}

export function listGeneratedPages({ type, license, limit = 100 } = {}) {
  let sql = "SELECT * FROM seo_generated_pages WHERE 1=1";
  const params = [];
  if (type) { sql += " AND page_type = ?"; params.push(type); }
  if (license) { sql += " AND license_slug = ?"; params.push(license); }
  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);
  return getDb().prepare(sql).all(...params).map((row) => {
    let content = {};
    try { content = JSON.parse(row.content_json || "{}"); } catch { /* ignore */ }
    return {
      id: row.id,
      type: row.page_type,
      slug: row.slug,
      license: row.license_slug,
      extension: row.extension_name,
      title: row.title,
      metaDescription: row.meta_description,
      h1: row.h1,
      content,
      urlPath: row.url_path,
      updatedAt: row.updated_at
    };
  });
}

export function getLicenseSeoContent(slug) {
  const page = getGeneratedPage("license", slug, slug);
  if (page) return page;
  const lic = listLicenses().find((l) => l.slug === slug);
  const seo = LICENSE_SEO[slug] || {};
  return {
    type: "license",
    slug,
    license: slug,
    title: `${lic?.name || slug} TCG — Prix, cote & catalogue | ${SITE_NAME}`,
    metaDescription: seo.intro || "",
    h1: seo.h1 || `Cartes ${lic?.name || slug}`,
    content: { intro: seo.intro, icon: lic?.icon, cardCount: lic?.cardCount },
    urlPath: `/pages/licences/${slug}/`
  };
}

export { LICENSE_SEO, SITE };
