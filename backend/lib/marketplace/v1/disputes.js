/**
 * Litiges marketplace.
 */
import { getDb } from "../../engine/database.js";
import { makeMarketId } from "../migrate.js";
import { getOrder } from "../orders.js";

export function createDispute({ orderId, buyerEmail, reason }) {
  const order = getOrder(orderId);
  if (!order) throw new Error("Commande introuvable");
  if (order.buyerEmail.toLowerCase() !== String(buyerEmail).toLowerCase()) {
    throw new Error("Accès refusé");
  }

  const id = makeMarketId("DSP");
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO mk_disputes (id, order_id, buyer_email, seller_id, status, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(id, orderId, buyerEmail, order.sellerId, reason || "", now, now);

  getDb().prepare("UPDATE mk_orders SET dispute_status = 'open' WHERE id = ?").run(orderId);
  return getDispute(id);
}

export function resolveDispute(id, { status, resolution }) {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE mk_disputes SET status = ?, resolution = ?, updated_at = ? WHERE id = ?
  `).run(status || "resolved", resolution || "", now, id);

  const d = getDispute(id);
  if (d) getDb().prepare("UPDATE mk_orders SET dispute_status = ? WHERE id = ?").run(status, d.orderId);
  return d;
}

export function listDisputes({ status, limit = 100 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM mk_disputes";
  const params = [];
  if (status) { sql += " WHERE status = ?"; params.push(status); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map(mapDispute);
}

export function getDispute(id) {
  const row = getDb().prepare("SELECT * FROM mk_disputes WHERE id = ?").get(id);
  return row ? mapDispute(row) : null;
}

function mapDispute(r) {
  return {
    id: r.id,
    orderId: r.order_id,
    buyerEmail: r.buyer_email,
    sellerId: r.seller_id,
    status: r.status,
    reason: r.reason,
    resolution: r.resolution,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
