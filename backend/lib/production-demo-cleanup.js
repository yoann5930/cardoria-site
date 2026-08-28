import { getDb } from "./engine/database.js";
import { readJson, writeJson } from "./storage.js";

const MARKERS = ["demo", "test", "sample", "fake", "mock"];

function text(value) { return String(value ?? "").trim().toLowerCase(); }
function marked(value) {
  const v = text(value);
  if (!v) return false;
  const tokens = v.split(/[^a-z0-9]+/).filter(Boolean);
  return MARKERS.some((marker) => tokens.includes(marker));
}
function prefixed(value) {
  const v = text(value);
  return MARKERS.some((marker) => v === marker || v.startsWith(marker + "-") || v.startsWith(marker + "_") || v.startsWith(marker + ":"));
}
function placeholders(count) { return Array.from({ length: count }, () => "?").join(","); }
function safeRun(db, sql, params = []) {
  try { return db.prepare(sql).run(...params).changes || 0; } catch { return 0; }
}
function rows(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch { return []; }
}
function deleteOrderDependencies(db, orderIds, report) {
  if (!orderIds.length) return;
  const p = placeholders(orderIds.length);
  report.relatedRows += safeRun(db, `DELETE FROM mk_reviews WHERE order_id IN (${p})`, orderIds);
  report.relatedRows += safeRun(db, `DELETE FROM mk_invoices WHERE order_id IN (${p})`, orderIds);
  report.relatedRows += safeRun(db, `DELETE FROM mk_disputes WHERE order_id IN (${p})`, orderIds);
}

export function cleanupProductionDemoData() {
  const db = getDb();
  const configuredAdmin = text(process.env.ADMIN_EMAIL || "Cardoria59330@gmail.com");
  const report = { demoUsers: 0, demoSellers: 0, demoListings: 0, demoCards: 0, demoPurchases: 0, relatedRows: 0 };

  db.pragma("foreign_keys = OFF");
  const tx = db.transaction(() => {
    const demoUsers = rows(db, "SELECT id,email,name,role FROM auth_users").filter((u) => {
      const email = text(u.email);
      if (!email || email === configuredAdmin) return false;
      return marked(email) || marked(u.name);
    });
    const demoUserIds = demoUsers.map((u) => u.id).filter(Boolean);
    const demoEmails = demoUsers.map((u) => text(u.email)).filter(Boolean);

    const sellers = rows(db, "SELECT id,email,display_name,auth_user_id FROM mk_sellers");
    const demoSellers = sellers.filter((s) => marked(s.email) || marked(s.display_name) || demoUserIds.includes(s.auth_user_id));
    const demoSellerIds = demoSellers.map((s) => s.id).filter(Boolean);

    const listings = rows(db, "SELECT id,seller_id,title FROM mk_listings");
    const demoListings = listings.filter((l) => demoSellerIds.includes(l.seller_id) || prefixed(l.id) || marked(l.title));
    const demoListingIds = demoListings.map((l) => l.id).filter(Boolean);

    if (demoListingIds.length) {
      const p = placeholders(demoListingIds.length);
      report.relatedRows += safeRun(db, `DELETE FROM mk_favorites WHERE listing_id IN (${p})`, demoListingIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_wishlist WHERE listing_id IN (${p})`, demoListingIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_price_alerts WHERE listing_id IN (${p})`, demoListingIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_cart_items WHERE listing_id IN (${p})`, demoListingIds);
      const orderIds = rows(db, `SELECT id FROM mk_orders WHERE listing_id IN (${p})`, demoListingIds).map((r) => r.id).filter(Boolean);
      deleteOrderDependencies(db, orderIds, report);
      report.relatedRows += safeRun(db, `DELETE FROM mk_orders WHERE listing_id IN (${p})`, demoListingIds);
      report.demoListings += safeRun(db, `DELETE FROM mk_listings WHERE id IN (${p})`, demoListingIds);
    }

    if (demoSellerIds.length) {
      const p = placeholders(demoSellerIds.length);
      const orderIds = rows(db, `SELECT id FROM mk_orders WHERE seller_id IN (${p})`, demoSellerIds).map((r) => r.id).filter(Boolean);
      deleteOrderDependencies(db, orderIds, report);
      report.relatedRows += safeRun(db, `DELETE FROM mk_reviews WHERE seller_id IN (${p})`, demoSellerIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_disputes WHERE seller_id IN (${p})`, demoSellerIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_orders WHERE seller_id IN (${p})`, demoSellerIds);
      report.demoSellers += safeRun(db, `DELETE FROM mk_sellers WHERE id IN (${p})`, demoSellerIds);
    }

    if (demoUserIds.length) {
      const p = placeholders(demoUserIds.length);
      report.relatedRows += safeRun(db, `DELETE FROM auth_sessions WHERE user_id IN (${p})`, demoUserIds);
      report.relatedRows += safeRun(db, `DELETE FROM auth_reset_tokens WHERE user_id IN (${p})`, demoUserIds);
      report.relatedRows += safeRun(db, `DELETE FROM auth_magic_tokens WHERE user_id IN (${p})`, demoUserIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_favorites WHERE user_id IN (${p})`, demoUserIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_wishlist WHERE user_id IN (${p})`, demoUserIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_price_alerts WHERE user_id IN (${p})`, demoUserIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_cart_items WHERE user_id IN (${p})`, demoUserIds);
      report.demoUsers += safeRun(db, `DELETE FROM auth_users WHERE id IN (${p})`, demoUserIds);
    }
    if (demoEmails.length) {
      const p = placeholders(demoEmails.length);
      const orderIds = rows(db, `SELECT id FROM mk_orders WHERE lower(buyer_email) IN (${p})`, demoEmails).map((r) => r.id).filter(Boolean);
      deleteOrderDependencies(db, orderIds, report);
      report.relatedRows += safeRun(db, `DELETE FROM mk_disputes WHERE lower(buyer_email) IN (${p})`, demoEmails);
      report.relatedRows += safeRun(db, `DELETE FROM mk_invoices WHERE lower(buyer_email) IN (${p})`, demoEmails);
      report.relatedRows += safeRun(db, `DELETE FROM mk_orders WHERE lower(buyer_email) IN (${p})`, demoEmails);
      report.relatedRows += safeRun(db, `DELETE FROM mk_reviews WHERE lower(buyer_email) IN (${p})`, demoEmails);
      report.relatedRows += safeRun(db, `DELETE FROM mk_price_alerts WHERE lower(user_email) IN (${p})`, demoEmails);
    }

    const demoCards = rows(db, "SELECT id,market_source FROM cards").filter((c) => prefixed(c.id) || MARKERS.includes(text(c.market_source)));
    const demoCardIds = demoCards.map((c) => c.id).filter(Boolean);
    if (demoCardIds.length) {
      const p = placeholders(demoCardIds.length);
      report.relatedRows += safeRun(db, `DELETE FROM price_sources WHERE card_id IN (${p})`, demoCardIds);
      report.relatedRows += safeRun(db, `DELETE FROM sales_history WHERE card_id IN (${p})`, demoCardIds);
      report.relatedRows += safeRun(db, `DELETE FROM card_price_history WHERE card_id IN (${p})`, demoCardIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_wishlist WHERE card_id IN (${p})`, demoCardIds);
      report.relatedRows += safeRun(db, `DELETE FROM mk_price_alerts WHERE card_id IN (${p})`, demoCardIds);
      report.demoCards += safeRun(db, `DELETE FROM cards WHERE id IN (${p})`, demoCardIds);
    }

    try { db.exec("DELETE FROM mk_listings_fts; INSERT INTO mk_listings_fts(rowid,title,description,license_slug,card_condition) SELECT rowid,title,description,license_slug,card_condition FROM mk_listings;"); } catch {}
    try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  });

  try { tx(); } finally { db.pragma("foreign_keys = ON"); }

  const purchases = readJson("purchases", []);
  if (Array.isArray(purchases) && purchases.length) {
    const kept = purchases.filter((p) => !marked(p.seller) && !marked(p.description) && !prefixed(p.id) && !prefixed(p.reference));
    report.demoPurchases = purchases.length - kept.length;
    if (report.demoPurchases) writeJson("purchases", kept);
  }

  console.log(`[production-cleanup] demo users=${report.demoUsers} sellers=${report.demoSellers} listings=${report.demoListings} cards=${report.demoCards} purchases=${report.demoPurchases} related=${report.relatedRows}`);
  return report;
}
