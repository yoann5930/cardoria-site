import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountingSales } from "../lib/accounting/sales-stats.js";

test("accounting revenue uses paid boutique totals and recorded marketplace platform fees only", () => {
  const result = buildAccountingSales({
    boutiqueOrders: [
      { id: "B1", paymentStatus: "paid", total: 100, client: "Client 1", date: "2026-08-28" },
      { id: "B2", paymentStatus: "pending", total: 70, client: "Client 2", date: "2026-08-28" },
      { id: "B3", paymentStatus: "refunded", total: 50, client: "Client 3", date: "2026-08-28" }
    ],
    marketplaceOrders: [
      { id: "M1", payment_status: "paid", total: 200, platform_fee: 20, seller_id: "S1", buyer_name: "Acheteur 1", license_slug: "pokemon", updated_at: "2026-08-28T12:00:00Z" },
      { id: "M2", payment_status: "pending", total: 300, platform_fee: 30, seller_id: "S2", buyer_name: "Acheteur 2", license_slug: "pokemon", updated_at: "2026-08-28T12:00:00Z" },
      { id: "M3", payment_status: "refunded", total: 400, platform_fee: 40, seller_id: "S3", buyer_name: "Acheteur 3", license_slug: "pokemon", updated_at: "2026-08-28T12:00:00Z" },
      { id: "M4", payment_status: "paid", total: 150, platform_fee: 0, seller_id: "S4", buyer_name: "Acheteur 4", license_slug: "pokemon", updated_at: "2026-08-28T12:00:00Z" }
    ]
  });

  assert.equal(result.totalRevenue, 120);
  assert.equal(result.boutiqueRevenue, 100);
  assert.equal(result.marketplaceRevenue, 20);
  assert.equal(result.sales.length, 2);
  assert.equal(result.unresolvedMarketplace.length, 1);
  assert.equal(result.unresolvedMarketplace[0].id, "M4");
  assert.equal(result.unresolvedMarketplace[0].grossAmount, 150);

  const boutique = result.sales.find((sale) => sale.id === "B1");
  const marketplace = result.sales.find((sale) => sale.id === "M1");
  assert.equal(boutique.amount, 100);
  assert.equal(boutique.revenueType, "sale");
  assert.equal(marketplace.amount, 20);
  assert.equal(marketplace.grossAmount, 200);
  assert.equal(marketplace.revenueType, "platform_fee");
});

test("accounting never treats marketplace gross seller turnover as Cardoria revenue", () => {
  const result = buildAccountingSales({
    marketplaceOrders: [
      { id: "M1", payment_status: "paid", total: 999.99, platform_fee: 12.34, seller_id: "seller", updated_at: "2026-08-28T12:00:00Z" }
    ]
  });
  assert.equal(result.totalRevenue, 12.34);
  assert.equal(result.sales[0].amount, 12.34);
  assert.equal(result.sales[0].grossAmount, 999.99);
});
