import { getCardById } from "./engine/cards.js";

function clean(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function catalogCardId(reference = "") {
  const value = String(reference || "").trim();
  const prefix = "catalog-card:";
  return value.startsWith(prefix) ? clean(value.slice(prefix.length), 180) : "";
}

function lotCardIds(purchase = {}) {
  if (Array.isArray(purchase.lotCards) && purchase.lotCards.length) {
    return purchase.lotCards.map((id) => clean(id, 180)).filter(Boolean);
  }
  const match = String(purchase.notes || "").match(/\[LOT_CARDS\]\s*(\[[^\n\r]*\])/);
  if (!match) return [];
  try {
    const ids = JSON.parse(match[1]);
    return Array.isArray(ids) ? ids.map((id) => clean(id, 180)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function resolveCard(id) {
  if (!id) return null;
  try {
    return getCardById(id) || null;
  } catch {
    return null;
  }
}

function isPokemonStockPurchase(purchase = {}) {
  const status = String(purchase.status || "paid");
  if (status !== "paid") return false;
  if (purchase.purchaseType === "pokemon_card") return true;
  // Compatibility with purchases recorded before purchaseType was introduced.
  const license = String(purchase.license || "").toLowerCase();
  const category = String(purchase.category || "").toLowerCase();
  return license === "pokemon" && ["cartes", "lots", "boosters"].includes(category);
}

function addItem(map, item) {
  const quantity = Math.max(1, Math.trunc(Number(item.stock) || 1));
  const unitCost = Math.max(0, Number(item.unitCost) || 0);
  const totalCost = unitCost * quantity;
  const existing = map.get(item.key);

  if (!existing) {
    map.set(item.key, {
      id: item.id,
      catalogCardId: item.catalogCardId || "",
      name: item.name || "Achat Pokémon",
      category: item.category || "Pokémon",
      condition: item.condition || "Non renseigné",
      extension: item.extension || "",
      number: item.number || "",
      packaging: item.packaging || "carte_unite",
      price: round2(unitCost),
      stock: quantity,
      source: "Achats",
      purchaseIds: item.purchaseId ? [item.purchaseId] : [],
      latestPurchaseAt: item.purchaseDate || "",
      _totalCost: totalCost
    });
    return;
  }

  existing.stock += quantity;
  existing._totalCost += totalCost;
  existing.price = existing.stock > 0 ? round2(existing._totalCost / existing.stock) : 0;
  if (item.purchaseId && !existing.purchaseIds.includes(item.purchaseId)) existing.purchaseIds.push(item.purchaseId);
  if (String(item.purchaseDate || "") > String(existing.latestPurchaseAt || "")) existing.latestPurchaseAt = item.purchaseDate;
}

function cardStockItem(purchase, cardId, index, unitCost) {
  const card = resolveCard(cardId);
  const fallbackName = clean(purchase.description, 240) || "Carte Pokémon";
  const fallbackId = `purchase:${purchase.id || "legacy"}:${index}`;
  return {
    key: cardId ? `card:${cardId}` : fallbackId,
    id: cardId || fallbackId,
    catalogCardId: cardId,
    name: card?.name || fallbackName,
    category: card?.hitFamily || card?.rarity || "Carte Pokémon",
    condition: clean(purchase.condition || purchase.cardCondition, 80) || "Non renseigné",
    extension: card?.extension || "",
    number: card?.number || "",
    packaging: purchase.packaging || "carte_unite",
    unitCost,
    stock: 1,
    purchaseId: purchase.id || "",
    purchaseDate: purchase.date || purchase.createdAt || ""
  };
}

export function buildPurchaseStock(purchases = []) {
  const map = new Map();

  for (const purchase of Array.isArray(purchases) ? purchases : []) {
    if (!isPokemonStockPurchase(purchase)) continue;

    const quantity = Math.max(1, Math.trunc(Number(purchase.quantity) || 1));
    const amount = Math.max(0, Number(purchase.amount) || 0);
    const unitCost = quantity > 0 ? amount / quantity : amount;
    const packaging = String(purchase.packaging || "carte_unite");

    if (packaging === "lot_cartes") {
      const ids = lotCardIds(purchase);
      if (ids.length) {
        for (let index = 0; index < quantity; index += 1) {
          addItem(map, cardStockItem(purchase, ids[index] || "", index, unitCost));
        }
      } else {
        addItem(map, {
          key: `purchase:${purchase.id || "legacy"}:lot`,
          id: `purchase:${purchase.id || "legacy"}:lot`,
          name: clean(purchase.description, 240) || "Lot de cartes Pokémon",
          category: "Lot de cartes",
          condition: "Non renseigné",
          packaging,
          unitCost,
          stock: quantity,
          purchaseId: purchase.id || "",
          purchaseDate: purchase.date || purchase.createdAt || ""
        });
      }
      continue;
    }

    if (packaging === "carte_unite" || !purchase.packaging) {
      const cardId = catalogCardId(purchase.reference);
      const item = cardStockItem(purchase, cardId, 0, unitCost);
      item.stock = quantity;
      addItem(map, item);
      continue;
    }

    // Sealed Pokémon products recorded in the same purchase section are stockable too.
    addItem(map, {
      key: `purchase:${purchase.id || "legacy"}:sealed`,
      id: `purchase:${purchase.id || "legacy"}:sealed`,
      name: clean(purchase.description, 240) || "Produit Pokémon scellé",
      category: "Produit scellé",
      condition: "Scellé",
      packaging,
      unitCost,
      stock: quantity,
      purchaseId: purchase.id || "",
      purchaseDate: purchase.date || purchase.createdAt || ""
    });
  }

  return Array.from(map.values())
    .map(({ _totalCost, ...item }) => item)
    .sort((a, b) => String(b.latestPurchaseAt || "").localeCompare(String(a.latestPurchaseAt || "")) || String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

export function summarizePurchaseStock(stock = []) {
  const items = Array.isArray(stock) ? stock : [];
  const units = items.reduce((sum, item) => sum + Math.max(0, Number(item.stock) || 0), 0);
  const purchaseValue = items.reduce((sum, item) => sum + Math.max(0, Number(item.price) || 0) * Math.max(0, Number(item.stock) || 0), 0);
  const catalogLinked = items.filter((item) => item.catalogCardId).length;
  return { references: items.length, units, purchaseValue: round2(purchaseValue), catalogLinked };
}
