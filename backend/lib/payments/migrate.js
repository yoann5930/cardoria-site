/**
 * Schéma paiements SumUp Cardoria — historique unifié boutique + marketplace.
 */
import { getDb } from "../engine/database.js";

export function migratePayments() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS pay_transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'marketplace',
      sumup_checkout_id TEXT DEFAULT '',
      sumup_transaction_id TEXT DEFAULT '',
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'EUR',
      status TEXT NOT NULL DEFAULT 'pending',
      payment_method TEXT DEFAULT 'sumup_card',
      customer_email TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      invoice_url TEXT DEFAULT '',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pay_status ON pay_transactions(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_pay_checkout ON pay_transactions(sumup_checkout_id);
    CREATE INDEX IF NOT EXISTS idx_pay_order ON pay_transactions(order_id, source);
  `);

  const cols = [
    ["sumup_checkout_id", "TEXT DEFAULT ''"],
    ["sumup_transaction_id", "TEXT DEFAULT ''"],
    ["payment_status", "TEXT DEFAULT 'pending'"]
  ];
  cols.forEach(([name, def]) => {
    try { db.exec(`ALTER TABLE mk_orders ADD COLUMN ${name} ${def}`); } catch { /* exists */ }
  });
}

export function makePaymentId() {
  return "PAY-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
}
