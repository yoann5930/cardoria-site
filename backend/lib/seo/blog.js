/**
 * Blog SEO administrable Cardoria.
 */
import { getDb } from "../engine/database.js";

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function listBlogPosts({ publishedOnly = true, limit = 50 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM seo_blog_posts";
  if (publishedOnly) sql += " WHERE published = 1";
  sql += " ORDER BY updated_at DESC LIMIT ?";
  return db.prepare(sql).all(limit).map(mapPost);
}

export function getBlogPost(idOrSlug) {
  const row = getDb().prepare(
    "SELECT * FROM seo_blog_posts WHERE id = ? OR slug = ?"
  ).get(idOrSlug, idOrSlug);
  return row ? mapPost(row) : null;
}

export function saveBlogPost(data) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = data.id || "BLOG-" + Date.now();
  const slug = data.slug || slugify(data.title);
  db.prepare(`
    INSERT INTO seo_blog_posts (
      id, slug, title, meta_title, meta_description, excerpt, content_html,
      cover_image, tags, published, author, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug, title = excluded.title, meta_title = excluded.meta_title,
      meta_description = excluded.meta_description, excerpt = excluded.excerpt,
      content_html = excluded.content_html, cover_image = excluded.cover_image,
      tags = excluded.tags, published = excluded.published, author = excluded.author,
      updated_at = excluded.updated_at
  `).run(
    id, slug, data.title, data.metaTitle || data.title, data.metaDescription || "",
    data.excerpt || "", data.contentHtml || "", data.coverImage || "",
    JSON.stringify(data.tags || []), data.published !== false ? 1 : 0,
    data.author || "Cardoria", data.createdAt || now, now
  );
  return getBlogPost(id);
}

export function deleteBlogPost(id) {
  getDb().prepare("DELETE FROM seo_blog_posts WHERE id = ?").run(id);
  return true;
}

function mapPost(row) {
  let tags = [];
  try { tags = JSON.parse(row.tags || "[]"); } catch { /* ignore */ }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    excerpt: row.excerpt,
    contentHtml: row.content_html,
    coverImage: row.cover_image,
    tags,
    published: !!row.published,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: "/pages/blog/article.html?slug=" + row.slug
  };
}

export function seedBlogIfEmpty() {
  if (getDb().prepare("SELECT COUNT(*) AS c FROM seo_blog_posts").get()?.c > 0) return;
  saveBlogPost({
    title: "Comment estimer une carte Pokémon en 2026",
    metaDescription: "Guide complet pour estimer vos cartes Pokémon : état, rareté, édition et tendances du marché TCG en France.",
    excerpt: "Découvrez la méthode Cardoria pour obtenir une estimation fiable de vos cartes Pokémon.",
    contentHtml: "<h2>Pourquoi faire estimer sa carte ?</h2><p>Le marché Pokémon évolue rapidement. Une estimation professionnelle tient compte de l'état, de la rareté et des ventes récentes.</p><h2>Les critères clés</h2><ul><li>État (Mint à Poor)</li><li>Extension et numéro</li><li>Langue et version</li><li>Tendance du marché</li></ul><p><a href='/pages/estimation/'>Demander une estimation Cardoria</a></p>",
    tags: ["pokemon", "estimation", "guide"]
  });
  saveBlogPost({
    title: "Yu-Gi-Oh! : cartes qui montent en 2026",
    metaDescription: "Analyse des tendances Yu-Gi-Oh! : cartes recherchées, prix et conseils pour vendre ou acheter sur Cardoria.",
    excerpt: "Tour d'horizon du marché Yu-Gi-Oh! et des cartes en forte demande.",
    contentHtml: "<h2>Marché Yu-Gi-Oh! en France</h2><p>Les cartes iconiques et les éditions limitées restent très recherchées par les collectionneurs.</p><h2>Conseils Cardoria</h2><p>Photographiez vos cartes sous bonne lumière et comparez les prix sur notre marketplace.</p>",
    tags: ["yugioh", "tendances"]
  });
}
