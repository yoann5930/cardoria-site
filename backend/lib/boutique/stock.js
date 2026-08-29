import { readJson } from "../storage.js";
import { getCardById } from "../engine/cards.js";

const DEFAULT_PURCHASES = [];
const DEFAULT_ORDERS = [];
export const PENDING_RESERVATION_MS = 30 * 60 * 1000;
export const STOCK_PREFS_TAG = "[STOCK_PREFS]";

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeCondition(value) {
  const raw = String(value || "").trim();
  if (!raw || /non renseign/i.test(raw)) return "";
  const upper = raw.toUpperCase();
  if (["M", "NM", "EX", "GD", "LP", "PL", "PO"].includes(upper)) return upper;
  const lower = raw.toLowerCase();
  if (lower === "mint") return "M";
  if (lower === "near mint") return "NM";
  if (lower === "excellent") return "EX";
  if (lower === "good" || lower === "bon") return "GD";
  if (lower === "light played" || lower === "lightly played") return "LP";
  if (lower === "played" || lower === "joué" || lower === "joue") return "PL";
  if (lower === "poor" || lower === "mauvais") return "PO";
  return "";
}

function conditionLabel(value, packaging) {
  if (packaging !== "carte_unite" && packaging !== "lot_cartes") return "Scellé";
  const labels = {
    M: "Mint",
    NM: "Near Mint (NM)",
    EX: "Excellent (EX)",
    GD: "Good (GD)",
    LP: "Light Played (LP)",
    PL: "Played (PL)",
    PO: "Poor (PO)"
  };
  return labels[normalizeCondition(value)] || "Non renseigné";
}

function parseStockPrefs(notes) {
  const match = String(notes || "").match(/\[STOCK_PREFS\]\s*(\{[^\n\r]*\})/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readLinePreference(purchase, key) {
  const prefs = parseStockPrefs(purchase?.notes);
  const pref = prefs[key];
  if (!pref || typeof pref !== "object" || Array.isArray(pref)) {
    return { condition: "", boutiqueEnabled: true, boutiquePrice: null, stockBase: null, removed: false, explicit: false };
  }
  const rawPrice = Number(pref.boutiquePrice);
  const rawStockBase = Number(pref.stockBase);
  return {
    condition: normalizeCondition(pref.condition),
    boutiqueEnabled: pref.boutique === undefined ? true : pref.boutique === true,
    boutiquePrice: Number.isFinite(rawPrice) && rawPrice > 0 ? money(rawPrice) : null,
    stockBase: pref.stockBase === null || pref.stockBase === undefined || pref.stockBase === "" || !Number.isFinite(rawStockBase)
      ? null
      : Math.max(0, Math.trunc(rawStockBase)),
    removed: pref.removed === true,
    explicit: true
  };
}

function catalogCardId(reference) {
  const value = String(reference || "").trim();
  const prefix = "catalog-card:";
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

function parseJsonTag(notes, tag) {
  const escaped = String(tag || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(notes || "").match(new RegExp("\\[" + escaped + "\\]\\s*(\\[[^\\n\\r]*\\]|\\{[^\\n\\r]*\\})"));
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function lotCardIds(purchase) {
  if (Array.isArray(purchase?.lotCards) && purchase.lotCards.length) return purchase.lotCards.filter(Boolean);
  const parsed = parseJsonTag(purchase?.notes, "LOT_CARDS");
  return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
}

function lotCardSnapshots(purchase) {
  const parsed = parseJsonTag(purchase?.notes, "LOT_CARD_SNAPSHOTS");
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => item && typeof item === "object" ? {
    id: String(item.id || "").trim(),
    name: String(item.name || "").trim(),
    extension: String(item.extension || "").trim(),
    number: String(item.number || "").trim(),
    rarity: String(item.rarity || item.hitFamily || "").trim(),
    image: String(item.imageThumb || item.imageHd || item.image || "").trim()
  } : null).filter(Boolean);
}

function singleCardSnapshot(purchase) {
  const parsed = parseJsonTag(purchase?.notes, "CARD_SNAPSHOT");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return {
    id: String(parsed.id || "").trim(),
    name: String(parsed.name || "").trim(),
    extension: String(parsed.extension || "").trim(),
    number: String(parsed.number || "").trim(),
    rarity: String(parsed.rarity || parsed.hitFamily || "").trim(),
    image: String(parsed.imageThumb || parsed.imageHd || parsed.image || "").trim()
  };
}

function isStockPurchase(purchase) {
  if (String(purchase?.status || "paid") !== "paid") return false;
  if (purchase?.purchaseType === "pokemon_card") return true;
  return String(purchase?.license || "").toLowerCase() === "pokemon" &&
    ["cartes", "lots", "boosters"].includes(String(purchase?.category || "").toLowerCase());
}

function isCardPackaging(packaging) {
  return packaging === "carte_unite" || packaging === "lot_cartes";
}

function getCardCached(cache, id) {
  if (!id) return null;
  if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id];
  try {
    cache[id] = getCardById(id) || null;
  } catch {
    cache[id] = null;
  }
  return cache[id];
}

function recommendedPrice(card) {
  const value = Number(card?.prices?.recommended ?? card?.prices?.avg ?? 0);
  return Number.isFinite(value) && value > 0 ? money(value) : 0;
}

function addPurchaseId(line, purchaseId) {
  const id = String(purchaseId || "").trim();
  if (id && !line.purchaseIds.includes(id)) line.purchaseIds.push(id);
}

function addLine(map, item) {
  const qty = Math.max(1, Math.trunc(Number(item.stock) || 1));
  const unitCost = Math.max(0, Number(item.unitCost) || 0);
  const pref = item.preference || { condition: "", boutiqueEnabled: true, boutiquePrice: null, stockBase: null, removed: false, explicit: false };
  if (!map[item.key]) {
    map[item.key] = {
      key: item.key,
      cardId: item.cardId || "",
      name: item.name || "Produit Pokémon",
      extension: item.extension || "",
      number: item.number || "",
      rarity: item.rarity || "",
      categoryLabel: item.categoryLabel || "Pokémon",
      packaging: item.packaging || "carte_unite",
      condition: pref.condition || normalizeCondition(item.condition),
      boutiqueEnabled: pref.boutiqueEnabled !== false,
      boutiquePrice: pref.boutiquePrice,
      stockBaseOverride: pref.stockBase,
      stockRemoved: pref.removed === true,
      preferenceApplied: pref.explicit === true,
      catalogPrice: recommendedPrice(item.card),
      image: item.card?.imageThumb || item.card?.imageHd || item.image || "",
      baseStock: qty,
      totalCost: unitCost * qty,
      latestPurchaseAt: item.latestPurchaseAt || "",
      purchaseIds: []
    };
    addPurchaseId(map[item.key], item.purchaseId);
    return;
  }

  const current = map[item.key];
  current.baseStock += qty;
  current.totalCost += unitCost * qty;
  addPurchaseId(current, item.purchaseId);
  if (String(item.latestPurchaseAt || "") > String(current.latestPurchaseAt || "")) current.latestPurchaseAt = item.latestPurchaseAt;
  if (!current.preferenceApplied && pref.explicit) {
    current.condition = pref.condition || current.condition;
    current.boutiqueEnabled = pref.boutiqueEnabled !== false;
    current.boutiquePrice = pref.boutiquePrice;
    current.preferenceApplied = true;
  }
  if (pref.explicit && pref.stockBase !== null && pref.stockBase !== undefined) current.stockBaseOverride = pref.stockBase;
  if (pref.explicit) current.stockRemoved = pref.removed === true;
  if (!current.image) current.image = item.card?.imageThumb || item.card?.imageHd || item.image || "";
  if (!current.catalogPrice && item.card) current.catalogPrice = recommendedPrice(item.card);
}

function buildBaseStock() {
  const purchases = readJson("purchases", DEFAULT_PURCHASES).filter(isStockPurchase);
  const map = Object.create(null);
  const cardCache = Object.create(null);

  for (const purchase of purchases) {
    const qty = Math.max(1, Math.trunc(Number(purchase.quantity) || 1));
    const amount = Math.max(0, Number(purchase.amount) || 0);
    const unitCost = qty ? amount / qty : amount;
    const packaging = String(purchase.packaging || "carte_unite");
    const purchaseDate = purchase.date || purchase.createdAt || "";

    if (packaging === "lot_cartes") {
      const ids = lotCardIds(purchase);
      const snapshots = lotCardSnapshots(purchase);
      if (ids.length || snapshots.length) {
        for (let index = 0; index < qty; index += 1) {
          const snapshot = snapshots[index] || {};
          const cardId = String(ids[index] || snapshot.id || "").trim();
          const card = getCardCached(cardCache, cardId);
          const key = cardId ? `card:${cardId}` : `purchase:${purchase.id}:${index}`;
          addLine(map, {
            key,
            cardId,
            card,
            image: snapshot.image,
            name: card?.name || snapshot.name || "Carte Pokémon",
            extension: card?.extension || snapshot.extension || "",
            number: card?.number || snapshot.number || "",
            rarity: card?.hitFamily || card?.rarity || snapshot.rarity || "",
            categoryLabel: card?.hitFamily || card?.rarity || snapshot.rarity || "Carte Pokémon",
            packaging,
            condition: purchase.condition || purchase.cardCondition || "",
            preference: readLinePreference(purchase, key),
            unitCost,
            stock: 1,
            latestPurchaseAt: purchaseDate,
            purchaseId: purchase.id
          });
        }
      } else {
        const key = `purchase:${purchase.id}:lot`;
        addLine(map, {
          key,
          name: "Lot de cartes non relié au catalogue",
          categoryLabel: "Lot de cartes",
          packaging,
          condition: purchase.condition || purchase.cardCondition || "",
          preference: readLinePreference(purchase, key),
          unitCost,
          stock: qty,
          latestPurchaseAt: purchaseDate,
          purchaseId: purchase.id
        });
      }
      continue;
    }

    if (packaging === "carte_unite" || !purchase.packaging) {
      const snapshot = singleCardSnapshot(purchase) || {};
      const cardId = catalogCardId(purchase.reference) || snapshot.id || "";
      const card = getCardCached(cardCache, cardId);
      const key = cardId ? `card:${cardId}` : `purchase:${purchase.id}`;
      addLine(map, {
        key,
        cardId,
        card,
        image: snapshot.image,
        name: card?.name || snapshot.name || "Carte Pokémon non reliée au catalogue",
        extension: card?.extension || snapshot.extension || "",
        number: card?.number || snapshot.number || "",
        rarity: card?.hitFamily || card?.rarity || snapshot.rarity || "",
        categoryLabel: card?.hitFamily || card?.rarity || snapshot.rarity || "Carte Pokémon",
        packaging,
        condition: purchase.condition || purchase.cardCondition || "",
        preference: readLinePreference(purchase, key),
        unitCost,
        stock: qty,
        latestPurchaseAt: purchaseDate,
        purchaseId: purchase.id
      });
      continue;
    }

    const key = `purchase:${purchase.id}:sealed`;
    addLine(map, {
      key,
      name: purchase.description || "Produit Pokémon scellé",
      categoryLabel: "Produit scellé",
      packaging,
      preference: readLinePreference(purchase, key),
      unitCost,
      stock: qty,
      latestPurchaseAt: purchaseDate,
      purchaseId: purchase.id
    });
  }

  return Object.values(map);
}

function orderItemQty(order, productId) {
  return (order?.items || [])
    .filter((item) => String(item.ref || item.id) === String(productId))
    .reduce((subtotal, item) => subtotal + Math.max(1, Math.trunc(Number(item.qty) || 1)), 0);
}

function allocationStats(productId, orders) {
  const now = Date.now();
  const stats = { pendingStock: 0, soldStock: 0, refundHoldStock: 0 };

  for (const order of orders || []) {
    const qty = orderItemQty(order, productId);
    if (!qty) continue;

    const paymentStatus = String(order?.paymentStatus || "").toLowerCase();
    const orderStatus = String(order?.status || "");
    if (["failed", "refunded", "cancelled", "canceled"].includes(paymentStatus)) continue;

    if (orderStatus === "Annulée") {
      if (paymentStatus === "paid") stats.refundHoldStock += qty;
      continue;
    }

    const legacyPaidStatus = ["À préparer", "En préparation", "Expédiée", "Livrée"].includes(orderStatus);
    if (paymentStatus === "paid" || legacyPaidStatus) {
      stats.soldStock += qty;
      continue;
    }

    const createdAt = Date.parse(order?.createdAt || "");
    const pendingFresh = paymentStatus === "pending" && (!Number.isFinite(createdAt) || now - createdAt < PENDING_RESERVATION_MS);
    if (pendingFresh) stats.pendingStock += qty;
  }

  return stats;
}

function buildInventoryLine(line, orders, includeAdminDetails) {
  const allocation = allocationStats(line.key, orders);
  const committedStock = allocation.pendingStock + allocation.soldStock + allocation.refundHoldStock;
  const configuredBaseStock = line.stockBaseOverride === null || line.stockBaseOverride === undefined
    ? line.baseStock
    : Math.max(0, Math.trunc(Number(line.stockBaseOverride) || 0));
  const effectiveBaseStock = line.stockRemoved ? committedStock : configuredBaseStock;
  const stock = Math.max(0, effectiveBaseStock - committedStock);
  const oversoldStock = Math.max(0, committedStock - effectiveBaseStock);
  const price = line.boutiquePrice || line.catalogPrice || 0;
  const priceSource = line.boutiquePrice ? "admin" : (line.catalogPrice ? "cardoria_market" : "missing");
  const boutiqueEnabled = line.stockRemoved ? false : line.boutiqueEnabled !== false;
  const catalogLinked = !isCardPackaging(line.packaging) || Boolean(line.cardId);
  const identityReady = !isCardPackaging(line.packaging) || (Boolean(line.cardId) && Boolean(line.name) && Boolean(line.image));
  const publicProduct = {
    id: line.key,
    cardId: line.cardId,
    category: "pokemon",
    name: line.name,
    extension: line.extension,
    number: line.number,
    rarity: line.rarity,
    categoryLabel: line.categoryLabel,
    packaging: line.packaging,
    condition: conditionLabel(line.condition, line.packaging),
    conditionCode: normalizeCondition(line.condition),
    stock,
    price: money(price),
    priceSource,
    image: line.image,
    boutiqueEnabled,
    stockRemoved: line.stockRemoved === true,
    catalogLinked,
    identityReady,
    purchasable: boutiqueEnabled && identityReady && stock > 0 && price > 0 && oversoldStock === 0
  };

  if (!includeAdminDetails) return publicProduct;
  return {
    ...publicProduct,
    key: line.key,
    baseStock: line.baseStock,
    effectiveBaseStock,
    stockBaseOverride: line.stockBaseOverride,
    pendingStock: allocation.pendingStock,
    soldStock: allocation.soldStock,
    refundHoldStock: allocation.refundHoldStock,
    reservedStock: allocation.pendingStock + allocation.refundHoldStock,
    committedStock,
    oversoldStock,
    averagePurchaseCost: line.baseStock ? money(line.totalCost / line.baseStock) : 0,
    totalPurchaseCost: money(line.totalCost),
    purchaseIds: line.purchaseIds.slice(),
    catalogPrice: line.catalogPrice,
    boutiquePrice: line.boutiquePrice,
    latestPurchaseAt: line.latestPurchaseAt,
    inventoryStatus: line.stockRemoved ? "removed" : !identityReady ? "catalog_link_required" : oversoldStock > 0 ? "oversold" : stock <= 0 ? "out_of_stock" : allocation.pendingStock > 0 ? "reserved" : "available"
  };
}

export function listBoutiqueProducts({ includeDisabled = false } = {}) {
  const orders = readJson("orders", DEFAULT_ORDERS);
  return buildBaseStock()
    .map((line) => buildInventoryLine(line, orders, false))
    .filter((product) => !product.stockRemoved)
    .filter((product) => !isCardPackaging(product.packaging) || product.identityReady)
    .filter((product) => includeDisabled || product.boutiqueEnabled)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

export function listBoutiqueInventory({ includeDisabled = true } = {}) {
  const orders = readJson("orders", DEFAULT_ORDERS);
  return buildBaseStock()
    .map((line) => buildInventoryLine(line, orders, true))
    .filter((product) => includeDisabled || product.boutiqueEnabled)
    .sort((a, b) => String(b.latestPurchaseAt || "").localeCompare(String(a.latestPurchaseAt || "")) || String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

export function getBoutiqueProduct(productId) {
  return listBoutiqueProducts({ includeDisabled: false }).find((product) => String(product.id) === String(productId)) || null;
}
