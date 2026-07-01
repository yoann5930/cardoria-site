/**
 * Historique des paiements SumUp — boutique et marketplace.
 */
import { getDb } from "../engine/database.js";
import { makePaymentId } from "./migrate.js";

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

export function recordPayment(data) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = data.id || makePaymentId();
  db.prepare(`
    INSERT INTO pay_transactions (
      id, order_id, source, sumup_checkout_id, sumup_transaction_id,
      amount, currency, status, payment_method, customer_email, customer_name,
      description, invoice_url, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sumup_checkout_id = COALESCE(excluded.sumup_checkout_id, pay_transactions.sumup_checkout_id),
      sumup_transaction_id = COALESCE(excluded.sumup_transaction_id, pay_transactions.sumup_transaction_id),
      status = excluded.status,
      payment_method = COALESCE(excluded.payment_method, pay_transactions.payment_method),
      invoice_url = COALESCE(excluded.invoice_url, pay_transactions.invoice_url),
      updated_at = excluded.updated_at
  `).run(
    id,
    data.orderId,
    data.source || "marketplace",
    data.sumupCheckoutId || "",
    data.sumupTransactionId || "",
    data.amount,
    data.currency || "EUR",
    data.status || "pending",
    data.paymentMethod || "sumup_card",
    data.customerEmail || "",
    data.customerName || "",
    data.description || "",
    data.invoiceUrl || "",
    JSON.stringify(data.metadata || {}),
    data.createdAt || now,
    now
  );
  return getPayment(id);
}

export function updatePaymentByCheckoutId(checkoutId, patch) {
  const row = getDb().prepare("SELECT id FROM pay_transactions WHERE sumup_checkout_id = ?").get(checkoutId);
  if (!row) return null;
  return updatePayment(row.id, patch);
}

export function updatePayment(id, patch) {
  const db = getDb();
  const current = getPayment(id);
  if (!current) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE pay_transactions SET
      status = COALESCE(?, status),
      sumup_transaction_id = COALESCE(?, sumup_transaction_id),
      payment_method = COALESCE(?, payment_method),
      invoice_url = COALESCE(?, invoice_url),
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.status ?? null,
    patch.sumupTransactionId ?? null,
    patch.paymentMethod ?? null,
    patch.invoiceUrl ?? null,
    now,
    id
  );
  return getPayment(id);
}

export function getPayment(id) {
  const row = getDb().prepare("SELECT * FROM pay_transactions WHERE id = ?").get(id);
  return row ? mapPayment(row) : null;
}

export function getPaymentByCheckoutId(checkoutId) {
  const row = getDb().prepare("SELECT * FROM pay_transactions WHERE sumup_checkout_id = ?").get(checkoutId);
  return row ? mapPayment(row) : null;
}

export function listPayments({ status, source, limit = 200 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM pay_transactions WHERE 1=1";
  const params = [];
  if (status) { sql += " AND status = ?"; params.push(status); }
  if (source) { sql += " AND source = ?"; params.push(source); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(Number(limit) || 200);
  return db.prepare(sql).all(...params).map(mapPayment);
}

function mapPayment(row) {
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json || "{}"); } catch { /* ignore */ }
  return {
    id: row.id,
    orderId: row.order_id,
    source: row.source,
    sumupCheckoutId: row.sumup_checkout_id,
    sumupTransactionId: row.sumup_transaction_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    paymentMethod: row.payment_method,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    description: row.description,
    invoiceUrl: row.invoice_url,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
