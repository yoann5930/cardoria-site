/** Commandes marketplace — stock reserve atomiquement, statuts et paiement. */
import { getDb } from "../engine/database.js";
import { makeMarketId } from "./migrate.js";
import { getListing } from "./listings.js";
import { updateSellerStats } from "./sellers.js";
import { generateInvoiceHtml } from "./invoice.js";
import { ingestMarketplaceOrder } from "../market/ingest.js";

let _notifyHook = null;
export function setOrderNotificationHook(fn) { _notifyHook = fn; }
const STATUS_FLOW = ["pending", "paid", "preparing", "shipped", "delivered", "cancelled", "refunded"];
const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];
const STATUS_TRANSITIONS = {
  pending: new Set(["paid", "cancelled"]),
  paid: new Set(["preparing", "refunded"]),
  preparing: new Set(["shipped", "refunded"]),
  shipped: new Set(["delivered", "refunded"]),
  delivered: new Set(["refunded"]),
  cancelled: new Set(),
  refunded: new Set()
};

export function canTransitionOrderStatus(from, to) {
  const current = String(from || "pending");
  const next = String(to || "");
  if (current === next) return true;
  return STATUS_TRANSITIONS[current]?.has(next) === true;
}

export function createOrder({ listingId, items = null, buyerEmail, buyerName, buyerId, qty, shippingCarrier, shippingCost, shippingAddress }) {
  const db = getDb();
  const id = makeMarketId("MKT");
  const now = new Date().toISOString();
  const rawLines = Array.isArray(items) && items.length ? items : [{ listingId, qty }];
  const transaction = db.transaction(() => {
    const prepared = [];
    let sellerId = "";
    for (const raw of rawLines) {
      const lineId = String(raw.listingId || "").trim();
      const safeQty = Math.max(1, Math.min(20, Number(raw.qty) || 1));
      const listing = getListing(lineId);
      if (!listing || listing.status !== "active") throw Object.assign(new Error(`Annonce indisponible: ${lineId}`), { status: 409 });
      if (sellerId && listing.sellerId !== sellerId) throw Object.assign(new Error("Une commande ne peut contenir qu'un seul vendeur."), { status: 400 });
      sellerId = listing.sellerId;
      const reserved = db.prepare("UPDATE mk_listings SET stock=stock-?,updated_at=? WHERE id=? AND status='active' AND stock>=?").run(safeQty, now, lineId, safeQty);
      if (reserved.changes !== 1) throw Object.assign(new Error(`Stock insuffisant pour ${listing.title}`), { status: 409 });
      const unitPrice = Math.round(Number(listing.price || 0) * 100) / 100;
      prepared.push({ listingId: lineId, title: listing.title, qty: safeQty, unitPrice, lineTotal: Math.round(unitPrice * safeQty * 100) / 100 });
    }
    const primary = prepared[0];
    const ship = Math.max(0, Number(shippingCost) || 0);
    const productsTotal = prepared.reduce((sum, line) => sum + line.lineTotal, 0);
    const total = Math.round((productsTotal + ship) * 100) / 100;
    db.prepare(`INSERT INTO mk_orders (id,buyer_email,buyer_name,buyer_id,seller_id,listing_id,listing_title,items_json,qty,unit_price,shipping_cost,shipping_carrier,total,status,payment_status,shipping_address,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','pending',?,?,?)`).run(id, String(buyerEmail || "").toLowerCase(), buyerName || "", String(buyerId || ""), sellerId, primary.listingId, primary.title, JSON.stringify(prepared), primary.qty, primary.unitPrice, ship, shippingCarrier || "", total, shippingAddress || "", now, now);
  });
  transaction();
  const order = getOrder(id);
  if (_notifyHook) _notifyHook(order, "pending", null).catch?.(() => {});
  return order;
}

export function getOrder(id) { const row = getDb().prepare("SELECT * FROM mk_orders WHERE id=?").get(id); return row ? toOrder(row) : null; }
export function updateOrderSumUpRefs(id, checkoutId, paymentStatus) {
  const db = getDb(); const now = new Date().toISOString();
  if (checkoutId) db.prepare("UPDATE mk_orders SET sumup_checkout_id=?,payment_status=COALESCE(?,payment_status),updated_at=? WHERE id=?").run(checkoutId, paymentStatus ?? null, now, id);
  else if (paymentStatus) db.prepare("UPDATE mk_orders SET payment_status=?,updated_at=? WHERE id=?").run(paymentStatus, now, id);
  return getOrder(id);
}
function orderLines(order) { return Array.isArray(order.items) && order.items.length ? order.items : [{ listingId: order.listingId, qty: order.qty }]; }
function releaseReservedStock(order) {
  const db = getDb(); const now = new Date().toISOString();
  for (const line of orderLines(order)) db.prepare("UPDATE mk_listings SET stock=stock+?,updated_at=? WHERE id=?").run(Math.max(1, Number(line.qty) || 1), now, line.listingId);
}
function applyPaidSideEffectsOnce(order, previousStatus) {
  if (["paid", "preparing", "shipped", "delivered"].includes(previousStatus)) return;
  updateSellerStats(order.sellerId);
  try { ingestMarketplaceOrder(order); } catch (e) { console.warn("[Market] ingest order:", e.message); }
}
function coherentPaymentStatus(status, previousPaymentStatus, requestedPaymentStatus) {
  if (status === "paid") return "paid";
  if (status === "refunded") return "refunded";
  return requestedPaymentStatus ?? previousPaymentStatus ?? "pending";
}

export function updateOrderStatus(id, status, extra = {}) {
  if (!STATUS_FLOW.includes(status)) throw new Error("Statut invalide");
  const prev = getOrder(id); if (!prev) throw new Error("Commande introuvable");
  if (!canTransitionOrderStatus(prev.status, status)) {
    throw Object.assign(new Error(`Transition de commande interdite : ${prev.status} → ${status}`), { status: 409 });
  }
  const db = getDb(); const now = new Date().toISOString();
  const paymentStatus = coherentPaymentStatus(status, prev.paymentStatus, extra.paymentStatus);
  const tx = db.transaction(() => {
    if (status === "cancelled" && prev.status === "pending") releaseReservedStock(prev);
    if (status === "refunded" && ["paid", "preparing"].includes(prev.status)) releaseReservedStock(prev);
    db.prepare(`UPDATE mk_orders SET status=?,shipping_tracking=COALESCE(?,shipping_tracking),shipping_label_url=COALESCE(?,shipping_label_url),sumup_checkout_id=COALESCE(?,sumup_checkout_id),sumup_transaction_id=COALESCE(?,sumup_transaction_id),stripe_session_id=COALESCE(?,stripe_session_id),stripe_payment_intent=COALESCE(?,stripe_payment_intent),payment_status=?,payment_method=COALESCE(?,payment_method),updated_at=? WHERE id=?`).run(status, extra.tracking ?? null, extra.labelUrl ?? null, extra.sumupCheckoutId ?? extra.stripeSessionId ?? null, extra.sumupTransactionId ?? extra.paymentIntent ?? null, extra.stripeSessionId ?? null, extra.paymentIntent ?? null, paymentStatus, extra.paymentMethod ?? null, now, id);
  });
  tx();
  const updated = getOrder(id);
  if (status === "paid" && updated) applyPaidSideEffectsOnce(updated, prev.status);
  if (status === "refunded" && updated) updateSellerStats(updated.sellerId);
  if (_notifyHook && updated) _notifyHook(updated, status, prev.status).catch?.(() => {});
  return updated;
}

export function expireStalePendingOrders(maxAgeMs = 30 * 60 * 1000) {
  const cutoff = new Date(Date.now() - Math.max(5 * 60 * 1000, Number(maxAgeMs) || 0)).toISOString();
  const rows = getDb().prepare("SELECT id FROM mk_orders WHERE status='pending' AND payment_status='pending' AND created_at<? LIMIT 200").all(cutoff);
  let expired = 0;
  for (const row of rows) {
    try { updateOrderStatus(row.id, "cancelled", { paymentStatus: "failed", paymentMethod: "expired" }); expired += 1; } catch {}
  }
  return expired;
}

export function markOrderPaymentStatus(id, paymentStatus, extra = {}) {
  if (!PAYMENT_STATUSES.includes(paymentStatus)) throw new Error("Statut paiement invalide");
  const patch = { ...extra, paymentStatus };
  if (paymentStatus === "paid") return updateOrderStatus(id, "paid", patch);
  if (paymentStatus === "refunded") return updateOrderStatus(id, "refunded", patch);
  if (paymentStatus === "failed") return updateOrderStatus(id, "cancelled", patch);
  return updateOrderStatus(id, getOrder(id)?.status || "pending", patch);
}
export function markOrderPaid(id, { sumupCheckoutId, sumupTransactionId, stripeSessionId, paymentIntent, paymentMethod } = {}) { return updateOrderStatus(id, "paid", { sumupCheckoutId: sumupCheckoutId || stripeSessionId, sumupTransactionId: sumupTransactionId || paymentIntent, stripeSessionId, paymentIntent, paymentMethod: paymentMethod || "sumup_card", paymentStatus: "paid" }); }
export function getOrdersByBuyer(_email, buyerId) {
  if (!buyerId) return [];
  return getDb().prepare("SELECT * FROM mk_orders WHERE buyer_id=? ORDER BY created_at DESC LIMIT 100").all(String(buyerId)).map(toOrder);
}
export function getOrdersBySeller(sellerId) { return getDb().prepare("SELECT * FROM mk_orders WHERE seller_id=? ORDER BY created_at DESC LIMIT 100").all(sellerId).map(toOrder); }
export function getAllOrders(limit = 200) { return getDb().prepare("SELECT * FROM mk_orders ORDER BY created_at DESC LIMIT ?").all(limit).map(toOrder); }
export function getInvoiceHtml(orderId) { const order = getOrder(orderId); return order ? generateInvoiceHtml(order) : null; }
function parseItems(raw) { try { return JSON.parse(raw || "[]"); } catch { return []; } }
function toOrder(row) {
  const paymentRef = row.paypal_order_id || row.sumup_checkout_id || row.stripe_session_id || "";
  return { id: row.id, buyerEmail: row.buyer_email, buyerName: row.buyer_name, buyerId: row.buyer_id, sellerId: row.seller_id, listingId: row.listing_id, listingTitle: row.listing_title, items: parseItems(row.items_json), qty: row.qty, unitPrice: row.unit_price, shippingCost: row.shipping_cost, shippingCarrier: row.shipping_carrier, total: row.total, status: row.status, paymentStatus: row.payment_status || (row.status === "paid" ? "paid" : "pending"), paymentMethod: row.payment_method, paymentProvider: row.payment_provider || "", platformFee: Number(row.platform_fee || 0), sellerAmountAfterPlatformFee: Number(row.seller_amount_after_platform_fee || 0), paypalOrderId: row.paypal_order_id || "", paypalCaptureId: row.paypal_capture_id || "", sumupCheckoutId: row.sumup_checkout_id || "", sumupTransactionId: row.sumup_transaction_id || "", paymentReference: paymentRef, stripeSessionId: row.stripe_session_id, shippingTracking: row.shipping_tracking, shippingLabelUrl: row.shipping_label_url, shippingAddress: row.shipping_address, createdAt: row.created_at, updatedAt: row.updated_at };
}
export { STATUS_FLOW, PAYMENT_STATUSES };