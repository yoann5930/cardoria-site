import assert from "node:assert/strict";
import test from "node:test";
import { buildPurchaseAccountingStats, isPaidPurchase } from "../lib/accounting/purchase-stats.js";

const normalizeBuyer = (value) => ["yoann", "valentin"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "non_attribue";
const normalizeType = (value) => ["pokemon_card", "consumable", "equipment"].includes(value) ? value : "legacy";

test("only paid purchases affect accounting costs", () => {
  const stats = buildPurchaseAccountingStats([
    { status: "paid", amount: 100, buyer: "yoann", seller: "A", category: "cartes", license: "pokemon", purchaseType: "pokemon_card" },
    { status: "cancelled", amount: 80, buyer: "yoann", seller: "B", category: "cartes", license: "pokemon", purchaseType: "pokemon_card" },
    { status: "refunded", amount: 50, buyer: "valentin", seller: "C", category: "materiel", license: "", purchaseType: "equipment" },
    { status: "pending", amount: 30, buyer: "valentin", seller: "D", category: "consommables", license: "", purchaseType: "consumable" }
  ], { normalizeBuyer, normalizeType });

  assert.equal(stats.total, 100);
  assert.equal(stats.count, 1);
  assert.deepEqual(stats.byBuyer, { yoann: 100, valentin: 0, non_attribue: 0 });
  assert.deepEqual(stats.bySeller, { A: 100 });
  assert.deepEqual(stats.byCategory, { cartes: 100 });
  assert.deepEqual(stats.byType, { pokemon_card: 100 });
  assert.deepEqual(stats.byLicense, { pokemon: 100 });
});

test("legacy purchase without status remains paid for backward compatibility", () => {
  assert.equal(isPaidPurchase({ amount: 12 }), true);
  const stats = buildPurchaseAccountingStats([{ amount: 12, buyer: "yoann", seller: "Legacy", purchaseType: "pokemon_card" }], { normalizeBuyer, normalizeType });
  assert.equal(stats.total, 12);
  assert.equal(stats.count, 1);
});
