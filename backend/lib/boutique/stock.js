import { readJson } from "../storage.js";
import { getCardById } from "../engine/cards.js";
import { floorCardPrice } from "../pricing/card-price-floor.js";

const DEFAULT_PURCHASES = [];
const DEFAULT_ORDERS = [];
export const PENDING_RESERVATION_MS = 30 * 60 * 1000;
export const LOW_STOCK_THRESHOLD = 2;
export const MAX_STOCK_BASE = 100000;
export const STOCK_PREFS_TAG = "[STOCK_PREFS]";
const STOCK_PREFS_LINE = /\[STOCK_PREFS\]\s*(\{[^\n\r]*\})/;
const STOCK_PREF_KEY = /^[\w.:-]{1,240}$/;

export function boutiqueStockImpact(order) {
  const payment = String(order?.paymentStatus || "").toLowerCase();
  const status = String(order?.status || "");
  if (payment === "refunded" || status === "Remboursée") return { code: "released", label: "Stock remis (remboursé)" };
  if (["failed", "cancelled", "canceled"].includes(payment) || status === "Paiement échoué") {
    return { code: "released", label: "Non décrémenté" };
  }
  if (status === "Annulée" && payment === "paid") return { code: "hold", label: "Stock bloqué — remboursement en attente" };
  if (status === "Annulée") return { code: "released", label: "Non décrémenté (annulée)" };
  if (payment === "paid") return { code: "decremented", label: "Décrémenté" };
  if (payment === "pending" || status === "En attente SumUp") {
    return { code: "reserved", label: "Réservé (paiement en attente, 30 min)" };
  }
  return { code: "none", label: "Non décrémenté" };
}

export function boutiqueAvailability(item) {
  const stock = Math.max(0, Number(item?.stock || 0));
  const oversold = Number(item?.oversoldStock || 0) > 0;
  if (oversold || stock <= 0) return { code: "out", label: "Rupture de stock" };
  if (stock <= LOW_STOCK_THRESHOLD) return { code: "low", label: "Plus que " + stock + " en stock" };
  return { code: "available", label: "En stock" };
}

export function stockAlertBucket(item) {
  const stock = Math.max(0, Number(item?.stock || 0));
  const enabled = item?.boutiqueEnabled !== false && item?.stockRemoved !== true;
  if (!enabled) return "";
  if (Number(item?.oversoldStock || 0) > 0) return "oversold";
  if (stock <= 0) return "out";
  if (stock <= LOW_STOCK_THRESHOLD) return "low";
  return "";
}

export function shippingWeightStatus(item) {
  const grams = Math.trunc(Number(item?.shippingWeightGrams));
  const known = Number.isFinite(grams) && grams >= 1 && grams <= 30000;
  return {
    known,
    grams: known ? grams : null,
    code: known ? "known" : "missing",
    label: known ? grams + " g" : "Poids à renseigner"
  };
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeStockQuantity(value, fallback = 1) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
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

function invalidStockPrefs(message) {
  return Object.assign(new Error(message), { status: 400, code: "STOCK_PREFS_INVALID" });
}

function parseStockPrefs(notes) {
  const match = String(notes || "").match(STOCK_PREFS_LINE);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseStockPrefsStrict(notes) {
  const raw = String(notes || "");
  if (!raw.includes(STOCK_PREFS_TAG)) throw invalidStockPrefs("Préférences de stock manquantes.");
  const match = raw.match(STOCK_PREFS_LINE);
  if (!match) throw invalidStockPrefs("Préférences de stock illisibles.");
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object");
    return parsed;
  } catch {
    throw invalidStockPrefs("Préférences de stock JSON invalides.");
  }
}

export function sanitizeStockPreference(pref) {
  if (!pref || typeof pref !== "object" || Array.isArray(pref)) {
    throw invalidStockPrefs("Préférence de stock invalide.");
  }
  const rawCondition = String(pref.condition == null ? "" : pref.condition).trim();
  const condition = normalizeCondition(pref.condition);
  if (rawCondition && !condition) throw invalidStockPrefs("État de carte invalide.");
  if (pref.boutique !== undefined && pref.boutique !== true && pref.boutique !== false) {
    throw invalidStockPrefs("Activation Boutique invalide.");
  }
  let boutiquePrice = null;
  if (pref.boutiquePrice !== undefined && pref.boutiquePrice !== null && pref.boutiquePrice !== "") {
    const rawPrice = Number(String(pref.boutiquePrice).replace(",", "."));
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) throw invalidStockPrefs("Prix Boutique invalide.");
    boutiquePrice = money(rawPrice);
  }
  let stockBase = null;
  if (pref.stockBase !== undefined && pref.stockBase !== null && pref.stockBase !== "") {
    if (typeof pref.stockBase !== "number" && typeof pref.stockBase !== "string") {
      throw invalidStockPrefs("Quantité de stock invalide.");
    }
    if (typeof pref.stockBase === "string" && !/^\d+$/.test(pref.stockBase.trim())) {
      throw invalidStockPrefs("Quantité de stock invalide.");
    }
    const rawStock = Number(pref.stockBase);
    if (!Number.isInteger(rawStock) || rawStock < 0 || rawStock > MAX_STOCK_BASE) {
      throw invalidStockPrefs("Quantité de stock invalide.");
    }
    stockBase = rawStock;
  }
  let shippingWeightGrams = null;
  if (pref.shippingWeightGrams !== undefined && pref.shippingWeightGrams !== null && pref.shippingWeightGrams !== "") {
    if (typeof pref.shippingWeightGrams === "string" && !/^\d+$/.test(String(pref.shippingWeightGrams).trim())) {
      throw invalidStockPrefs("Poids d'expédition invalide.");
    }
    const rawWeight = Number(pref.shippingWeightGrams);
    if (!Number.isInteger(rawWeight) || rawWeight < 1 || rawWeight > 30000) {
      throw invalidStockPrefs("Poids d'expédition invalide.");
    }
    shippingWeightGrams = rawWeight;
  }
  if (pref.removed !== undefined && pref.removed !== true && pref.removed !== false) {
    throw invalidStockPrefs("Statut de retrait invalide.");
  }
  return {
    condition,
    boutique: pref.boutique === undefined ? true : pref.boutique === true,
    boutiquePrice,
    stockBase,
    shippingWeightGrams,
    removed: pref.removed === true
  };
}

export function applyStockPrefsToNotes(existingNotes, incomingNotes) {
  const parsed = parseStockPrefsStrict(incomingNotes);
  const sanitized = {};
  for (const [key, pref] of Object.entries(parsed)) {
    if (!STOCK_PREF_KEY.test(String(key || ""))) throw invalidStockPrefs("Référence de stock invalide.");
    sanitized[key] = sanitizeStockPreference(pref);
  }
  const base = String(existingNotes || "").replace(/\n?\[STOCK_PREFS\]\s*\{[^\n\r]*\}/g, "").replace(/\s+$/, "");
  const line = STOCK_PREFS_TAG + " " + JSON.stringify(sanitized);
  return base ? base + "\n" + line : line;
}

function readLinePreference(purchase, key) {
  const prefs = parseStockPrefs(purchase?.notes);
  const pref = prefs[key];
  if (!pref || typeof pref !== "object" || Array.isArray(pref)) {
    return { condition: "", boutiqueEnabled: true, boutiquePrice: null, stockBase: null, shippingWeightGrams: null, removed: false, explicit: false };
  }
  const rawPrice = Number(pref.boutiquePrice);
  const rawStockBase = Number(pref.stockBase);
  const rawWeight = Math.trunc(Number(pref.shippingWeightGrams));
  return {
    condition: normalizeCondition(pref.condition),
    boutiqueEnabled: pref.boutique === undefined ? true : pref.boutique === true,
    boutiquePrice: Number.isFinite(rawPrice) && rawPrice > 0 ? money(rawPrice) : null,
    stockBase: pref.stockBase === null || pref.stockBase === undefined || pref.stockBase === "" || !Number.isFinite(rawStockBase)
      ? null
      : Math.max(0, Math.trunc(rawStockBase)),
    shippingWeightGrams: Number.isFinite(rawWeight) && rawWeight >= 1 && rawWeight <= 30000 ? rawWeight : null,
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

function catalogReferencePrice(card) {
  const candidates = [
    ["recommended", card?.prices?.recommended],
    ["market_avg7", card?.market?.avg7],
    ["market_avg30", card?.market?.avg30],
    ["market_avg1", card?.market?.avg1],
    ["catalog_avg", card?.prices?.avg],
    ["catalog_low", card?.prices?.low]
  ];
  for (const [source, raw] of candidates) {
    const value = Number(raw || 0);
    if (Number.isFinite(value) && value > 0) return { price: money(value), source };
  }
  return { price: 0, source: "missing" };
}

function addPurchaseId(line, purchaseId) {
  const id = String(purchaseId || "").trim();
  if (id && !line.purchaseIds.includes(id)) line.purchaseIds.push(id);
}

function addLine(map, item) {
  const qty = normalizeStockQuantity(item.stock, 1);
  if (qty <= 0) return;
  const unitCost = Math.max(0, Number(item.unitCost) || 0);
  const pref = item.preference || { condition: "", boutiqueEnabled: true, boutiquePrice: null, stockBase: null, shippingWeightGrams: null, removed: false, explicit: false };
  const catalogPrice = catalogReferencePrice(item.card);
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
      shippingWeightGrams: pref.shippingWeightGrams || null,
      stockBaseOverride: pref.stockBase,
      stockRemoved: pref.removed === true,
      preferenceApplied: pref.explicit === true,
      catalogPrice: catalogPrice.price,
      catalogPriceSource: catalogPrice.source,
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
    if (pref.shippingWeightGrams) current.shippingWeightGrams = pref.shippingWeightGrams;
    current.preferenceApplied = true;
  }
  if (pref.explicit && pref.stockBase !== null && pref.stockBase !== undefined) current.stockBaseOverride = pref.stockBase;
  if (pref.explicit) current.stockRemoved = pref.removed === true;
  if (pref.explicit && pref.shippingWeightGrams) current.shippingWeightGrams = pref.shippingWeightGrams;
  if (!current.image) current.image = item.card?.imageThumb || item.card?.imageHd || item.image || "";
  if (!current.catalogPrice && catalogPrice.price) {
    current.catalogPrice = catalogPrice.price;
    current.catalogPriceSource = catalogPrice.source;
  }
}

function buildBaseStock() {
  const purchases = readJson("purchases", DEFAULT_PURCHASES).filter(isStockPurchase);
  const map = Object.create(null);
  const cardCache = Object.create(null);

  for (const purchase of purchases) {
    const qty = normalizeStockQuantity(purchase.quantity, 1);
    if (qty <= 0) continue;
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

    const legacyPaidStatus = ["À préparer", "En préparation", "Prête à expédier", "Expédiée", "Livrée"].includes(orderStatus);
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
  const rawPrice = line.boutiquePrice || line.catalogPrice || 0;
  const price = isCardPackaging(line.packaging) ? floorCardPrice(rawPrice) : money(rawPrice);
  const priceSource = line.boutiquePrice ? "admin" : (line.catalogPriceSource || "missing");
  const boutiqueEnabled = line.stockRemoved ? false : line.boutiqueEnabled !== false;
  const catalogLinked = !isCardPackaging(line.packaging) || Boolean(line.cardId);
  const identityReady = !isCardPackaging(line.packaging) || (Boolean(line.cardId) && Boolean(line.name) && Boolean(line.image));
  const priceReady = Number(price || 0) > 0;
  const availability = boutiqueAvailability({ stock, oversoldStock });
  const weight = shippingWeightStatus(line);
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
    catalogPrice: isCardPackaging(line.packaging) ? floorCardPrice(line.catalogPrice) : line.catalogPrice,
    catalogPriceSource: line.catalogPriceSource,
    image: line.image,
    boutiqueEnabled,
    stockRemoved: line.stockRemoved === true,
    catalogLinked,
    identityReady,
    priceReady,
    purchasable: boutiqueEnabled && identityReady && priceReady && stock > 0 && oversoldStock === 0,
    availability: availability.code,
    availabilityLabel: availability.label,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    shippingWeightGrams: weight.grams,
    shippingWeightKnown: weight.known,
    shippingWeightStatus: weight.code,
    shippingWeightLabel: weight.label
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
    boutiquePrice: line.boutiquePrice == null ? null : (isCardPackaging(line.packaging) ? floorCardPrice(line.boutiquePrice) : money(line.boutiquePrice)),
    latestPurchaseAt: line.latestPurchaseAt,
    inventoryStatus: line.stockRemoved ? "removed" : !identityReady ? "catalog_link_required" : !priceReady ? "catalog_price_required" : oversoldStock > 0 ? "oversold" : stock <= 0 ? "out_of_stock" : allocation.pendingStock > 0 ? "reserved" : stock <= LOW_STOCK_THRESHOLD ? "low_stock" : "available",
    alertBucket: stockAlertBucket({ stock, boutiqueEnabled, stockRemoved: line.stockRemoved, oversoldStock }),
    lowStockThreshold: LOW_STOCK_THRESHOLD
  };
}

export function listBoutiqueProducts({ includeDisabled = false } = {}) {
  const orders = readJson("orders", DEFAULT_ORDERS);
  return buildBaseStock()
    .map((line) => buildInventoryLine(line, orders, false))
    .filter((product) => !product.stockRemoved)
    .filter((product) => !isCardPackaging(product.packaging) || (product.identityReady && product.priceReady))
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

export function summarizeBoutiqueInventory(inventory) {
  const totals = (inventory || []).reduce((acc, item) => {
    const enabled = item.boutiqueEnabled !== false && item.stockRemoved !== true;
    acc.baseStock += Number(item.baseStock || 0);
    acc.availableStock += Number(item.stock || 0);
    acc.pendingStock += Number(item.pendingStock || 0);
    acc.soldStock += Number(item.soldStock || 0);
    acc.refundHoldStock += Number(item.refundHoldStock || 0);
    acc.oversoldStock += Number(item.oversoldStock || 0);
    acc.stockValue = Math.round((acc.stockValue + Number(item.stock || 0) * Number(item.averagePurchaseCost || 0)) * 100) / 100;
    if (enabled && Number(item.stock || 0) > 0 && Number(item.oversoldStock || 0) === 0) acc.availableProducts += 1;
    if (item.alertBucket === "low") acc.lowStockProducts += 1;
    if (item.alertBucket === "out") acc.outOfStockProducts += 1;
    if (Number(item.oversoldStock || 0) > 0) acc.oversoldProducts += 1;
    if (item.stockRemoved || item.boutiqueEnabled === false) acc.removedProducts += 1;
    if (enabled) {
      acc.activeProductsForWeight += 1;
      if (item.shippingWeightKnown === true || (Number.isInteger(Number(item.shippingWeightGrams)) && Number(item.shippingWeightGrams) >= 1 && Number(item.shippingWeightGrams) <= 30000)) {
        acc.weightedProducts += 1;
      } else {
        acc.missingWeightProducts += 1;
      }
    }
    return acc;
  }, {
    baseStock: 0,
    availableStock: 0,
    pendingStock: 0,
    soldStock: 0,
    refundHoldStock: 0,
    oversoldStock: 0,
    stockValue: 0,
    availableProducts: 0,
    lowStockProducts: 0,
    outOfStockProducts: 0,
    oversoldProducts: 0,
    removedProducts: 0,
    activeProductsForWeight: 0,
    weightedProducts: 0,
    missingWeightProducts: 0
  });
  totals.lowStock = totals.lowStockProducts;
  totals.outOfStock = totals.outOfStockProducts;
  totals.weightCoveragePercent = totals.activeProductsForWeight
    ? Math.round((totals.weightedProducts / totals.activeProductsForWeight) * 100)
    : 100;
  return totals;
}
