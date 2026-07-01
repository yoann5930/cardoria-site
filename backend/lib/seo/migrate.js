/**
 * Schéma SEO Cardoria — blog administrable et pages générées.
 */
import { getDb } from "../engine/database.js";

export function migrateSeo() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS seo_blog_posts (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      meta_title TEXT DEFAULT '',
      meta_description TEXT DEFAULT '',
      excerpt TEXT DEFAULT '',
      content_html TEXT NOT NULL,
      cover_image TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      published INTEGER DEFAULT 1,
      author TEXT DEFAULT 'Cardoria',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seo_generated_pages (
      id TEXT PRIMARY KEY,
      page_type TEXT NOT NULL,
      slug TEXT NOT NULL,
      license_slug TEXT DEFAULT '',
      extension_name TEXT DEFAULT '',
      title TEXT NOT NULL,
      meta_description TEXT DEFAULT '',
      h1 TEXT DEFAULT '',
      content_json TEXT DEFAULT '{}',
      url_path TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(page_type, slug, license_slug)
    );

    CREATE INDEX IF NOT EXISTS idx_seo_blog_pub ON seo_blog_posts(published, updated_at);
    CREATE INDEX IF NOT EXISTS idx_seo_pages_type ON seo_generated_pages(page_type, license_slug);
  `);
}
