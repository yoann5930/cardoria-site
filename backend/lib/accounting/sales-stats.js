import { getDb } from "../engine/database.js";
import { readJson } from "../storage.js";

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function dateOf(value) {
  return String(value || "").slice(0, 10);
}

export function buildAccountingSales({ boutiqueOrders = [], marketplaceOrders = [] } = {}) {
  const sales = [];
  const unresolvedMarketplace = [];

  for (const order of Array.isArray(boutiqueOrders) ? boutiqueOrders : []) {
    if (String(order.paymentStatus || "") !== "paid") continue;
    const total = money(order.total);
    if (total <= 0) continue;
    sales.push({
      id: order.id || "",
      date: dateOf(order.date || order.createdAt || order.updatedAt),
      client: order.client || order.email || "",
      source: "boutique",
      channel: "Boutique Cardoria",
      license: "boutique",
      seller: "Cardoria",
      amount: total,
      grossAmount: total,
      revenueType: "sale",
      paymentStatus: "paid"
    });
  }

  for (const order of Array.isArray(marketplaceOrders) ? marketplaceOrders : []) {
    if (String(order.payment_status || order.paymentStatus || "") !== "paid") continue;
    const gross = money(order.total);
    const fee = money(order.platform_fee ?? order.platformFee);
    const base = {
      id: order.id || "",
      date: dateOf(order.updated_at || order.updatedAt || order.created_at || order.createdAt),
      client: order.buyer_name || order.buyerName || order.buyer_email || order.buyerEmail || "",
      source: "marketplace",
      channel: "Commission Marketplace",
      license: order.license_slug || order.license || "marketplace",
      seller: order.seller_id || order.sellerId || "",
      grossAmount: gross,
      paymentStatus: "paid"
    };
    if (fee > 0) {
      sales.push({ ...base, amount: fee, revenueType: "platform_fee" });
    } else {
      unresolvedMarketplace.push({ ...base, amount: 0, reason: "commission_absente" });
    }
  }

  sales.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  return {
    sales,
    unresolvedMarketplace,
    totalRevenue: money(sales.reduce((sum, sale) => sum + money(sale.amount), 0)),
    boutiqueRevenue: money(sales.filter((sale) => sale.source === "boutique").reduce((sum, sale) => sum + money(sale.amount), 0)),
    marketplaceRevenue: money(sales.filter((sale) => sale.source === "marketplace").reduce((sum, sale) => sum + money(sale.amount), 0))
  };
}

export function getAccountingSales() {
  const db = getDb();
  const boutiqueOrders = readJson("orders", []);
  let marketplaceOrders = [];
  try {
    marketplaceOrders = db.prepare(`
      SELECT o.*, l.license_slug
      FROM mk_orders o
      LEFT JOIN mk_listings l ON l.id = o.listing_id
      ORDER BY o.updated_at DESC
      LIMIT 10000
    `).all();
  } catch {
    marketplaceOrders = [];
  }
  return buildAccountingSales({ boutiqueOrders, marketplaceOrders });
}
