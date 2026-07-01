/**
 * Commandes marketplace — statuts, facture, paiement SumUp.
 */
import { getDb } from "../engine/database.js";
import { makeMarketId } from "./migrate.js";
import { getListing, decrementStock } from "./listings.js";
import { updateSellerStats } from "./sellers.js";
import { generateInvoiceHtml } from "./invoice.js";
import { ingestMarketplaceOrder } from "../market/ingest.js";

let _notifyHook = null;
export function setOrderNotificationHook(fn) {
  _notifyHook = fn;
}

const STATUS_FLOW = ["pending", "paid", "preparing", "shipped", "delivered", "cancelled", "refunded"];
const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

export function createOrder({ listingId, buyerEmail, buyerName, buyerId, qty, shippingCarrier, shippingCost, shippingAddress }) {
  const listing = getListing(listingId);
  if (!listing || listing.status !== "active" || listing.stock < qty) {
    throw new Error("Annonce indisponible ou stock insuffisant");
  }
  const id = makeMarketId("MKT");
  const now = new Date().toISOString();
  const unitPrice = listing.price;
  const ship = Number(shippingCost) || 0;
  const total = Math.round((unitPrice * qty + ship) * 100) / 100;

  getDb().prepare(`
    INSERT INTO mk_orders (
      id, buyer_email, buyer_name, buyer_id, seller_id, listing_id, listing_title,
      qty, unit_price, shipping_cost, shipping_carrier, total, status,
      payment_status, shipping_address, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?)
  `).run(
    id, buyerEmail, buyerName || "", buyerId || "", listing.sellerId, listingId, listing.title,
    qty, unitPrice, ship, shippingCarrier || "", total, shippingAddress || "", now, now
  );
  const order = getOrder(id);
  if (_notifyHook) _notifyHook(order, "pending", null).catch?.(() => {});
  return order;
}

export function getOrder(id) {
  const row = getDb().prepare("SELECT * FROM mk_orders WHERE id = ?").get(id);
  return row ? toOrder(row) : null;
}

export function updateOrderSumUpRefs(id, checkoutId, paymentStatus) {
  const db = getDb();
  const now = new Date().toISOString();
  if (checkoutId) {
    db.prepare(`
      UPDATE mk_orders SET sumup_checkout_id = ?, payment_status = COALESCE(?, payment_status), updated_at = ? WHERE id = ?
    `).run(checkoutId, paymentStatus ?? null, now, id);
  } else if (paymentStatus) {
    db.prepare("UPDATE mk_orders SET payment_status = ?, updated_at = ? WHERE id = ?").run(paymentStatus, now, id);
  }
  return getOrder(id);
}

export function updateOrderStatus(id, status, extra = {}) {
  if (!STATUS_FLOW.includes(status)) throw new Error("Statut invalide");
  const prev = getOrder(id);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE mk_orders SET status = ?, shipping_tracking = COALESCE(?, shipping_tracking),
      shipping_label_url = COALESCE(?, shipping_label_url),
      sumup_checkout_id = COALESCE(?, sumup_checkout_id),
      sumup_transaction_id = COALESCE(?, sumup_transaction_id),
      stripe_session_id = COALESCE(?, stripe_session_id),
      stripe_payment_intent = COALESCE(?, stripe_payment_intent),
      payment_status = COALESCE(?, payment_status),
      payment_method = COALESCE(?, payment_method),
      updated_at = ?
    WHERE id = ?
  `).run(
    status,
    extra.tracking ?? null,
    extra.labelUrl ?? null,
    extra.sumupCheckoutId ?? extra.stripeSessionId ?? null,
    extra.sumupTransactionId ?? extra.paymentIntent ?? null,
    extra.stripeSessionId ?? null,
    extra.paymentIntent ?? null,
    extra.paymentStatus ?? null,
    extra.paymentMethod ?? null,
    now,
    id
  );

  if (status === "paid") {
    const order = getOrder(id);
    if (order) {
      decrementStock(order.listingId, order.qty);
      updateSellerStats(order.sellerId);
      try { ingestMarketplaceOrder(order); } catch (e) { console.warn("[Market] ingest order:", e.message); }
    }
  }
  const updated = getOrder(id);
  if (_notifyHook && updated) _notifyHook(updated, status, prev?.status).catch?.(() => {});
  return updated;
}

export function markOrderPaymentStatus(id, paymentStatus, extra = {}) {
  if (!PAYMENT_STATUSES.includes(paymentStatus)) throw new Error("Statut paiement invalide");
  const patch = { ...extra, paymentStatus };
  if (paymentStatus === "paid") return updateOrderStatus(id, "paid", patch);
  if (paymentStatus === "refunded") return updateOrderStatus(id, "refunded", patch);
  return updateOrderStatus(id, getOrder(id)?.status || "pending", patch);
}

export function markOrderPaid(id, { sumupCheckoutId, sumupTransactionId, stripeSessionId, paymentIntent, paymentMethod } = {}) {
  return updateOrderStatus(id, "paid", {
    sumupCheckoutId: sumupCheckoutId || stripeSessionId,
    sumupTransactionId: sumupTransactionId || paymentIntent,
    stripeSessionId,
    paymentIntent,
    paymentMethod: paymentMethod || "sumup_card",
    paymentStatus: "paid"
  });
}

export function getOrdersByBuyer(email, buyerId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM mk_orders WHERE buyer_email = ? OR buyer_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).all(email, buyerId || "");
  return rows.map(toOrder);
}

export function getOrdersBySeller(sellerId) {
  return getDb().prepare("SELECT * FROM mk_orders WHERE seller_id = ? ORDER BY created_at DESC LIMIT 100").all(sellerId).map(toOrder);
}

export function getAllOrders(limit = 200) {
  return getDb().prepare("SELECT * FROM mk_orders ORDER BY created_at DESC LIMIT ?").all(limit).map(toOrder);
}

export function getInvoiceHtml(orderId) {
  const order = getOrder(orderId);
  if (!order) return null;
  return generateInvoiceHtml(order);
}

function toOrder(row) {
  const paymentRef = row.sumup_checkout_id || row.stripe_session_id || "";
  return {
    id: row.id,
    buyerEmail: row.buyer_email,
    buyerName: row.buyer_name,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    qty: row.qty,
    unitPrice: row.unit_price,
    shippingCost: row.shipping_cost,
    shippingCarrier: row.shipping_carrier,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status || (row.status === "paid" ? "paid" : "pending"),
    paymentMethod: row.payment_method,
    sumupCheckoutId: row.sumup_checkout_id || "",
    sumupTransactionId: row.sumup_transaction_id || "",
    paymentReference: paymentRef,
    stripeSessionId: row.stripe_session_id,
    shippingTracking: row.shipping_tracking,
    shippingLabelUrl: row.shipping_label_url,
    shippingAddress: row.shipping_address,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export { STATUS_FLOW, PAYMENT_STATUSES };
