/** Panier marketplace — validation prix serveur et commandes par vendeur. */
import { getDb } from "../../engine/database.js";
import { getListing } from "../listings.js";
import { createOrder, updateOrderStatus, expireStalePendingOrders } from "../orders.js";
import { validateServerSidePrice } from "./security.js";

export function getCart(userId) {
  expireStalePendingOrders();
  const db = getDb();
  const rows = db.prepare(`SELECT c.*,l.title,l.price AS current_price,l.stock,l.status,l.seller_id,l.photos FROM mk_cart_items c JOIN mk_listings l ON l.id=c.listing_id WHERE c.user_id=?`).all(userId);
  const items = [];
  let subtotal = 0;
  rows.forEach((r) => {
    const price = Number(r.current_price || 0);
    if (r.status !== "active" || Number(r.stock || 0) < Number(r.qty || 0)) return;
    const line = Math.round(price * r.qty * 100) / 100;
    subtotal += line;
    let photos = [];
    try { photos = JSON.parse(r.photos || "[]"); } catch { photos = []; }
    items.push({ listingId: r.listing_id, title: r.title, qty: r.qty, unitPrice: price, lineTotal: line, sellerId: r.seller_id, photos });
  });
  return { userId, items, subtotal: Math.round(subtotal * 100) / 100, itemCount: items.reduce((s, i) => s + i.qty, 0) };
}
export function addToCart(userId, listingId, qty = 1) {
  const listing = getListing(listingId);
  if (!listing) throw Object.assign(new Error("Annonce introuvable"), { status: 404 });
  const validated = validateServerSidePrice(listingId, listing.price, qty);
  const db = getDb(); const now = new Date().toISOString();
  const existing = db.prepare("SELECT qty FROM mk_cart_items WHERE user_id=? AND listing_id=?").get(userId, listingId);
  const requested = Math.max(1, Number(qty) || 1);
  const newQty = Math.min(validated.listing.stock, (Number(existing?.qty) || 0) + requested);
  db.prepare(`INSERT INTO mk_cart_items (user_id,listing_id,qty,unit_price,added_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,listing_id) DO UPDATE SET qty=excluded.qty,unit_price=excluded.unit_price,added_at=excluded.added_at`).run(userId, listingId, newQty, validated.unitPrice, now);
  return getCart(userId);
}
export function updateCartQty(userId, listingId, qty) {
  const db = getDb(); const safeQty = Number(qty) || 0;
  if (safeQty <= 0) { db.prepare("DELETE FROM mk_cart_items WHERE user_id=? AND listing_id=?").run(userId, listingId); return getCart(userId); }
  const listing = getListing(listingId);
  if (!listing) throw Object.assign(new Error("Annonce introuvable"), { status: 404 });
  const validated = validateServerSidePrice(listingId, listing.price, safeQty);
  db.prepare("UPDATE mk_cart_items SET qty=?,unit_price=? WHERE user_id=? AND listing_id=?").run(validated.qty, validated.unitPrice, userId, listingId);
  return getCart(userId);
}
export function removeFromCart(userId, listingId) { getDb().prepare("DELETE FROM mk_cart_items WHERE user_id=? AND listing_id=?").run(userId, listingId); return getCart(userId); }
export function clearCart(userId) { getDb().prepare("DELETE FROM mk_cart_items WHERE user_id=?").run(userId); return { userId, items: [], subtotal: 0, itemCount: 0 }; }
export function consumePaidCartItems(userId, items = []) {
  if (!userId || !Array.isArray(items) || !items.length) return getCart(userId || "");
  const db = getDb();
  const consume = db.transaction((lines) => {
    for (const line of lines) {
      const listingId = String(line?.listingId || "").trim(); const paidQty = Math.max(0, Number(line?.qty) || 0);
      if (!listingId || paidQty <= 0) continue;
      const existing = db.prepare("SELECT qty FROM mk_cart_items WHERE user_id=? AND listing_id=?").get(userId, listingId);
      if (!existing) continue;
      if (Number(existing.qty) <= paidQty) db.prepare("DELETE FROM mk_cart_items WHERE user_id=? AND listing_id=?").run(userId, listingId);
      else db.prepare("UPDATE mk_cart_items SET qty=qty-? WHERE user_id=? AND listing_id=?").run(paidQty, userId, listingId);
    }
  });
  consume(items); return getCart(userId);
}
export function createOrdersFromCart(userId, { buyerEmail, buyerName, buyerId, shippingCarrier, shippingCost, shippingAddress, clearAfterCreate = true }) {
  const cart = getCart(userId);
  if (!cart.items.length) throw Object.assign(new Error("Panier vide"), { status: 400 });
  const bySeller = {};
  cart.items.forEach((item) => { if (!bySeller[item.sellerId]) bySeller[item.sellerId] = []; bySeller[item.sellerId].push(item); });
  const sellerIds = Object.keys(bySeller);
  const totalShipping = Math.max(0, Number(shippingCost) || 0);
  const baseShip = sellerIds.length ? Math.floor((totalShipping * 100) / sellerIds.length) / 100 : 0;
  let remainingCents = Math.round(totalShipping * 100) - Math.round(baseShip * 100) * sellerIds.length;
  const orders = []; const createdIds = [];
  try {
    sellerIds.forEach((sellerId) => {
      const lines = bySeller[sellerId];
      lines.forEach((line) => validateServerSidePrice(line.listingId, line.unitPrice, line.qty));
      const shippingForOrder = Math.round((baseShip + (remainingCents > 0 ? 0.01 : 0)) * 100) / 100;
      if (remainingCents > 0) remainingCents -= 1;
      const order = createOrder({ listingId: lines[0].listingId, items: lines.map((line) => ({ listingId: line.listingId, qty: line.qty })), buyerEmail, buyerName, buyerId: buyerId || userId, shippingCarrier, shippingCost: shippingForOrder, shippingAddress });
      createdIds.push(order.id); orders.push(order);
    });
  } catch (error) {
    createdIds.forEach((id) => { try { updateOrderStatus(id, "cancelled", { paymentStatus: "failed", paymentMethod: "paypal" }); } catch {} });
    throw error;
  }
  if (clearAfterCreate) clearCart(userId);
  return orders;
}
