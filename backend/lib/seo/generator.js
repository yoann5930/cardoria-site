/**
 * Générateur automatique de pages SEO — licences, extensions, cartes.
 */
import { getDb } from "../engine/database.js";
import { listLicenses } from "../engine/licenses.js";
import { getSitemapCards, getCardCount } from "../engine/cards.js";

const SITE = process.env.SITE_URL || "https://cardoria.vercel.app";

const LICENSE_SEO = {
  pokemon: {
    h1: "Cartes Pokémon TCG — Estimation, achat & vente",
    intro: "Cardoria expertises les cartes Pokémon : Set de Base, Écarlate et Violet, cartes promo et japonaises. Estimation IA, rachat express et marketplace premium.",
    keywords: ["cartes pokemon", "pokemon tcg france", "estimation pokemon"]
  },
  yugioh: {
    h1: "Cartes Yu-Gi-Oh! — Expertise & prix du marché",
    intro: "Du Légend of Blue Eyes White Dragon aux dernières extensions, Cardoria estime et rachète vos cartes Yu-Gi-Oh! avec transparence.",
    keywords: ["yu-gi-oh france", "cartes yugioh prix"]
  },
  onepiece: {
    h1: "One Piece Card Game — Catalogue & estimation",
    intro: "Luffy, Zoro, cartes Leader et SEC : Cardoria référence le One Piece Card Game avec estimation multi-sources et annonces marketplace.",
    keywords: ["one piece tcg", "cartes one piece"]
  },
  lorcana: {
    h1: "Disney Lorcana — Cartes & collectibles",
    intro: "Explorez le catalogue Lorcana sur Cardoria : prix conseillés, tendances et rachat de cartes Disney Lorcana en France.",
    keywords: ["lorcana france", "cartes disney lorcana"]
  },
  magic: {
    h1: "Magic: The Gathering — Fiches cartes & prix",
    intro: "Magic The Gathering sur Cardoria : cartes rares, éditions limitées, estimation professionnelle et comparateur de prix.",
    keywords: ["magic the gathering france", "cartes magic prix"]
  },
  dragonball: {
    h1: "Dragon Ball Super Card Game",
    intro: "Cardoria référence les cartes Dragon Ball Super : leaders, rares et alternatives. Estimation et vente entre collectionneurs.",
    keywords: ["dragon ball super card game"]
  },
  sports: {
    h1: "Cartes sportives — Panini, Topps & collectibles",
    intro: "Football, NBA, F1 : Cardoria estime vos cartes sportives Panini Prizm, Topps Chrome et autres éditions premium.",
    keywords: ["cartes sportives", "panini prizm france"]
  }
};

export function listExtensions(licenseSlug) {
  const db = getDb();
  const rows = licenseSlug
    ? db.prepare("SELECT DISTINCT extension, license_slug, COUNT(*) AS card_count FROM cards WHERE active = 1 AND license_slug = ? GROUP BY extension ORDER BY extension").all(licenseSlug)
    : db.prepare("SELECT DISTINCT extension, license_slug, COUNT(*) AS card_count FROM cards WHERE active = 1 GROUP BY extension, license_slug ORDER BY license_slug, extension").all();
  return rows.map((r) => ({
    extension: r.extension,
    license: r.license_slug,
    cardCount: r.card_count,
    slug: slugifyExt(r.extension),
    url: `/pages/extension/?license=${r.license_slug}&ext=${encodeURIComponent(slugifyExt(r.extension))}`
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
      h1: `Cartes ${lic.name} — Cardoria`,
      intro: lic.description || `Catalogue ${lic.name} sur Cardoria.`,
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
      `${lic.name} TCG — Estimation & catalogue | Cardoria`,
      `${seo.intro.slice(0, 155)}…`,
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
        h1 = excluded.h1, content_json = excluded.content_json, updated_at = excluded.updated_at
    `).run(
      id, ext.slug, ext.license, ext.extension,
      `${ext.extension} — ${lic?.name || ext.license} | Cardoria`,
      `Prix et fiches cartes ${ext.extension} (${lic?.name || ext.license}). ${ext.cardCount} cartes référencées sur Cardoria.`,
      `Extension ${ext.extension}`,
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
    title: `${lic?.name || slug} TCG | Cardoria`,
    metaDescription: seo.intro || "",
    h1: seo.h1 || `Cartes ${lic?.name || slug}`,
    content: { intro: seo.intro, icon: lic?.icon, cardCount: lic?.cardCount },
    urlPath: `/pages/licences/${slug}/`
  };
}

export { LICENSE_SEO, SITE };
