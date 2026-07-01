/**
 * Favoris, liste de souhaits et alertes baisse de prix.
 */
import { getDb } from "../engine/database.js";
import { getListing } from "./listings.js";
import { sendEmail } from "../email.js";

export function addFavorite(userId, listingId) {
  if (!getListing(listingId)) throw new Error("Annonce introuvable");
  getDb().prepare("INSERT OR IGNORE INTO mk_favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)")
    .run(userId, listingId, new Date().toISOString());
  return getFavorites(userId);
}

export function removeFavorite(userId, listingId) {
  getDb().prepare("DELETE FROM mk_favorites WHERE user_id = ? AND listing_id = ?").run(userId, listingId);
  return getFavorites(userId);
}

export function getFavorites(userId) {
  const rows = getDb().prepare(`
    SELECT l.* FROM mk_favorites f
    INNER JOIN mk_listings l ON l.id = f.listing_id
    WHERE f.user_id = ? AND l.status = 'active'
    ORDER BY f.created_at DESC
  `).all(userId);
  return rows.map((r) => ({
    listingId: r.id,
    title: r.title,
    price: r.price,
    photos: JSON.parse(r.photos || "[]"),
    condition: r.card_condition
  }));
}

export function addWishlistItem(userId, { cardId, listingId, note, targetPrice }) {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO mk_wishlist (user_id, card_id, listing_id, note, target_price, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, cardId || null, listingId || null, note || "", targetPrice ?? null, new Date().toISOString());
  return { id: r.lastInsertRowid };
}

export function getWishlist(userId) {
  return getDb().prepare("SELECT * FROM mk_wishlist WHERE user_id = ? ORDER BY created_at DESC").all(userId).map((r) => ({
    id: r.id,
    cardId: r.card_id,
    listingId: r.listing_id,
    note: r.note,
    targetPrice: r.target_price,
    createdAt: r.created_at
  }));
}

export function removeWishlistItem(userId, itemId) {
  getDb().prepare("DELETE FROM mk_wishlist WHERE user_id = ? AND id = ?").run(userId, itemId);
}

export function createPriceAlert({ userId, userEmail, cardId, listingId, targetPrice }) {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO mk_price_alerts (user_id, user_email, card_id, listing_id, target_price, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, userEmail, cardId || null, listingId || null, Number(targetPrice), new Date().toISOString());
  return { id: r.lastInsertRowid };
}

export function getPriceAlerts(userId) {
  return getDb().prepare("SELECT * FROM mk_price_alerts WHERE user_id = ? AND active = 1").all(userId).map((r) => ({
    id: r.id,
    cardId: r.card_id,
    listingId: r.listing_id,
    targetPrice: r.target_price,
    createdAt: r.created_at
  }));
}

export function deletePriceAlert(userId, alertId) {
  getDb().prepare("UPDATE mk_price_alerts SET active = 0 WHERE user_id = ? AND id = ?").run(userId, alertId);
}

/** Vérifie les alertes après mise à jour de prix (job cron ou appel admin) */
export async function processPriceAlerts() {
  const db = getDb();
  const alerts = db.prepare("SELECT * FROM mk_price_alerts WHERE active = 1").all();
  let notified = 0;

  for (const alert of alerts) {
    let currentPrice = null;
    let title = "";
    if (alert.listing_id) {
      const listing = getListing(alert.listing_id);
      if (listing) { currentPrice = listing.price; title = listing.title; }
    }
    if (currentPrice != null && currentPrice <= alert.target_price) {
      await sendEmail({
        to: alert.user_email,
        subject: `[Cardoria] Alerte prix — ${title || "Carte souhaitée"}`,
        text: `Bonne nouvelle ! Le prix est descendu à ${currentPrice.toFixed(2)} € (seuil : ${alert.target_price} €).\n\nConsultez la marketplace Cardoria.`
      }).catch(() => {});
      db.prepare("UPDATE mk_price_alerts SET last_notified_at = ? WHERE id = ?").run(new Date().toISOString(), alert.id);
      notified++;
    }
  }
  return { checked: alerts.length, notified };
}
