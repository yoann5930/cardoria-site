/**
 * Litiges marketplace — cycle de vie contrôlé et historique Admin.
 */
import { getDb } from "../../engine/database.js";
import { makeMarketId } from "../migrate.js";
import { getOrder } from "../orders.js";

const DISPUTE_STATUSES = new Set(["open", "investigating", "waiting_buyer", "waiting_seller", "resolved", "rejected", "closed"]);
const DISPUTE_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const RESOLUTION_CODES = new Set(["none", "buyer_refund", "seller_favor", "partial_refund", "agreement", "insufficient_evidence", "duplicate", "other"]);
const ALLOWED_TRANSITIONS = {
  open: new Set(["investigating", "waiting_buyer", "waiting_seller", "resolved", "rejected", "closed"]),
  investigating: new Set(["waiting_buyer", "waiting_seller", "resolved", "rejected", "closed"]),
  waiting_buyer: new Set(["investigating", "waiting_seller", "resolved", "rejected", "closed"]),
  waiting_seller: new Set(["investigating", "waiting_buyer", "resolved", "rejected", "closed"]),
  resolved: new Set(["closed", "investigating"]),
  rejected: new Set(["closed", "investigating"]),
  closed: new Set(["investigating"])
};

function cleanStatus(value, fallback = "open") {
  const status = String(value || fallback).trim().toLowerCase();
  if (!DISPUTE_STATUSES.has(status)) throw Object.assign(new Error("Statut de litige invalide"), { status: 400 });
  return status;
}
function cleanPriority(value, fallback = "normal") {
  const priority = String(value || fallback).trim().toLowerCase();
  if (!DISPUTE_PRIORITIES.has(priority)) throw Object.assign(new Error("Priorité de litige invalide"), { status: 400 });
  return priority;
}
function cleanResolutionCode(value) {
  const code = String(value || "none").trim().toLowerCase();
  if (!RESOLUTION_CODES.has(code)) throw Object.assign(new Error("Code de résolution invalide"), { status: 400 });
  return code;
}
function addEvent(db, disputeId, { actor = "", action = "update", fromStatus = "", toStatus = "", note = "" } = {}) {
  db.prepare(`INSERT INTO mk_dispute_events (dispute_id,actor,action,from_status,to_status,note,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(disputeId, String(actor || "").slice(0, 200), String(action || "update").slice(0, 80), fromStatus, toStatus, String(note || "").slice(0, 2000), new Date().toISOString());
}

export function createDispute({ orderId, buyerEmail, reason }) {
  const order = getOrder(orderId);
  if (!order) throw Object.assign(new Error("Commande introuvable"), { status: 404 });
  if (order.buyerEmail.toLowerCase() !== String(buyerEmail).toLowerCase()) throw Object.assign(new Error("Accès refusé"), { status: 403 });
  const db = getDb();
  const existing = db.prepare("SELECT id FROM mk_disputes WHERE order_id=? AND status NOT IN ('closed','rejected') ORDER BY created_at DESC LIMIT 1").get(orderId);
  if (existing) throw Object.assign(new Error("Un litige actif existe déjà pour cette commande."), { status: 409 });

  const id = makeMarketId("DSP");
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO mk_disputes (id, order_id, buyer_email, seller_id, status, priority, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', 'normal', ?, ?, ?)
  `).run(id, orderId, buyerEmail, order.sellerId, String(reason || "").trim().slice(0, 2000), now, now);
  db.prepare("UPDATE mk_orders SET dispute_status = 'open' WHERE id = ?").run(orderId);
  addEvent(db, id, { actor: buyerEmail, action: "created", toStatus: "open", note: reason || "" });
  return getDispute(id, { includeHistory: true });
}

export function updateDisputeAdmin(id, patch = {}, actor = "admin") {
  const db = getDb();
  const current = getDispute(id);
  if (!current) throw Object.assign(new Error("Litige introuvable"), { status: 404 });
  const nextStatus = patch.status ? cleanStatus(patch.status, current.status) : current.status;
  const priority = patch.priority ? cleanPriority(patch.priority, current.priority) : current.priority;
  const resolutionCode = patch.resolutionCode ? cleanResolutionCode(patch.resolutionCode) : (current.resolutionCode || "none");
  const resolution = String(patch.resolution ?? current.resolution ?? "").trim().slice(0, 4000);
  const adminNote = String(patch.adminNote ?? current.adminNote ?? "").trim().slice(0, 4000);

  if (nextStatus !== current.status && !ALLOWED_TRANSITIONS[current.status]?.has(nextStatus)) {
    throw Object.assign(new Error(`Transition de litige interdite : ${current.status} → ${nextStatus}`), { status: 409 });
  }
  if (["resolved", "rejected", "closed"].includes(nextStatus) && resolution.length < 3) {
    throw Object.assign(new Error("Une résolution est obligatoire pour clôturer ou rejeter un litige."), { status: 400 });
  }
  if (nextStatus === "resolved" && resolutionCode === "none") {
    throw Object.assign(new Error("Un code de résolution est obligatoire pour résoudre un litige."), { status: 400 });
  }

  const now = new Date().toISOString();
  const terminal = ["resolved", "rejected", "closed"].includes(nextStatus);
  db.prepare(`
    UPDATE mk_disputes SET status=?, priority=?, resolution=?, resolution_code=?, admin_note=?,
      resolved_by=?, resolved_at=?, updated_at=? WHERE id=?
  `).run(nextStatus, priority, resolution, resolutionCode, adminNote, terminal ? String(actor || "admin").slice(0, 200) : "", terminal ? now : "", now, id);
  db.prepare("UPDATE mk_orders SET dispute_status=? WHERE id=?").run(nextStatus, current.orderId);
  addEvent(db, id, {
    actor,
    action: nextStatus !== current.status ? "status_change" : "admin_update",
    fromStatus: current.status,
    toStatus: nextStatus,
    note: adminNote || resolution || `Priorité: ${priority}`
  });
  return getDispute(id, { includeHistory: true });
}

export function resolveDispute(id, patch = {}, actor = "admin") {
  return updateDisputeAdmin(id, { ...patch, status: patch.status || "resolved" }, actor);
}

export function listDisputes({ status, priority, limit = 100 } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];
  if (status) { conds.push("status = ?"); params.push(cleanStatus(status)); }
  if (priority) { conds.push("priority = ?"); params.push(cleanPriority(priority)); }
  let sql = "SELECT * FROM mk_disputes";
  if (conds.length) sql += " WHERE " + conds.join(" AND ");
  sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at DESC LIMIT ?";
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  return db.prepare(sql).all(...params).map(mapDispute);
}

export function getDispute(id, { includeHistory = false } = {}) {
  const row = getDb().prepare("SELECT * FROM mk_disputes WHERE id = ?").get(id);
  if (!row) return null;
  const dispute = mapDispute(row);
  if (includeHistory) dispute.history = listDisputeEvents(id);
  return dispute;
}

export function listDisputeEvents(id) {
  return getDb().prepare(`SELECT id,actor,action,from_status AS fromStatus,to_status AS toStatus,note,created_at AS createdAt FROM mk_dispute_events WHERE dispute_id=? ORDER BY id ASC`).all(id);
}

function mapDispute(r) {
  return {
    id: r.id,
    orderId: r.order_id,
    buyerEmail: r.buyer_email,
    sellerId: r.seller_id,
    status: r.status,
    priority: r.priority || "normal",
    reason: r.reason,
    resolution: r.resolution,
    resolutionCode: r.resolution_code || "none",
    adminNote: r.admin_note || "",
    resolvedBy: r.resolved_by || "",
    resolvedAt: r.resolved_at || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export { DISPUTE_STATUSES, DISPUTE_PRIORITIES, RESOLUTION_CODES };
