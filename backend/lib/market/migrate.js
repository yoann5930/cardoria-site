/**
 * Schéma moteur de données de marché Cardoria.
 */
import { getDb } from "../engine/database.js";

export function migrateMarketData() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_transactions (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      transaction_type TEXT NOT NULL,
      sale_price REAL,
      buyback_price REAL,
      currency TEXT DEFAULT 'EUR',
      transaction_at TEXT NOT NULL,
      condition TEXT DEFAULT '',
      language TEXT DEFAULT '',
      license_slug TEXT DEFAULT '',
      extension TEXT DEFAULT '',
      card_number TEXT DEFAULT '',
      seller TEXT DEFAULT '',
      buyer TEXT DEFAULT '',
      days_to_sell INTEGER,
      channel TEXT DEFAULT 'Cardoria',
      source_ref TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS market_card_stats (
      card_id TEXT PRIMARY KEY,
      avg_price REAL DEFAULT 0,
      median_price REAL DEFAULT 0,
      min_price REAL DEFAULT 0,
      max_price REAL DEFAULT 0,
      volume INTEGER DEFAULT 0,
      buyback_avg REAL DEFAULT 0,
      buyback_volume INTEGER DEFAULT 0,
      internal_avg REAL DEFAULT 0,
      evolution_7d REAL DEFAULT 0,
      evolution_30d REAL DEFAULT 0,
      evolution_90d REAL DEFAULT 0,
      evolution_1y REAL DEFAULT 0,
      liquidity_index REAL DEFAULT 50,
      demand_index REAL DEFAULT 50,
      rarity_index REAL DEFAULT 50,
      computed_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_market_tx_card ON market_transactions(card_id, transaction_at);
    CREATE INDEX IF NOT EXISTS idx_market_tx_type ON market_transactions(transaction_type, transaction_at);
    CREATE INDEX IF NOT EXISTS idx_market_tx_date ON market_transactions(transaction_at);
  `);
}

export function makeTransactionId(prefix = "MKT") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}


/**
 * Supprime les anciennes pseudo-transactions créées par les estimations IA.
 * Ces lignes ne sont pas des ventes/rachats réels et ne doivent jamais alimenter la cote marché.
 * Retourne les cartes affectées pour recalculer leurs statistiques.
 */
export function purgeEstimatedMarketPollution() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT card_id
    FROM market_transactions
    WHERE card_id IS NOT NULL
      AND (
        transaction_type = 'estimate_buyback'
        OR notes = 'Offre rachat estimation IA'
        OR notes = 'Prix revente estimé validé'
      )
  `).all();
  const affectedCardIds = rows.map((row) => row.card_id).filter(Boolean);

  if (!affectedCardIds.length) {
    return { removedTransactions: 0, removedLegacySales: 0, affectedCardIds: [] };
  }

  const result = db.transaction(() => {
    const legacy = db.prepare(`
      DELETE FROM sales_history
      WHERE EXISTS (
        SELECT 1
        FROM market_transactions mt
        WHERE mt.card_id = sales_history.card_id
          AND mt.transaction_at = sales_history.sold_at
          AND mt.sale_price = sales_history.price
          AND mt.notes = 'Prix revente estimé validé'
      )
    `).run();

    const tx = db.prepare(`
      DELETE FROM market_transactions
      WHERE transaction_type = 'estimate_buyback'
         OR notes = 'Offre rachat estimation IA'
         OR notes = 'Prix revente estimé validé'
    `).run();

    return {
      removedTransactions: Number(tx.changes || 0),
      removedLegacySales: Number(legacy.changes || 0)
    };
  })();

  return { ...result, affectedCardIds };
}
