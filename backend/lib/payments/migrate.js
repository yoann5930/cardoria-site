/**
 * Schéma paiements Cardoria — multi-prestataire.
 * Les colonnes SumUp historiques sont conservées uniquement pour compatibilité.
 */
import { getDb } from "../engine/database.js";

function addColumn(db, table, name, definition) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); } catch { /* déjà présent / table absente */ }
}

export function migratePayments() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS pay_transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'marketplace',
      provider TEXT NOT NULL DEFAULT 'revolut',
      provider_order_id TEXT DEFAULT '',
      provider_transaction_id TEXT DEFAULT '',
      sumup_checkout_id TEXT DEFAULT '',
      sumup_transaction_id TEXT DEFAULT '',
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'EUR',
      status TEXT NOT NULL DEFAULT 'pending',
      payment_method TEXT DEFAULT '',
      customer_email TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      invoice_url TEXT DEFAULT '',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  addColumn(db, "pay_transactions", "provider", "TEXT NOT NULL DEFAULT 'sumup'");
  addColumn(db, "pay_transactions", "provider_order_id", "TEXT DEFAULT ''");
  addColumn(db, "pay_transactions", "provider_transaction_id", "TEXT DEFAULT ''");

  try {
    db.exec(`
      UPDATE pay_transactions
      SET provider = CASE
        WHEN COALESCE(provider, '') = '' THEN CASE WHEN COALESCE(sumup_checkout_id, '') <> '' THEN 'sumup' ELSE 'revolut' END
        ELSE provider
      END,
      provider_order_id = CASE WHEN COALESCE(provider_order_id, '') = '' THEN COALESCE(sumup_checkout_id, '') ELSE provider_order_id END,
      provider_transaction_id = CASE WHEN COALESCE(provider_transaction_id, '') = '' THEN COALESCE(sumup_transaction_id, '') ELSE provider_transaction_id END;
    `);
  } catch { /* table ancienne incomplète */ }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pay_status ON pay_transactions(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_pay_checkout ON pay_transactions(sumup_checkout_id);
    CREATE INDEX IF NOT EXISTS idx_pay_provider_order ON pay_transactions(provider, provider_order_id);
    CREATE INDEX IF NOT EXISTS idx_pay_order ON pay_transactions(order_id, source);
  `);

  const marketplaceCols = [
    ["sumup_checkout_id", "TEXT DEFAULT ''"],
    ["sumup_transaction_id", "TEXT DEFAULT ''"],
    ["payment_provider", "TEXT DEFAULT ''"],
    ["payment_provider_order_id", "TEXT DEFAULT ''"],
    ["payment_provider_transaction_id", "TEXT DEFAULT ''"],
    ["payment_status", "TEXT DEFAULT 'pending'"]
  ];
  marketplaceCols.forEach(([name, def]) => addColumn(db, "mk_orders", name, def));
}

export function makePaymentId() {
  return "PAY-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
}
