/**
 * Marketplace v1 — init + stats.
 */
import { migrateMarketplaceV1 } from "./migrate.js";
import { getDb } from "../../engine/database.js";

export function initMarketplaceV1() {
  migrateMarketplaceV1();
}

export function getMarketplaceStats() {
  const db = getDb();
  return {
    listings: db.prepare("SELECT COUNT(*) AS c FROM mk_listings").get()?.c ?? 0,
    listingsActive: db.prepare("SELECT COUNT(*) AS c FROM mk_listings WHERE status = 'active'").get()?.c ?? 0,
    orders: db.prepare("SELECT COUNT(*) AS c FROM mk_orders").get()?.c ?? 0,
    ordersPaid: db.prepare("SELECT COUNT(*) AS c FROM mk_orders WHERE status IN ('paid','preparing','shipped','delivered')").get()?.c ?? 0,
    revenue: db.prepare(`
      SELECT COALESCE(SUM(total), 0) AS s FROM mk_orders WHERE status IN ('paid','preparing','shipped','delivered')
    `).get()?.s ?? 0,
    sellers: db.prepare("SELECT COUNT(*) AS c FROM mk_sellers").get()?.c ?? 0,
    disputesOpen: db.prepare("SELECT COUNT(*) AS c FROM mk_disputes WHERE status = 'open'").get()?.c ?? 0,
    ordersToday: db.prepare(`
      SELECT COUNT(*) AS c FROM mk_orders WHERE date(created_at) = date('now')
    `).get()?.c ?? 0
  };
}

export { migrateMarketplaceV1 };
