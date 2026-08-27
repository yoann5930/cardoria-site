/**
 * Stock officiel Cardoria.
 * Les achats de cartes du catalogue alimentent le stock boutique sans doublon.
 * LIVE = annonce active dans la boutique. CACHER = annonce brouillon, stock conserve.
 * Les lignes systeme mk_cart_items servent de journal d'entree persistant par achat.
 */
import { getDb } from "../engine/database.js";
import { migrateMarketplace } from "./migrate.js";
import { initMarketplaceV1 } from "./v1/index.js";
import { createListingV1 } from "./v1/listings.js";

const STOCK_SELLER_ID = "SLR-CARDORIA-STOCK";
const STOCK_SELLER_EMAIL = "stock-system@cardoria.local";
const RECEIPT_PREFIX = "__stock_purchase__:";
const SOLD_ORDER_STATUSES = ["paid", "preparing", "shipped", "delivered"];

function ensureMarketplace() {
  migrateMarketplace();
  initMarketplaceV1();
}

function ensureStockSeller() {
  ensureMarketplace();
  const db = getDb();
  let seller = db.prepare("SELECT * FROM mk_sellers WHERE id = ?").get(STOCK_SELLER_ID);
  if (seller) return seller;
  seller = db.prepare("SELECT * FROM mk_sellers WHERE email = ?").get(STOCK_SELLER_EMAIL);
  if (seller) return seller;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO mk_sellers (
    id,email,auth_user_id,display_name,seller_type,verified,avatar,bio,
    rating_avg,rating_count,sales_count,satisfaction_rate,created_at
  ) VALUES (?,?,?,?,?,1,'','Stock officiel Cardoria',0,0,0,100,?)`).run(
    STOCK_SELLER_ID,
    STOCK_SELLER_EMAIL,
    "system:cardoria-stock",
    "Cardoria",
    "professional",
    now
  );
  return db.prepare("SELECT * FROM mk_sellers WHERE id = ?").get(STOCK_SELLER_ID);
}

function receiptUserId(purchaseId) {
  return RECEIPT_PREFIX + String(purchaseId || "").trim();
}

function extractLotCards(notes = "") {
  const match = String(notes || "").match(/\[LOT_CARDS\]\s*(\[[^\n\r]*\])/);
  if (!match) return [];
  try {
    const ids = JSON.parse(match[1]);
    return Array.isArray(ids) ? ids.map((id) => String(id || "").trim()).filter(Boolean) : [];
  } catch { return []; }
}

function singleCardId(reference = "") {
  const value = String(reference || "").trim();
  const linked = value.match(/^catalog-card:(.+)$/i);
  if (linked?.[1]) return linked[1].trim();
  return /^pokemon-[a-z0-9_-]+$/i.test(value) ? value : "";
}

export function purchaseCardCounts(purchase = {}) {
  const counts = new Map();
  if (String(purchase.purchaseType || "") !== "pokemon_card") return counts;
  if (["cancelled", "refunded"].includes(String(purchase.status || ""))) return counts;
  const packaging = String(purchase.packaging || "");
  if (packaging === "carte_unite") {
    const cardId = singleCardId(purchase.reference);
    if (cardId) counts.set(cardId, Math.max(1, Math.trunc(Number(purchase.quantity) || 1)));
    return counts;
  }
  if (packaging === "lot_cartes") {
    const ids = Array.isArray(purchase.lotCards) && purchase.lotCards.length ? purchase.lotCards : extractLotCards(purchase.notes);
    for (const rawId of ids) {
      const cardId = String(rawId || "").trim();
      if (cardId) counts.set(cardId, (counts.get(cardId) || 0) + 1);
    }
  }
  return counts;
}

function soldQuantity(db, listingId) {
  const marks = SOLD_ORDER_STATUSES.map(() => "?").join(",");
  return Number(db.prepare(`SELECT COALESCE(SUM(qty),0) AS q FROM mk_orders WHERE listing_id = ? AND status IN (${marks})`)
    .get(listingId, ...SOLD_ORDER_STATUSES)?.q || 0);
}

function purchasedQuantity(db, listingId) {
  return Number(db.prepare("SELECT COALESCE(SUM(qty),0) AS q FROM mk_cart_items WHERE listing_id = ? AND user_id LIKE ?")
    .get(listingId, RECEIPT_PREFIX + "%")?.q || 0);
}

function averagePurchasePrice(db, listingId) {
  const row = db.prepare(`SELECT COALESCE(SUM(qty * unit_price),0) AS total, COALESCE(SUM(qty),0) AS qty
    FROM mk_cart_items WHERE listing_id = ? AND user_id LIKE ?`).get(listingId, RECEIPT_PREFIX + "%");
  return Number(row?.qty || 0) > 0 ? Number(row.total || 0) / Number(row.qty) : 0;
}

function recalcListing(db, listingId) {
  const row = db.prepare("SELECT * FROM mk_listings WHERE id = ?").get(listingId);
  if (!row) return null;
  const purchased = purchasedQuantity(db, listingId);
  const sold = soldQuantity(db, listingId);
  const stock = Math.max(0, purchased - sold);
  let status;
  if (stock <= 0) status = "sold";
  else if (row.status === "active") status = "active";
  else status = "draft";
  db.prepare("UPDATE mk_listings SET stock = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(stock, status, new Date().toISOString(), listingId);
  return db.prepare("SELECT * FROM mk_listings WHERE id = ?").get(listingId);
}

function listingForCard(db, sellerId, cardId) {
  return db.prepare(`SELECT * FROM mk_listings WHERE seller_id = ? AND card_id = ? AND status <> 'removed'
    ORDER BY created_at ASC LIMIT 1`).get(sellerId, cardId);
}

function defaultSalePrice(card, unitCost) {
  const market = Number(card?.recommended_price || card?.avg_price || 0);
  if (market > 0) return Math.round(market * 100) / 100;
  const cost = Number(unitCost || 0);
  return cost > 0 ? Math.round(cost * 100) / 100 : 0;
}

function ensureCardListing(db, seller, cardId, quantity, unitCost) {
  let listing = listingForCard(db, seller.id, cardId);
  if (listing) return listing;
  const card = db.prepare("SELECT * FROM cards WHERE id = ? AND license_slug = 'pokemon'").get(cardId);
  if (!card) return null;
  const photo = card.image_thumb || card.image_hd || "";
  const created = createListingV1({
    sellerId: seller.id,
    cardId,
    title: card.name,
    license: "pokemon",
    extension: card.extension || "",
    number: card.number || "",
    language: "FR",
    description: `Stock officiel Cardoria${card.extension ? ` — ${card.extension}` : ""}${card.number ? ` #${card.number}` : ""}`,
    condition: card.condition_note || "NM",
    price: defaultSalePrice(card, unitCost),
    negotiable: false,
    stock: Math.max(1, quantity),
    photos: photo ? [photo] : [],
    status: "draft"
  });
  return db.prepare("SELECT * FROM mk_listings WHERE id = ?").get(created.id);
}

function removePurchaseReceipts(db, purchaseId) {
  const userId = receiptUserId(purchaseId);
  const affected = db.prepare("SELECT listing_id AS listingId FROM mk_cart_items WHERE user_id = ?").all(userId).map((r) => r.listingId);
  db.prepare("DELETE FROM mk_cart_items WHERE user_id = ?").run(userId);
  return affected;
}

export function syncPurchaseToCardoriaStock(purchase = {}) {
  if (!purchase?.id) throw Object.assign(new Error("Identifiant d'achat manquant."), { status: 400 });
  const seller = ensureStockSeller();
  const db = getDb();
  const affected = new Set(removePurchaseReceipts(db, purchase.id));
  const counts = purchaseCardCounts(purchase);
  const totalCards = [...counts.values()].reduce((sum, qty) => sum + qty, 0);
  const unitCost = totalCards > 0 ? Math.max(0, Number(purchase.amount || 0)) / totalCards : 0;
  const now = new Date().toISOString();

  for (const [cardId, qty] of counts) {
    const listing = ensureCardListing(db, seller, cardId, qty, unitCost);
    if (!listing) continue;
    db.prepare(`INSERT INTO mk_cart_items (user_id,listing_id,qty,unit_price,added_at)
      VALUES (?,?,?,?,?) ON CONFLICT(user_id,listing_id) DO UPDATE SET qty=excluded.qty,unit_price=excluded.unit_price,added_at=excluded.added_at`)
      .run(receiptUserId(purchase.id), listing.id, qty, unitCost, now);
    affected.add(listing.id);
  }

  for (const listingId of affected) recalcListing(db, listingId);
  return { ok: true, purchaseId: purchase.id, linkedCards: counts.size, affectedListings: affected.size };
}

export function removePurchaseFromCardoriaStock(purchaseId) {
  ensureStockSeller();
  const db = getDb();
  const affected = removePurchaseReceipts(db, purchaseId);
  for (const listingId of affected) recalcListing(db, listingId);
  return { ok: true, purchaseId: String(purchaseId || ""), affectedListings: affected.length };
}

export function syncExistingPurchasesToCardoriaStock(purchases = []) {
  let linkedCards = 0;
  let purchasesSynced = 0;
  for (const purchase of Array.isArray(purchases) ? purchases : []) {
    if (!purchase?.id || String(purchase.purchaseType || "") !== "pokemon_card") continue;
    const result = syncPurchaseToCardoriaStock(purchase);
    linkedCards += result.linkedCards || 0;
    purchasesSynced += 1;
  }
  return { ok: true, purchasesSynced, linkedCards };
}

export function setCardoriaStockLive(listingId, live) {
  const seller = ensureStockSeller();
  const db = getDb();
  const row = db.prepare("SELECT * FROM mk_listings WHERE id = ? AND seller_id = ?").get(listingId, seller.id);
  if (!row) throw Object.assign(new Error("Ligne de stock introuvable."), { status: 404 });
  const stock = Number(row.stock || 0);
  const next = stock <= 0 ? "sold" : (live ? "active" : "draft");
  db.prepare("UPDATE mk_listings SET status = ?, updated_at = ? WHERE id = ?")
    .run(next, new Date().toISOString(), listingId);
  return stockRow(db.prepare("SELECT * FROM mk_listings WHERE id = ?").get(listingId), db);
}

function stockRow(row, db) {
  const card = row.card_id ? db.prepare("SELECT name,extension,number,image_thumb,image_hd,rarity,hit_family FROM cards WHERE id = ?").get(row.card_id) : null;
  return {
    id: row.id,
    cardId: row.card_id || "",
    name: card?.name || row.title,
    extension: card?.extension || row.extension || "",
    number: card?.number || row.card_number || "",
    rarity: card?.rarity || "",
    hitFamily: card?.hit_family || "",
    image: card?.image_thumb || card?.image_hd || (() => { try { return JSON.parse(row.photos || "[]")[0] || ""; } catch { return ""; } })(),
    condition: row.card_condition || "NM",
    salePrice: Number(row.price || 0),
    averagePurchasePrice: Math.round(averagePurchasePrice(db, row.id) * 100) / 100,
    purchased: purchasedQuantity(db, row.id),
    sold: soldQuantity(db, row.id),
    stock: Number(row.stock || 0),
    live: row.status === "active" && Number(row.stock || 0) > 0,
    status: row.status
  };
}

export function listCardoriaStock({ q = "" } = {}) {
  const seller = ensureStockSeller();
  const db = getDb();
  let rows = db.prepare("SELECT * FROM mk_listings WHERE seller_id = ? AND status <> 'removed' ORDER BY updated_at DESC").all(seller.id);
  const needle = String(q || "").trim().toLowerCase();
  if (needle) rows = rows.filter((row) => {
    const card = row.card_id ? db.prepare("SELECT name,extension,extension_code,number FROM cards WHERE id = ?").get(row.card_id) : null;
    return [row.title, row.card_id, card?.name, card?.extension, card?.extension_code, card?.number].some((v) => String(v || "").toLowerCase().includes(needle));
  });
  return rows.map((row) => stockRow(row, db));
}
