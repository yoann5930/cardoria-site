/**
 * Registre des licences TCG — extensible sans migration de schéma.
 */
import { getDb } from "./database.js";

const DEFAULT_LICENSES = [
  { slug: "pokemon", name: "Pokémon", icon: "⚡", sort_order: 1, description: "Cartes Pokémon TCG" },
  { slug: "yugioh", name: "Yu-Gi-Oh!", icon: "🔷", sort_order: 2, description: "Duels des monstres" },
  { slug: "onepiece", name: "One Piece", icon: "🏴‍☠️", sort_order: 3, description: "One Piece Card Game" },
  { slug: "lorcana", name: "Lorcana", icon: "✨", sort_order: 4, description: "Disney Lorcana" },
  { slug: "magic", name: "Magic", icon: "🔮", sort_order: 5, description: "Magic: The Gathering" },
  { slug: "dragonball", name: "Dragon Ball Super", icon: "🐉", sort_order: 6, description: "Dragon Ball Super Card Game" },
  { slug: "starwars", name: "Star Wars Unlimited", icon: "⭐", sort_order: 7, description: "Star Wars Unlimited TCG" },
  { slug: "sports", name: "Sports", icon: "⚽", sort_order: 8, description: "Cartes sportives" }
];

export function ensureDefaultLicenses() {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO licenses (slug, name, icon, description, sort_order, created_at)
    VALUES (@slug, @name, @icon, @description, @sort_order, @created_at)
  `);
  DEFAULT_LICENSES.forEach((lic) => insert.run({ ...lic, created_at: now }));
}

export function listLicenses({ activeOnly = true } = {}) {
  const db = getDb();
  const sql = activeOnly
    ? "SELECT * FROM licenses WHERE active = 1 ORDER BY sort_order, name"
    : "SELECT * FROM licenses ORDER BY sort_order, name";
  return db.prepare(sql).all().map(toLicense);
}

export function getLicense(slug) {
  const row = getDb().prepare("SELECT * FROM licenses WHERE slug = ?").get(slug);
  return row ? toLicense(row) : null;
}

export function createLicense(data) {
  const db = getDb();
  const slug = data.slug || data.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!slug) throw new Error("Slug licence requis");
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO licenses (slug, name, icon, description, sort_order, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(slug, data.name, data.icon || "🃏", data.description || "", data.sortOrder ?? 99, now);
  return getLicense(slug);
}

export function updateLicense(slug, data) {
  const db = getDb();
  const existing = getLicense(slug);
  if (!existing) return null;
  db.prepare(`
    UPDATE licenses SET name = ?, icon = ?, description = ?, sort_order = ?, active = ?
    WHERE slug = ?
  `).run(
    data.name ?? existing.name,
    data.icon ?? existing.icon,
    data.description ?? existing.description,
    data.sortOrder ?? existing.sortOrder,
    data.active != null ? (data.active ? 1 : 0) : (existing.active ? 1 : 0),
    slug
  );
  return getLicense(slug);
}

export function deleteLicense(slug) {
  const db = getDb();
  const cards = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug = ?").get(slug)?.c ?? 0;
  if (cards > 0) throw new Error("Impossible de supprimer une licence contenant des cartes");
  db.prepare("DELETE FROM licenses WHERE slug = ?").run(slug);
  return true;
}

function toLicense(row) {
  return {
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    description: row.description,
    active: !!row.active,
    sortOrder: row.sort_order,
    cardCount: getDb().prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug = ? AND active = 1").get(row.slug)?.c ?? 0,
    createdAt: row.created_at
  };
}
