/**
 * Annonces marketplace v1 — champs étendus + statuts brouillon/en ligne/vendue/suspendue.
 */
import { getDb, normalizeText } from "../../engine/database.js";
import { getListing, createListing, updateListing, deleteListing } from "../listings.js";
import { makeMarketId, syncListingFts } from "../migrate.js";
import { getSeller } from "../sellers.js";
import { makeListingSlug, ensureUniqueSlug, buildListingSeoMeta } from "./slug.js";

const STATUS_MAP = {
  draft: "draft",
  brouillon: "draft",
  active: "active",
  online: "active",
  en_ligne: "active",
  sold: "sold",
  vendue: "sold",
  suspended: "suspended",
  suspendue: "suspended",
  removed: "removed"
};
const ADMIN_MODERATION_STATUSES = new Set(["active", "suspended", "removed"]);

function normalizeStatus(s) {
  if (!s) return "active";
  return STATUS_MAP[String(s).toLowerCase()] || s;
}

function rowToListingV1(row) {
  const base = getListing(row.id);
  if (!base) return null;
  return {
    ...base,
    extension: row.extension || "",
    number: row.card_number || "",
    language: row.language || "",
    slug: row.slug || "",
    moderationLocked: !!row.moderation_locked,
    moderationReason: row.moderation_reason || "",
    moderatedBy: row.moderated_by || "",
    moderatedAt: row.moderated_at || "",
    seo: buildListingSeoMeta(row),
    publicUrl: row.slug ? `annonce.html?slug=${encodeURIComponent(row.slug)}` : `annonce.html?id=${row.id}`,
    statusLabel: statusLabel(row.status)
  };
}

function statusLabel(status) {
  const m = { draft: "Brouillon", active: "En ligne", sold: "Vendue", suspended: "Suspendue", removed: "Supprimée" };
  return m[status] || status;
}

export function createListingV1(data) {
  if (!getSeller(data.sellerId)) throw new Error("Vendeur introuvable");
  const db = getDb();
  const id = makeMarketId("LST");
  const now = new Date().toISOString();
  const status = normalizeStatus(data.status || "active");
  const slug = ensureUniqueSlug(makeListingSlug(data.title, id), id);
  const seoTitle = data.seoTitle || `${data.title} | Cardoria`;
  const seoDesc = data.seoDescription || (data.description || "").slice(0, 160);
  const photos = JSON.stringify((data.photos || []).slice(0, 8));

  db.prepare(`
    INSERT INTO mk_listings (
      id, seller_id, card_id, title, title_normalized, license_slug, extension, card_number, language,
      description, card_condition, price, negotiable, stock, photos, status, slug, seo_title, seo_description,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.sellerId, data.cardId || null, data.title, normalizeText(data.title),
    data.license || "", data.extension || "", data.number || "", data.language || "",
    data.description || "", data.condition || "NM", Number(data.price),
    data.negotiable ? 1 : 0, Math.max(0, Number(data.stock) || 1), photos, status,
    slug, seoTitle, seoDesc, now, now
  );

  const row = db.prepare("SELECT rowid, * FROM mk_listings WHERE id = ?").get(id);
  syncListingFts(row.rowid, row);
  return rowToListingV1(row);
}

export function updateListingV1(id, sellerId, data) {
  const db = getDb();
  assertOwnership(id, sellerId);
  const existing = db.prepare("SELECT * FROM mk_listings WHERE id = ?").get(id);
  const requestedStatus = data.status ? normalizeStatus(data.status) : existing.status;
  if (existing.moderation_locked && requestedStatus !== existing.status) {
    const error = new Error("Cette annonce est verrouillée par la modération Cardoria.");
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const title = data.title ?? existing.title;
  const slug = data.slug || existing.slug || ensureUniqueSlug(makeListingSlug(title, id), id);

  updateListing(id, sellerId, {
    title,
    description: data.description,
    condition: data.condition,
    price: data.price,
    negotiable: data.negotiable,
    stock: data.stock,
    photos: data.photos,
    status: requestedStatus
  });

  db.prepare(`
    UPDATE mk_listings SET extension = ?, card_number = ?, language = ?,
      slug = ?, seo_title = ?, seo_description = ?, updated_at = ? WHERE id = ?
  `).run(
    data.extension ?? existing.extension,
    data.number ?? existing.card_number,
    data.language ?? existing.language,
    slug,
    data.seoTitle ?? existing.seo_title ?? title,
    data.seoDescription ?? existing.seo_description ?? "",
    now, id
  );

  return getListingV1(id);
}

export function moderateListingAdmin(id, { status, reason, actor }) {
  const db = getDb();
  const existing = db.prepare("SELECT rowid, * FROM mk_listings WHERE id = ?").get(id);
  if (!existing) {
    const error = new Error("Annonce introuvable");
    error.status = 404;
    throw error;
  }
  if (existing.status === "sold") {
    const error = new Error("Une annonce vendue ne peut pas être modérée comme une annonce active.");
    error.status = 409;
    throw error;
  }
  const nextStatus = normalizeStatus(status);
  if (!ADMIN_MODERATION_STATUSES.has(nextStatus)) {
    const error = new Error("Statut de modération invalide");
    error.status = 400;
    throw error;
  }
  const cleanReason = String(reason || "").trim().slice(0, 1000);
  if ((nextStatus === "suspended" || nextStatus === "removed") && cleanReason.length < 3) {
    const error = new Error("Un motif de modération est obligatoire pour suspendre ou retirer une annonce.");
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const lock = nextStatus !== "active" ? 1 : 0;
  db.prepare(`
    UPDATE mk_listings SET status=?, moderation_locked=?, moderation_reason=?, moderated_by=?, moderated_at=?, updated_at=?
    WHERE id=?
  `).run(nextStatus, lock, nextStatus === "active" ? "" : cleanReason, String(actor || "admin").slice(0, 200), now, now, id);
  const row = db.prepare("SELECT rowid, * FROM mk_listings WHERE id = ?").get(id);
  syncListingFts(row.rowid, row);
  return rowToListingV1(row);
}

export function getListingV1(id, opts) {
  const row = getDb().prepare("SELECT * FROM mk_listings WHERE id = ?").get(id);
  if (!row) return null;
  if (opts?.trackView) getDb().prepare("UPDATE mk_listings SET views = views + 1 WHERE id = ?").run(id);
  return rowToListingV1(row);
}

export function getListingV1BySlug(slug, opts) {
  const row = getDb().prepare("SELECT * FROM mk_listings WHERE slug = ?").get(slug);
  if (!row) return null;
  return getListingV1(row.id, opts);
}

export function deleteListingV1(id, sellerId) {
  assertOwnership(id, sellerId);
  const existing = getDb().prepare("SELECT moderation_locked FROM mk_listings WHERE id = ?").get(id);
  if (existing?.moderation_locked) {
    const error = new Error("Cette annonce est verrouillée par la modération Cardoria.");
    error.status = 409;
    throw error;
  }
  return deleteListing(id, sellerId);
}

export function listSellerListings(sellerId, { status, page = 1, limit = 50 } = {}) {
  const db = getDb();
  const conds = ["seller_id = ?"];
  const params = [sellerId];
  if (status) { conds.push("status = ?"); params.push(normalizeStatus(status)); }
  const where = "WHERE " + conds.join(" AND ");
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const rows = db.prepare(`SELECT * FROM mk_listings ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);
  return rows.map((r) => rowToListingV1(r));
}

export function listAllListingsAdmin({ status, page = 1, limit = 100 } = {}) {
  const db = getDb();
  const conds = ["1=1"];
  const params = [];
  if (status) { conds.push("status = ?"); params.push(normalizeStatus(status)); }
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const rows = db.prepare(`
    SELECT * FROM mk_listings WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, safeLimit, offset);
  return rows.map((r) => rowToListingV1(r));
}

export function getListingsSitemapEntries(limit = 5000) {
  return getDb().prepare(`
    SELECT id, slug, title, updated_at, photos FROM mk_listings
    WHERE status = 'active' AND stock > 0 AND slug != '' AND COALESCE(moderation_locked,0)=0
    ORDER BY updated_at DESC LIMIT ?
  `).all(limit).map((r) => ({
    id: r.id,
    slug: r.slug,
    url: `/annonce.html?slug=${encodeURIComponent(r.slug)}`,
    lastmod: r.updated_at?.slice(0, 10),
    title: r.title
  }));
}

function assertOwnership(id, sellerId) {
  const row = getDb().prepare("SELECT seller_id FROM mk_listings WHERE id = ?").get(id);
  if (!row || row.seller_id !== sellerId) throw new Error("Accès refusé");
}

export { normalizeStatus, statusLabel };
