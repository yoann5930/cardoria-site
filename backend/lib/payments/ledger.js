/**
 * Historique unifié des paiements Cardoria.
 * Les champs SumUp restent lisibles pour l'historique, les nouveaux paiements utilisent provider_*.
 */
import { getDb } from "../engine/database.js";
import { makePaymentId, migratePayments } from "./migrate.js";

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

function ensureSchema() { migratePayments(); }

export function recordPayment(data) {
  ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const id = data.id || makePaymentId();
  const provider = String(data.provider || (data.sumupCheckoutId ? "sumup" : "revolut")).toLowerCase();
  const providerOrderId = data.providerOrderId || data.sumupCheckoutId || "";
  const providerTransactionId = data.providerTransactionId || data.sumupTransactionId || "";
  const legacyCheckoutId = provider === "sumup" ? providerOrderId : (data.sumupCheckoutId || "");
  const legacyTransactionId = provider === "sumup" ? providerTransactionId : (data.sumupTransactionId || "");
  const paymentMethod = data.paymentMethod || (provider === "revolut" ? "revolut_hosted" : "sumup_card");

  db.prepare(`
    INSERT INTO pay_transactions (
      id, order_id, source, provider, provider_order_id, provider_transaction_id,
      sumup_checkout_id, sumup_transaction_id,
      amount, currency, status, payment_method, customer_email, customer_name,
      description, invoice_url, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      provider_order_id = COALESCE(NULLIF(excluded.provider_order_id, ''), pay_transactions.provider_order_id),
      provider_transaction_id = COALESCE(NULLIF(excluded.provider_transaction_id, ''), pay_transactions.provider_transaction_id),
      sumup_checkout_id = COALESCE(NULLIF(excluded.sumup_checkout_id, ''), pay_transactions.sumup_checkout_id),
      sumup_transaction_id = COALESCE(NULLIF(excluded.sumup_transaction_id, ''), pay_transactions.sumup_transaction_id),
      status = excluded.status,
      payment_method = COALESCE(NULLIF(excluded.payment_method, ''), pay_transactions.payment_method),
      invoice_url = COALESCE(NULLIF(excluded.invoice_url, ''), pay_transactions.invoice_url),
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    id,
    data.orderId,
    data.source || "marketplace",
    provider,
    providerOrderId,
    providerTransactionId,
    legacyCheckoutId,
    legacyTransactionId,
    Number(data.amount || 0),
    data.currency || "EUR",
    data.status || "pending",
    paymentMethod,
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
  ensureSchema();
  const row = getDb().prepare("SELECT id FROM pay_transactions WHERE provider_order_id = ? OR sumup_checkout_id = ? ORDER BY created_at DESC LIMIT 1").get(checkoutId, checkoutId);
  return row ? updatePayment(row.id, patch) : null;
}

export function updatePaymentByProviderOrderId(providerOrderId, patch) {
  ensureSchema();
  const row = getDb().prepare("SELECT id FROM pay_transactions WHERE provider_order_id = ? ORDER BY created_at DESC LIMIT 1").get(providerOrderId);
  return row ? updatePayment(row.id, patch) : null;
}

export function updatePayment(id, patch) {
  ensureSchema();
  const db = getDb();
  const current = getPayment(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const provider = patch.provider ?? null;
  const providerOrderId = patch.providerOrderId ?? null;
  const providerTransactionId = patch.providerTransactionId ?? null;
  const legacyTransactionId = patch.sumupTransactionId ?? (provider === "sumup" ? providerTransactionId : null);

  db.prepare(`
    UPDATE pay_transactions SET
      provider = COALESCE(?, provider),
      provider_order_id = COALESCE(?, provider_order_id),
      provider_transaction_id = COALESCE(?, provider_transaction_id),
      status = COALESCE(?, status),
      sumup_transaction_id = COALESCE(?, sumup_transaction_id),
      payment_method = COALESCE(?, payment_method),
      invoice_url = COALESCE(?, invoice_url),
      metadata_json = COALESCE(?, metadata_json),
      updated_at = ?
    WHERE id = ?
  `).run(
    provider,
    providerOrderId,
    providerTransactionId,
    patch.status ?? null,
    legacyTransactionId,
    patch.paymentMethod ?? null,
    patch.invoiceUrl ?? null,
    patch.metadata ? JSON.stringify(patch.metadata) : null,
    now,
    id
  );
  return getPayment(id);
}

export function getPayment(id) {
  ensureSchema();
  const row = getDb().prepare("SELECT * FROM pay_transactions WHERE id = ?").get(id);
  return row ? mapPayment(row) : null;
}

export function getPaymentByCheckoutId(checkoutId) {
  ensureSchema();
  const row = getDb().prepare("SELECT * FROM pay_transactions WHERE provider_order_id = ? OR sumup_checkout_id = ? ORDER BY created_at DESC LIMIT 1").get(checkoutId, checkoutId);
  return row ? mapPayment(row) : null;
}

export function getPaymentByProviderOrderId(providerOrderId) {
  ensureSchema();
  const row = getDb().prepare("SELECT * FROM pay_transactions WHERE provider_order_id = ? ORDER BY created_at DESC LIMIT 1").get(providerOrderId);
  return row ? mapPayment(row) : null;
}

export function getPaymentByOrderId(orderId, provider = "") {
  ensureSchema();
  const db = getDb();
  const row = provider
    ? db.prepare("SELECT * FROM pay_transactions WHERE order_id = ? AND provider = ? ORDER BY created_at DESC LIMIT 1").get(orderId, provider)
    : db.prepare("SELECT * FROM pay_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").get(orderId);
  return row ? mapPayment(row) : null;
}

export function listPayments({ status, source, provider, limit = 200 } = {}) {
  ensureSchema();
  const db = getDb();
  let sql = "SELECT * FROM pay_transactions WHERE 1=1";
  const params = [];
  if (status) { sql += " AND status = ?"; params.push(status); }
  if (source) { sql += " AND source = ?"; params.push(source); }
  if (provider) { sql += " AND provider = ?"; params.push(provider); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(Number(limit) || 200);
  return db.prepare(sql).all(...params).map(mapPayment);
}

function mapPayment(row) {
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json || "{}"); } catch { /* ignore */ }
  const provider = row.provider || (row.sumup_checkout_id ? "sumup" : "");
  return {
    id: row.id,
    orderId: row.order_id,
    source: row.source,
    provider,
    providerOrderId: row.provider_order_id || row.sumup_checkout_id || "",
    providerTransactionId: row.provider_transaction_id || row.sumup_transaction_id || "",
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
