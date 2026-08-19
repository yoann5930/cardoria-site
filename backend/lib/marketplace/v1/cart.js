/**
 * Panier marketplace — validation prix serveur et création de commandes par vendeur.
 */
import { getDb } from "../../engine/database.js";
import { getListing } from "../listings.js";
import { createOrder, getOrder } from "../orders.js";
import { validateServerSidePrice } from "./security.js";

export function getCart(userId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.*, l.title, l.price AS current_price, l.stock, l.status, l.seller_id, l.photos
    FROM mk_cart_items c
    JOIN mk_listings l ON l.id = c.listing_id
    WHERE c.user_id = ?
  `).all(userId);

  const items = [];
  let subtotal = 0;

  rows.forEach((r) => {
    const price = r.current_price;
    if (r.status !== "active" || r.stock < r.qty) return;
    const line = Math.round(price * r.qty * 100) / 100;
    subtotal += line;
    items.push({
      listingId: r.listing_id,
      title: r.title,
      qty: r.qty,
      unitPrice: price,
      lineTotal: line,
      sellerId: r.seller_id,
      photos: JSON.parse(r.photos || "[]")
    });
  });

  return {
    userId,
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    itemCount: items.reduce((s, i) => s + i.qty, 0)
  };
}

export function addToCart(userId, listingId, qty = 1) {
  validateServerSidePrice(listingId, getListing(listingId).price, qty);
  const listing = getListing(listingId);
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT qty FROM mk_cart_items WHERE user_id = ? AND listing_id = ?").get(userId, listingId);
  const newQty = Math.min(listing.stock, (existing?.qty || 0) + qty);

  db.prepare(`
    INSERT INTO mk_cart_items (user_id, listing_id, qty, unit_price, added_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, listing_id) DO UPDATE SET qty = excluded.qty, unit_price = excluded.unit_price, added_at = excluded.added_at
  `).run(userId, listingId, newQty, listing.price, now);

  return getCart(userId);
}

export function updateCartQty(userId, listingId, qty) {
  const db = getDb();
  if (qty <= 0) {
    db.prepare("DELETE FROM mk_cart_items WHERE user_id = ? AND listing_id = ?").run(userId, listingId);
    return getCart(userId);
  }
  validateServerSidePrice(listingId, getListing(listingId).price, qty);
  db.prepare("UPDATE mk_cart_items SET qty = ?, unit_price = ? WHERE user_id = ? AND listing_id = ?")
    .run(qty, getListing(listingId).price, userId, listingId);
  return getCart(userId);
}

export function removeFromCart(userId, listingId) {
  getDb().prepare("DELETE FROM mk_cart_items WHERE user_id = ? AND listing_id = ?").run(userId, listingId);
  return getCart(userId);
}

export function clearCart(userId) {
  getDb().prepare("DELETE FROM mk_cart_items WHERE user_id = ?").run(userId);
  return { userId, items: [], subtotal: 0, itemCount: 0 };
}

/** Crée une commande par vendeur (checkout panier). Le panier peut être conservé jusqu'à création du paiement. */
export function createOrdersFromCart(userId, { buyerEmail, buyerName, buyerId, shippingCarrier, shippingCost, shippingAddress, clearAfterCreate = true }) {
  const cart = getCart(userId);
  if (!cart.items.length) throw new Error("Panier vide");

  const bySeller = {};
  cart.items.forEach((item) => {
    if (!bySeller[item.sellerId]) bySeller[item.sellerId] = [];
    bySeller[item.sellerId].push(item);
  });

  const sellerIds = Object.keys(bySeller);
  const shipPerOrder = sellerIds.length ? Math.round((Number(shippingCost) || 0) / sellerIds.length * 100) / 100 : 0;
  const orders = [];

  sellerIds.forEach((sellerId) => {
    const lines = bySeller[sellerId];
    const primary = lines[0];
    lines.forEach((line) => validateServerSidePrice(line.listingId, line.unitPrice, line.qty));

    const order = createOrder({
      listingId: primary.listingId,
      buyerEmail,
      buyerName,
      buyerId: buyerId || userId,
      qty: primary.qty,
      shippingCarrier,
      shippingCost: shipPerOrder,
      shippingAddress
    });

    const itemsJson = JSON.stringify(lines.map((l) => ({
      listingId: l.listingId, title: l.title, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal
    })));

    const productsTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const newTotal = Math.round((productsTotal + shipPerOrder) * 100) / 100;
    getDb().prepare("UPDATE mk_orders SET items_json = ?, total = ? WHERE id = ?")
      .run(itemsJson, newTotal, order.id);

    orders.push(getOrder(order.id));
  });

  if (clearAfterCreate) clearCart(userId);
  return orders;
}
