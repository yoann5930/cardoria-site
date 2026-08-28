import assert from "node:assert/strict";
import test from "node:test";
import { getDb } from "../lib/engine/database.js";
import { migrateAi } from "../lib/ai/migrate.js";
import { migrateMarketData } from "../lib/market/migrate.js";
import { getInventorySalesStats } from "../lib/engine/pricing.js";
import { ingestAdminManualSale, ingestAdminFeedbackOutcome } from "../lib/market/ingest.js";
import { recordMarketTransaction } from "../lib/market/record.js";

const db = getDb();
migrateAi();
migrateMarketData();

function seedCard() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const license = `stock-test-${suffix}`;
  const cardId = `stock-test-card-${suffix}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO licenses (slug,name,icon,description,active,sort_order,created_at) VALUES (?,?,?,?,1,0,?)`)
    .run(license, "Stock Test", "", "", now);
  db.prepare(`INSERT INTO cards (id,license_slug,language,slug,name,name_normalized,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(cardId, license, "fr", cardId, "Carte Stock Test", "carte stock test", now, now);
  return { cardId, license };
}

function cleanup(cardId, license) {
  db.prepare("DELETE FROM market_transactions WHERE card_id=?").run(cardId);
  db.prepare("DELETE FROM sales_history WHERE card_id=?").run(cardId);
  db.prepare("DELETE FROM market_card_stats WHERE card_id=?").run(cardId);
  db.prepare("DELETE FROM ai_price_history WHERE card_id=?").run(cardId);
  db.prepare("DELETE FROM ai_trends WHERE card_id=?").run(cardId);
  db.prepare("DELETE FROM price_sources WHERE card_id=?").run(cardId);
  db.prepare("DELETE FROM cards WHERE id=?").run(cardId);
  db.prepare("DELETE FROM licenses WHERE slug=?").run(license);
}

test("only proven Cardoria stock sales reduce inventory and quantities are preserved", () => {
  const { cardId, license } = seedCard();
  try {
    ingestAdminManualSale(cardId, {
      salePrice: 12,
      quantity: 3,
      condition: "NM",
      channel: "Cardoria",
      soldAt: "2026-08-28"
    });

    recordMarketTransaction({
      cardId,
      type: "listing_sale",
      salePrice: 20,
      quantity: 4,
      channel: "Marketplace Cardoria",
      transactionAt: "2026-08-28",
      sourceRef: `market-${cardId}`
    });

    recordMarketTransaction({
      cardId,
      type: "sale",
      salePrice: 18,
      quantity: 2,
      channel: "Cardoria",
      transactionAt: "2026-08-28",
      sourceRef: `estimate-${cardId}`,
      notes: "Prix revente estimé validé"
    });

    ingestAdminFeedbackOutcome({
      analysisId: `actual-${cardId}`,
      cardId,
      priceActualSell: 15,
      quantity: 2,
      resaleDelayDays: 1,
      condition: "EX"
    });

    const stats = getInventorySalesStats(cardId);
    assert.equal(stats.units, 5, "3 manual Cardoria units + 2 real admin resale units only");
    assert.equal(stats.revenue, 66, "3×12 + 2×15");

    const rows = db.prepare("SELECT transaction_type,quantity,notes FROM market_transactions WHERE card_id=? ORDER BY created_at,id").all(cardId);
    const manual = rows.find((row) => row.transaction_type === "admin_sale");
    const marketplace = rows.find((row) => row.transaction_type === "listing_sale");
    const estimate = rows.find((row) => row.notes === "Prix revente estimé validé");
    const actual = rows.find((row) => row.notes === "Revente réelle admin");
    assert.equal(manual?.quantity, 3);
    assert.equal(marketplace?.quantity, 4);
    assert.equal(estimate?.quantity, 2);
    assert.equal(actual?.quantity, 2);
  } finally {
    cleanup(cardId, license);
  }
});
