import { readJson } from "../storage.js";
import { listBoutiqueInventory } from "../boutique/stock.js";
import { getAllOrders } from "../marketplace/orders.js";
import { getAuditLogs } from "../audit.js";

const DEFAULT_ANALYTICS = { days: [] };

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDay(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function periodFilter(value, period = "month", now = new Date()) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return false;
  if (period === "day") return isoDay(date) === isoDay(now);
  if (period === "week") {
    const delta = now.getTime() - date.getTime();
    return delta >= 0 && delta <= 7 * 86400000;
  }
  if (period === "year") return date.getUTCFullYear() === now.getUTCFullYear();
  return date.getUTCMonth() === now.getUTCMonth() && date.getUTCFullYear() === now.getUTCFullYear();
}

function isBuybackProposal(purchase) {
  const id = String(purchase?.id || "");
  const status = String(purchase?.status || "").toLowerCase();
  return id.startsWith("buy_") || status.includes("proposition") || purchase?.source === "estimation" && !["paid", "pending", "cancelled", "refunded"].includes(status);
}

export function isPaidPurchase(purchase) {
  if (!purchase || isBuybackProposal(purchase)) return false;
  const status = String(purchase.status || "").toLowerCase();
  return status === "paid" || !status;
}

function isBoutiquePaid(order) {
  return String(order?.paymentStatus || "").toLowerCase() === "paid";
}

function isMarketplacePaid(order) {
  const paymentStatus = String(order?.paymentStatus || "").toLowerCase();
  const status = String(order?.status || "").toLowerCase();
  return paymentStatus === "paid" && !["cancelled", "refunded"].includes(status);
}

function addChartDay(map, date) {
  if (!date) return null;
  if (!map[date]) map[date] = { date, visitors: 0, revenue: 0, boutiqueRevenue: 0, marketplaceGmv: 0, marketplaceCommission: 0, purchases: 0 };
  return map[date];
}

function sum(list, getter) {
  return money((list || []).reduce((total, item) => total + Number(getter(item) || 0), 0));
}

function buildStockSummary() {
  const inventory = listBoutiqueInventory({ includeDisabled: true });
  const summary = {
    references: inventory.length,
    boutiqueReferences: inventory.filter((item) => item.boutiqueEnabled).length,
    baseUnits: 0,
    availableUnits: 0,
    reservedUnits: 0,
    pendingUnits: 0,
    soldUnits: 0,
    refundHoldUnits: 0,
    oversoldUnits: 0,
    oversoldReferences: 0,
    purchaseValueAvailable: 0,
    retailValueAvailable: 0
  };

  for (const item of inventory) {
    summary.baseUnits += Number(item.baseStock || 0);
    summary.availableUnits += Number(item.stock || 0);
    summary.reservedUnits += Number(item.reservedStock || 0);
    summary.pendingUnits += Number(item.pendingStock || 0);
    summary.soldUnits += Number(item.soldStock || 0);
    summary.refundHoldUnits += Number(item.refundHoldStock || 0);
    summary.oversoldUnits += Number(item.oversoldStock || 0);
    if (Number(item.oversoldStock || 0) > 0) summary.oversoldReferences += 1;
    summary.purchaseValueAvailable += Number(item.averagePurchaseCost || 0) * Number(item.stock || 0);
    summary.retailValueAvailable += Number(item.price || 0) * Number(item.stock || 0);
  }

  summary.purchaseValueAvailable = money(summary.purchaseValueAvailable);
  summary.retailValueAvailable = money(summary.retailValueAvailable);
  return summary;
}

function buildOperations(boutiqueOrders) {
  const orders = boutiqueOrders || [];
  return {
    toPrepare: orders.filter((order) => order.status === "À préparer" && order.paymentStatus === "paid").length,
    preparing: orders.filter((order) => order.status === "En préparation" && order.paymentStatus === "paid").length,
    shipped: orders.filter((order) => order.status === "Expédiée" && order.paymentStatus === "paid").length,
    refundReview: orders.filter((order) => order.paymentReviewRequired === true || order.status === "Annulée" && order.paymentStatus === "paid").length,
    paymentPending: orders.filter((order) => order.paymentStatus === "pending").length,
    paymentFailed: orders.filter((order) => order.paymentStatus === "failed").length
  };
}

export function buildAdminDashboard({ period = "month", estimations = [], users = [], witnot = null } = {}) {
  const safePeriod = ["day", "week", "month", "year"].includes(period) ? period : "month";
  const analytics = readJson("analytics", DEFAULT_ANALYTICS);
  const boutiqueOrders = readJson("orders", []);
  const marketplaceOrders = getAllOrders(5000);
  const purchases = readJson("purchases", []);

  const periodBoutique = boutiqueOrders.filter((order) => isBoutiquePaid(order) && periodFilter(order.createdAt || order.date, safePeriod));
  const periodMarketplace = marketplaceOrders.filter((order) => isMarketplacePaid(order) && periodFilter(order.createdAt, safePeriod));
  const periodPurchases = purchases.filter((purchase) => isPaidPurchase(purchase) && periodFilter(purchase.date || purchase.createdAt, safePeriod));
  const periodEstimations = (estimations || []).filter((item) => periodFilter(item.createdAt || item.date, safePeriod));
  const periodUsers = (users || []).filter((user) => user.role === "client" && periodFilter(user.createdAt, safePeriod));
  const periodAnalytics = (analytics.days || []).filter((day) => periodFilter(day.date, safePeriod));

  const boutiqueRevenue = sum(periodBoutique, (order) => order.total);
  const marketplaceGmv = sum(periodMarketplace, (order) => order.total);
  const marketplaceCommission = sum(periodMarketplace, (order) => order.platformFee);
  const cardoriaRevenue = money(boutiqueRevenue + marketplaceCommission);
  const purchaseSpend = sum(periodPurchases, (purchase) => purchase.amount);
  const cashContribution = money(cardoriaRevenue - purchaseSpend);
  const chartMap = Object.create(null);

  for (const day of periodAnalytics) {
    const row = addChartDay(chartMap, isoDay(day.date));
    if (row) row.visitors += Number(day.visitors || 0);
  }
  for (const order of periodBoutique) {
    const row = addChartDay(chartMap, isoDay(order.createdAt || order.date));
    if (row) row.boutiqueRevenue = money(row.boutiqueRevenue + Number(order.total || 0));
  }
  for (const order of periodMarketplace) {
    const row = addChartDay(chartMap, isoDay(order.createdAt));
    if (row) {
      row.marketplaceGmv = money(row.marketplaceGmv + Number(order.total || 0));
      row.marketplaceCommission = money(row.marketplaceCommission + Number(order.platformFee || 0));
    }
  }
  for (const purchase of periodPurchases) {
    const row = addChartDay(chartMap, isoDay(purchase.date || purchase.createdAt));
    if (row) row.purchases = money(row.purchases + Number(purchase.amount || 0));
  }
  Object.values(chartMap).forEach((row) => { row.revenue = money(row.boutiqueRevenue + row.marketplaceCommission); });

  const securityEvents = getAuditLogs({ period: safePeriod, type: "security", limit: 2000 });
  const deniedAuth = getAuditLogs({ period: safePeriod, type: "auth", q: "access_denied", limit: 2000 });
  const recentActivity = getAuditLogs({ limit: 8 });
  const stock = buildStockSummary();
  const operations = buildOperations(boutiqueOrders);

  const alerts = [];
  if (stock.oversoldReferences > 0) alerts.push({ level: "danger", code: "oversold", label: `${stock.oversoldReferences} référence(s) en survente`, href: "admin-stock.html" });
  if (operations.refundReview > 0) alerts.push({ level: "danger", code: "refund_review", label: `${operations.refundReview} remboursement(s) Boutique à contrôler`, href: "admin-commandes.html" });
  if (operations.toPrepare > 0) alerts.push({ level: "warn", code: "prepare", label: `${operations.toPrepare} commande(s) Boutique à préparer`, href: "admin-commandes.html" });
  if (securityEvents.length > 0 || deniedAuth.length > 0) alerts.push({ level: "warn", code: "security", label: `${securityEvents.length + deniedAuth.length} événement(s) sécurité/auth sur la période`, href: "admin-journal.html" });

  return {
    period: safePeriod,
    kpis: {
      revenue: cardoriaRevenue,
      boutiqueRevenue,
      marketplaceGmv,
      marketplaceCommission,
      sales: periodBoutique.length + periodMarketplace.length,
      boutiqueSales: periodBoutique.length,
      marketplaceSales: periodMarketplace.length,
      purchaseSpend,
      purchases: periodPurchases.length,
      cashContribution,
      estimations: periodEstimations.length,
      visitors: Math.round(periodAnalytics.reduce((total, day) => total + Number(day.visitors || 0), 0)),
      newUsers: periodUsers.length
    },
    stock,
    operations,
    alerts,
    witnot,
    recentActivity,
    chart: Object.values(chartMap).sort((a, b) => a.date.localeCompare(b.date)),
    sources: {
      revenue: "Boutique SumUp payée + commissions Marketplace enregistrées",
      marketplace: "Commandes Marketplace payées",
      purchases: "Achats Cardoria payés uniquement",
      stock: "Inventaire Boutique serveur unique",
      visitors: "Analytics site"
    }
  };
}
