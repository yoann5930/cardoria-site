import { readJson } from "../storage.js";
import { getCardById } from "../engine/cards.js";

const DEFAULT_PURCHASES = [];
const DEFAULT_ORDERS = [];
const PENDING_RESERVATION_MS = 30 * 60 * 1000;
const STOCK_PREFS_TAG = "[STOCK_PREFS]";

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
    return { condition: "", boutiqueEnabled: true, boutiquePrice: null, explicit: false };
  }
  const rawPrice = Number(pref.boutiquePrice);
  return {
    condition: normalizeCondition(pref.condition),
    boutiqueEnabled: pref.boutique === undefined ? true : pref.boutique === true,
    boutiquePrice: Number.isFinite(rawPrice) && rawPrice > 0 ? money(rawPrice) : null,
    explicit: true
  };
}

function catalogCardId(reference) {
  const value = String(reference || "").trim();
  const prefix = "catalog-card:";
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

function lotCardIds(purchase) {
  if (Array.isArray(purchase?.lotCards) && purchase.lotCards.length) return purchase.lotCards.filter(Boolean);
  const match = String(purchase?.notes || "").match(/\[LOT_CARDS\]\s*(\[[^\n\r]*\])/);
  if (!match) return [];
  try {
    const ids = JSON.parse(match[1]);
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isStockPurchase(purchase) {
  if (String(purchase?.status || "paid") !== "paid") return false;
  if (purchase?.purchaseType === "pokemon_card") return true;
  return String(purchase?.license || "").toLowerCase() === "pokemon" &&
    ["cartes", "lots", "boosters"].includes(String(purchase?.category || "").toLowerCase());
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

function addLine(map, item) {
  const qty = Math.max(1, Math.trunc(Number(item.stock) || 1));
  const unitCost = Math.max(0, Number(item.unitCost) || 0);
  const pref = item.preference || { condition: "", boutiqueEnabled: true, boutiquePrice: null, explicit: false };
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
      preferenceApplied: pref.explicit === true,
      catalogPrice: recommendedPrice(item.card),
      image: item.card?.imageThumb || item.card?.imageHd || "",
      baseStock: qty,
      totalCost: unitCost * qty,
      latestPurchaseAt: item.latestPurchaseAt || ""
    };
    return;
  }

  const current = map[item.key];
  current.baseStock += qty;
  current.totalCost += unitCost * qty;
  if (String(item.latestPurchaseAt || "") > String(current.latestPurchaseAt || "")) current.latestPurchaseAt = item.latestPurchaseAt;
  if (!current.preferenceApplied && pref.explicit) {
    current.condition = pref.condition || current.condition;
    current.boutiqueEnabled = pref.boutiqueEnabled !== false;
    current.boutiquePrice = pref.boutiquePrice;
    current.preferenceApplied = true;
  }
  if (!current.image && item.card) current.image = item.card.imageThumb || item.card.imageHd || "";
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
      if (ids.length) {
        for (let index = 0; index < qty; index += 1) {
          const cardId = ids[index] || "";
          const card = getCardCached(cardCache, cardId);
          const key = cardId ? `card:${cardId}` : `purchase:${purchase.id}:${index}`;
          addLine(map, {
            key,
            cardId,
            card,
            name: card?.name || purchase.description || "Carte Pokémon du lot",
            extension: card?.extension || "",
            number: card?.number || "",
            rarity: card?.hitFamily || card?.rarity || "",
            categoryLabel: card?.hitFamily || card?.rarity || "Carte Pokémon",
            packaging,
            condition: purchase.condition || purchase.cardCondition || "",
            preference: readLinePreference(purchase, key),
            unitCost,
            stock: 1,
            latestPurchaseAt: purchaseDate
          });
        }
      } else {
        const key = `purchase:${purchase.id}:lot`;
        addLine(map, {
          key,
          name: purchase.description || "Lot de cartes Pokémon",
          categoryLabel: "Lot de cartes",
          packaging,
          condition: purchase.condition || purchase.cardCondition || "",
          preference: readLinePreference(purchase, key),
          unitCost,
          stock: qty,
          latestPurchaseAt: purchaseDate
        });
      }
      continue;
    }

    if (packaging === "carte_unite" || !purchase.packaging) {
      const cardId = catalogCardId(purchase.reference);
      const card = getCardCached(cardCache, cardId);
      const key = cardId ? `card:${cardId}` : `purchase:${purchase.id}`;
      addLine(map, {
        key,
        cardId,
        card,
        name: card?.name || purchase.description || "Carte Pokémon",
        extension: card?.extension || "",
        number: card?.number || "",
        rarity: card?.hitFamily || card?.rarity || "",
        categoryLabel: card?.hitFamily || card?.rarity || "Carte Pokémon",
        packaging,
        condition: purchase.condition || purchase.cardCondition || "",
        preference: readLinePreference(purchase, key),
        unitCost,
        stock: qty,
        latestPurchaseAt: purchaseDate
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
      latestPurchaseAt: purchaseDate
    });
  }

  return Object.values(map);
}

function reservedQty(productId, orders) {
  const now = Date.now();
  return (orders || []).reduce((sum, order) => {
    const paymentStatus = String(order?.paymentStatus || "");
    if (["failed", "refunded", "cancelled", "canceled"].includes(paymentStatus)) return sum;
    const paid = paymentStatus === "paid" || ["À préparer", "Expédiée", "Livrée"].includes(order?.status);
    const createdAt = Date.parse(order?.createdAt || "");
    const pendingFresh = paymentStatus === "pending" && (!Number.isFinite(createdAt) || now - createdAt < PENDING_RESERVATION_MS);
    if (!paid && !pendingFresh) return sum;
    return sum + (order.items || [])
      .filter((item) => String(item.ref || item.id) === String(productId))
      .reduce((subtotal, item) => subtotal + Math.max(1, Number(item.qty) || 1), 0);
  }, 0);
}

export function listBoutiqueProducts({ includeDisabled = false } = {}) {
  const orders = readJson("orders", DEFAULT_ORDERS);
  return buildBaseStock()
    .map((line) => {
      const reserved = reservedQty(line.key, orders);
      const stock = Math.max(0, line.baseStock - reserved);
      const price = line.boutiquePrice || line.catalogPrice || 0;
      const priceSource = line.boutiquePrice ? "admin" : (line.catalogPrice ? "cardoria_market" : "missing");
      return {
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
        boutiqueEnabled: line.boutiqueEnabled !== false,
        purchasable: line.boutiqueEnabled !== false && stock > 0 && price > 0
      };
    })
    .filter((product) => includeDisabled || product.boutiqueEnabled)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

export function getBoutiqueProduct(productId) {
  return listBoutiqueProducts({ includeDisabled: false }).find((product) => String(product.id) === String(productId)) || null;
}

export { STOCK_PREFS_TAG };
