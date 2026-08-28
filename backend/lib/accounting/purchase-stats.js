function amount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function isPaidPurchase(purchase = {}) {
  return String(purchase.status || "paid") === "paid";
}

export function buildPurchaseAccountingStats(purchases = [], {
  normalizeBuyer = (value) => String(value || "non_attribue"),
  normalizeType = (value) => String(value || "legacy")
} = {}) {
  const paid = (Array.isArray(purchases) ? purchases : []).filter(isPaidPurchase);
  const byLicense = {};
  const bySeller = {};
  const byCategory = {};
  const byBuyer = { yoann: 0, valentin: 0, non_attribue: 0 };
  const byType = {};

  for (const purchase of paid) {
    const license = purchase.license || "sans licence";
    const seller = purchase.seller || "inconnu";
    const category = purchase.category || "autre";
    const buyer = normalizeBuyer(purchase.buyer);
    const type = normalizeType(purchase.purchaseType);
    const value = amount(purchase.amount);

    byLicense[license] = (byLicense[license] || 0) + value;
    bySeller[seller] = (bySeller[seller] || 0) + value;
    byCategory[category] = (byCategory[category] || 0) + value;
    byBuyer[buyer] = (byBuyer[buyer] || 0) + value;
    byType[type] = (byType[type] || 0) + value;
  }

  return {
    paidPurchases: paid,
    byLicense,
    bySeller,
    byCategory,
    byBuyer,
    byType,
    total: paid.reduce((sum, purchase) => sum + amount(purchase.amount), 0),
    count: paid.length
  };
}
