/**
 * Profils vendeurs — évaluations, badge vérifié, statistiques.
 */
import { getDb } from "../engine/database.js";
import { makeMarketId } from "./migrate.js";

export function getSeller(id) {
  const row = getDb().prepare("SELECT * FROM mk_sellers WHERE id = ?").get(id);
  return row ? toSeller(row) : null;
}

export function getSellerByEmail(email) {
  const row = getDb().prepare("SELECT * FROM mk_sellers WHERE email = ?").get(email);
  return row ? toSeller(row) : null;
}

export function registerSeller({ email, displayName, sellerType, bio }) {
  const db = getDb();
  const existing = getSellerByEmail(email);
  if (existing) return existing;
  const id = makeMarketId("SLR");
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO mk_sellers (id, email, display_name, seller_type, bio, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, email, displayName || email.split("@")[0], sellerType || "individual", bio || "", now);
  return getSeller(id);
}

export function updateSellerStats(sellerId) {
  const db = getDb();
  const sales = db.prepare("SELECT COUNT(*) AS c FROM mk_orders WHERE seller_id = ? AND status IN ('paid','preparing','shipped','delivered')").get(sellerId)?.c ?? 0;
  const reviews = db.prepare("SELECT AVG(rating) AS avg, COUNT(*) AS c FROM mk_reviews WHERE seller_id = ?").get(sellerId);
  const avg = reviews?.avg ? Math.round(reviews.avg * 10) / 10 : 0;
  const count = reviews?.c ?? 0;
  const satisfaction = count ? Math.round((reviews.avg / 5) * 100) : 100;
  db.prepare(`
    UPDATE mk_sellers SET sales_count = ?, rating_avg = ?, rating_count = ?, satisfaction_rate = ?
    WHERE id = ?
  `).run(sales, avg, count, satisfaction, sellerId);
  return getSeller(sellerId);
}

export function addReview({ sellerId, orderId, buyerEmail, rating, comment }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO mk_reviews (seller_id, order_id, buyer_email, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sellerId, orderId, buyerEmail, Math.min(5, Math.max(1, rating)), comment || "", now);
  return updateSellerStats(sellerId);
}

export function getSellerReviews(sellerId, limit = 20) {
  return getDb().prepare(`
    SELECT rating, comment, created_at AS createdAt, buyer_email AS buyerEmail
    FROM mk_reviews WHERE seller_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(sellerId, limit);
}

export function setSellerVerified(sellerId, verified) {
  getDb().prepare("UPDATE mk_sellers SET verified = ? WHERE id = ?").run(verified ? 1 : 0, sellerId);
  return getSeller(sellerId);
}

function toSeller(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    sellerType: row.seller_type,
    verified: !!row.verified,
    avatar: row.avatar,
    bio: row.bio,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    salesCount: row.sales_count,
    satisfactionRate: row.satisfaction_rate,
    createdAt: row.created_at
  };
}

export function listSellers(limit = 50) {
  return getDb().prepare("SELECT * FROM mk_sellers ORDER BY sales_count DESC LIMIT ?").all(limit).map(toSeller);
}
