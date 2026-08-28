import { readJson } from "../storage.js";
import { listBoutiqueInventory } from "../boutique/stock.js";
import { getAllOrders } from "../marketplace/orders.js";

const PERIODS = new Set(["day", "week", "month", "year", "all"]);
const PURCHASE_STATUSES = new Set(["paid", "pending", "cancelled", "refunded"]);

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function safePeriod(value) {
  const period = String(value || "month").toLowerCase();
  return PERIODS.has(period) ? period : "month";
}

function dateValue(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

export function financePeriodFilter(value, period = "month", now = new Date()) {
  const selected = safePeriod(period);
  if (selected === "all") return true;
  const date = dateValue(value);
  if (!date) return false;
  if (selected === "day") return date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (selected === "week") {
    const delta = now.getTime() - date.getTime();
    return delta >= 0 && delta <= 7 * 86400000;
  }
  if (selected === "year") return date.getUTCFullYear() === now.getUTCFullYear();
  return date.getUTCMonth() === now.getUTCMonth() && date.getUTCFullYear() === now.getUTCFullYear();
}

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalizedBuyer(value) {
  const buyer = clean(value, 40).toLowerCase();
  if (buyer === "yoann" || buyer === "valentin") return buyer;
  return "non_attribue";
}

function normalizedPurchaseType(value) {
  const type = clean(value, 40);
  if (["pokemon_card", "consumable", "equipment"].includes(type)) return type;
  return "legacy";
}

function purchaseUnitPrice(purchase = {}) {
  const type = normalizedPurchaseType(purchase.purchaseType);
  const packaging = clean(purchase.packaging, 80);
  const amount = Number(purchase.amount || 0);
  const quantity = Math.max(1, Number(purchase.quantity || 1));
  if (type !== "pokemon_card" || !["carte_unite", "lot_cartes"].includes(packaging) || !Number.isFinite(amount) || amount < 0) return null;
  return Math.round((amount / quantity) * 10000) / 10000;
}

export function isBuybackProposal(purchase) {
  if (!purchase) return false;
  const id = String(purchase.id || "").toLowerCase();
  const status = String(purchase.status || "").toLowerCase();
  const source = String(purchase.source || "").toLowerCase();
  return id.startsWith("buy_") || status.includes("proposition") || (source === "estimation" && !PURCHASE_STATUSES.has(status));
}

export function purchaseAccountingStatus(purchase) {
  const status = String(purchase?.status || "").toLowerCase();
  if (PURCHASE_STATUSES.has(status)) return status;
  return status ? "other" : "paid";
}

function boutiqueOrders() {
  return readJson("orders", []);
}

function marketplaceOrders() {
  try { return getAllOrders(5000); } catch { return []; }
}

function purchases() {
  return readJson("purchases", []).filter((purchase) => !isBuybackProposal(purchase));
}

function matchesQuery(record, query) {
  const q = clean(query, 200).toLowerCase();
  return !q || JSON.stringify(record).toLowerCase().includes(q);
}

function boutiqueSaleRecord(order) {
  const status = String(order.paymentStatus || "pending").toLowerCase();
  return {
    id: String(order.id || ""),
    date: order.createdAt || order.date || "",
    updatedAt: order.updatedAt || order.createdAt || order.date || "",
    source: "boutique",
    sourceLabel: "Boutique",
    provider: "sumup",
    client: order.client || order.customerName || "",
    email: order.email || order.customerEmail || "",
    grossAmount: money(order.total),
    cardoriaRevenue: status === "paid" ? money(order.total) : 0,
    platformFee: 0,
    sellerNet: 0,
    status,
    orderStatus: order.status || "",
    paymentReference: order.sumupCheckoutId || "",
    transactionReference: order.sumupTransactionId || ""
  };
}

function marketplaceSaleRecord(order) {
  const status = String(order.paymentStatus || (order.status === "paid" ? "paid" : "pending")).toLowerCase();
  const platformFee = money(order.platformFee || 0);
  return {
    id: String(order.id || ""),
    date: order.createdAt || "",
    updatedAt: order.updatedAt || order.createdAt || "",
    source: "marketplace",
    sourceLabel: "Marketplace",
    provider: order.paymentProvider || order.paymentMethod || "paypal",
    client: order.buyerName || "",
    email: order.buyerEmail || "",
    grossAmount: money(order.total),
    cardoriaRevenue: status === "paid" ? platformFee : 0,
    platformFee,
    sellerNet: money(order.sellerAmountAfterPlatformFee || Math.max(0, Number(order.total || 0) - platformFee)),
    status,
    orderStatus: order.status || "",
    paymentReference: order.paypalOrderId || order.paymentReference || order.sumupCheckoutId || "",
    transactionReference: order.paypalCaptureId || order.sumupTransactionId || ""
  };
}

export function listFinanceSales(filters = {}) {
  const period = safePeriod(filters.period);
  const source = clean(filters.source, 40).toLowerCase();
  const status = clean(filters.status, 40).toLowerCase();
  const rows = [
    ...boutiqueOrders().map(boutiqueSaleRecord),
    ...marketplaceOrders().map(marketplaceSaleRecord)
  ].filter((row) => financePeriodFilter(row.date, period));

  return rows
    .filter((row) => !source || source === "all" || row.source === source)
    .filter((row) => !status || status === "all" || row.status === status)
    .filter((row) => matchesQuery(row, filters.q))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export function listFinancePurchases(filters = {}) {
  const period = safePeriod(filters.period);
  const status = clean(filters.status, 40).toLowerCase();
  const buyer = clean(filters.buyer, 40).toLowerCase();
  const category = clean(filters.category, 80).toLowerCase();

  return purchases()
    .map((purchase) => ({
      ...purchase,
      buyer: normalizedBuyer(purchase.buyer),
      purchaseType: normalizedPurchaseType(purchase.purchaseType),
      accountingStatus: purchaseAccountingStatus(purchase),
      unitPrice: purchaseUnitPrice(purchase)
    }))
    .filter((purchase) => financePeriodFilter(purchase.date || purchase.createdAt, period))
    .filter((purchase) => !status || status === "all" || purchase.accountingStatus === status)
    .filter((purchase) => !buyer || buyer === "all" || purchase.buyer === buyer)
    .filter((purchase) => !category || category === "all" || String(purchase.category || "").toLowerCase() === category)
    .filter((purchase) => matchesQuery(purchase, filters.q))
    .sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")));
}

function sum(list, getter) {
  return money((list || []).reduce((total, item) => total + Number(getter(item) || 0), 0));
}

function stockCostMap() {
  const inventory = listBoutiqueInventory({ includeDisabled: true });
  return {
    inventory,
    costs: new Map(inventory.map((item) => [String(item.id || item.key), Number(item.averagePurchaseCost || 0)]))
  };
}

function boutiqueCogsForSales(sales, costs) {
  const orders = new Map(boutiqueOrders().map((order) => [String(order.id), order]));
  let total = 0;
  for (const sale of sales.filter((row) => row.source === "boutique" && row.status === "paid")) {
    const order = orders.get(String(sale.id));
    for (const item of order?.items || []) {
      const ref = String(item.ref || item.id || "");
      total += Number(costs.get(ref) || 0) * Math.max(1, Number(item.qty) || 1);
    }
  }
  return money(total);
}

export function getFinanceSummary({ period = "month" } = {}) {
  const selected = safePeriod(period);
  const sales = listFinanceSales({ period: selected });
  const purchaseRows = listFinancePurchases({ period: selected });
  const paidSales = sales.filter((sale) => sale.status === "paid");
  const refundedSales = sales.filter((sale) => sale.status === "refunded");
  const paidPurchases = purchaseRows.filter((purchase) => purchase.accountingStatus === "paid");
  const pendingPurchases = purchaseRows.filter((purchase) => purchase.accountingStatus === "pending");
  const refundedPurchases = purchaseRows.filter((purchase) => purchase.accountingStatus === "refunded");
  const cancelledPurchases = purchaseRows.filter((purchase) => purchase.accountingStatus === "cancelled");
  const boutiquePaid = paidSales.filter((sale) => sale.source === "boutique");
  const marketplacePaid = paidSales.filter((sale) => sale.source === "marketplace");
  const { inventory, costs } = stockCostMap();

  const boutiqueRevenue = sum(boutiquePaid, (sale) => sale.grossAmount);
  const marketplaceGmv = sum(marketplacePaid, (sale) => sale.grossAmount);
  const marketplaceCommission = sum(marketplacePaid, (sale) => sale.platformFee);
  const cardoriaRevenue = money(boutiqueRevenue + marketplaceCommission);
  const paidPurchaseSpend = sum(paidPurchases, (purchase) => purchase.amount);
  const boutiqueCogs = boutiqueCogsForSales(boutiquePaid, costs);
  const commercialMargin = money(cardoriaRevenue - boutiqueCogs);
  const cashCommercialBalance = money(cardoriaRevenue - paidPurchaseSpend);
  const refundAmount = sum(refundedSales, (sale) => sale.source === "boutique" ? sale.grossAmount : sale.platformFee);
  const stockPurchaseValue = sum(inventory, (item) => Number(item.averagePurchaseCost || 0) * Number(item.stock || 0));
  const stockRetailValue = sum(inventory, (item) => Number(item.price || 0) * Number(item.stock || 0));

  const bySource = {
    boutique: { sales: boutiquePaid.length, gross: boutiqueRevenue, revenue: boutiqueRevenue },
    marketplace: { sales: marketplacePaid.length, gross: marketplaceGmv, revenue: marketplaceCommission }
  };
  const byBuyer = { yoann: 0, valentin: 0, non_attribue: 0 };
  const byPurchaseCategory = {};
  for (const purchase of paidPurchases) {
    byBuyer[purchase.buyer] = money((byBuyer[purchase.buyer] || 0) + Number(purchase.amount || 0));
    const category = purchase.category || "autre";
    byPurchaseCategory[category] = money((byPurchaseCategory[category] || 0) + Number(purchase.amount || 0));
  }

  return {
    period: selected,
    cardoriaRevenue,
    boutiqueRevenue,
    boutiqueSales: boutiquePaid.length,
    marketplaceGmv,
    marketplaceCommission,
    marketplaceSales: marketplacePaid.length,
    paidPurchaseSpend,
    paidPurchaseCount: paidPurchases.length,
    pendingPurchaseSpend: sum(pendingPurchases, (purchase) => purchase.amount),
    pendingPurchaseCount: pendingPurchases.length,
    refundedPurchaseSpend: sum(refundedPurchases, (purchase) => purchase.amount),
    cancelledPurchaseSpend: sum(cancelledPurchases, (purchase) => purchase.amount),
    refundAmount,
    refundedSales: refundedSales.length,
    boutiqueCogs,
    commercialMargin,
    cashCommercialBalance,
    stockPurchaseValue,
    stockRetailValue,
    stockAvailableUnits: inventory.reduce((total, item) => total + Number(item.stock || 0), 0),
    bySource,
    byBuyer,
    byPurchaseCategory,
    notes: {
      cardoriaRevenue: "CA Boutique payé + commissions Marketplace payées",
      marketplaceGmv: "Volume Marketplace encaissé pour les vendeurs, hors CA Cardoria",
      commercialMargin: "Revenus Cardoria - coût moyen des articles Boutique vendus, avant frais PSP/charges",
      cashCommercialBalance: "Revenus Cardoria - achats Cardoria payés sur la période ; indicateur de trésorerie, pas résultat fiscal"
    }
  };
}

export function financeCsv(type, filters = {}) {
  const rows = type === "purchases" ? listFinancePurchases(filters) : type === "summary" ? [getFinanceSummary(filters)] : listFinanceSales(filters);
  const flatRows = rows.map((row) => {
    if (type === "summary") return {
      periode: row.period,
      ca_cardoria: row.cardoriaRevenue,
      ca_boutique: row.boutiqueRevenue,
      ventes_boutique: row.boutiqueSales,
      gmv_marketplace: row.marketplaceGmv,
      commission_marketplace: row.marketplaceCommission,
      ventes_marketplace: row.marketplaceSales,
      achats_payes: row.paidPurchaseSpend,
      nombre_achats_payes: row.paidPurchaseCount,
      cout_articles_boutique_vendus: row.boutiqueCogs,
      marge_commerciale: row.commercialMargin,
      solde_tresorerie_commercial: row.cashCommercialBalance,
      remboursements: row.refundAmount,
      valeur_achat_stock_disponible: row.stockPurchaseValue,
      valeur_vente_stock_disponible: row.stockRetailValue
    };
    if (type === "purchases") return {
      id: row.id,
      date: row.date || row.createdAt || "",
      acheteur: row.buyer,
      type: row.purchaseType,
      categorie: row.category || "",
      vendeur: row.seller || "",
      description: row.description || "",
      quantite: row.quantity || 1,
      montant: money(row.amount),
      prix_unitaire: row.unitPrice == null ? "" : row.unitPrice,
      statut: row.accountingStatus,
      reference: row.reference || ""
    };
    return {
      id: row.id,
      date: row.date,
      source: row.sourceLabel,
      prestataire: row.provider,
      client: row.client,
      email: row.email,
      montant_brut: row.grossAmount,
      revenu_cardoria: row.cardoriaRevenue,
      commission_marketplace: row.platformFee,
      net_vendeur: row.sellerNet,
      statut_paiement: row.status,
      statut_commande: row.orderStatus,
      reference_paiement: row.paymentReference,
      reference_transaction: row.transactionReference
    };
  });
  const headers = Object.keys(flatRows[0] || { id: "", date: "", montant: "" });
  const esc = (value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
  return [headers.join(";"), ...flatRows.map((row) => headers.map((header) => esc(row[header])).join(";"))].join("\n");
}
