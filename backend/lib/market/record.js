/**
 * Enregistrement des transactions marché Cardoria.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";
import { makeTransactionId } from "./migrate.js";
import { recomputeCardStats } from "./stats.js";
import { recordActualSaleOutcomeSync } from "../ai-enterprise/index.js";

export function recordMarketTransaction(data) {
  const db = getDb();
  const now = new Date().toISOString();
  const cardId = data.cardId || null;
  const card = cardId ? getCardById(cardId) : null;

  const id = data.id || makeTransactionId("TX");
  const transactionAt = (data.transactionAt || data.soldAt || now).slice(0, 10);

  if (data.sourceRef && data.type) {
    const dup = db.prepare(`
      SELECT id FROM market_transactions WHERE source_ref = ? AND transaction_type = ? LIMIT 1
    `).get(data.sourceRef, data.type);
    if (dup) return { id: dup.id, cardId, skipped: true };
  }

  db.prepare(`
    INSERT INTO market_transactions (
      id, card_id, transaction_type, sale_price, buyback_price, currency, transaction_at,
      condition, language, license_slug, extension, card_number, seller, buyer,
      days_to_sell, channel, source_ref, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    cardId,
    data.type || "sale",
    data.salePrice != null ? Number(data.salePrice) : null,
    data.buybackPrice != null ? Number(data.buybackPrice) : null,
    data.currency || "EUR",
    transactionAt,
    data.condition || card?.condition || "",
    data.language || "",
    data.license || card?.license || "",
    data.extension || card?.extension || "",
    data.number || card?.number || "",
    data.seller || "",
    data.buyer || "",
    data.daysToSell != null ? Number(data.daysToSell) : null,
    data.channel || "Cardoria",
    data.sourceRef || "",
    data.notes || "",
    now
  );

  if (cardId && data.salePrice > 0 && ["sale", "listing_sale", "admin_sale", "boutique_sale"].includes(data.type)) {
    syncLegacySaleHistory(cardId, {
      price: data.salePrice,
      condition: data.condition,
      channel: data.channel,
      soldAt: transactionAt
    });
  }

  if (cardId) {
    recomputeCardStats(cardId);
  }

  if (cardId && data.salePrice > 0 && ["sale", "listing_sale", "admin_sale", "boutique_sale"].includes(data.type)) {
    try {
      recordActualSaleOutcomeSync({
        cardId,
        analysisId: data.sourceRef,
        actualSell: data.salePrice,
        saleDelayDays: data.daysToSell
      });
    } catch { /* ignore */ }
  }

  return { id, cardId, transactionAt, skipped: false };
}

function syncLegacySaleHistory(cardId, { price, condition, channel, soldAt }) {
  const db = getDb();
  const exists = db.prepare(`
    SELECT id FROM sales_history WHERE card_id = ? AND sold_at = ? AND price = ? LIMIT 1
  `).get(cardId, soldAt, Number(price));

  if (exists) return;

  db.prepare(`
    INSERT INTO sales_history (card_id, sold_at, price, condition, channel)
    VALUES (?, ?, ?, ?, ?)
  `).run(cardId, soldAt, Number(price), condition || "NM", channel || "Cardoria");
}

export function importLegacySalesHistory() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT sh.*, c.license_slug, c.extension, c.number, c.rarity
    FROM sales_history sh
    LEFT JOIN cards c ON c.id = sh.card_id
    WHERE sh.card_id IS NOT NULL
  `).all();

  let imported = 0;
  rows.forEach((row) => {
    const exists = db.prepare(`
      SELECT id FROM market_transactions WHERE card_id = ? AND transaction_at = ? AND sale_price = ? LIMIT 1
    `).get(row.card_id, row.sold_at, row.price);
    if (exists) return;

    recordMarketTransaction({
      id: makeTransactionId("LEG"),
      cardId: row.card_id,
      type: "admin_sale",
      salePrice: row.price,
      condition: row.condition,
      channel: row.channel,
      transactionAt: row.sold_at,
      license: row.license_slug,
      extension: row.extension,
      number: row.number,
      notes: "Import sales_history"
    });
    imported++;
  });
  return { imported };
}
