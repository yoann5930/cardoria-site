import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readJson } from "../storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = path.resolve(__dirname, "../../../products.json");
const PENDING_RESERVATION_MS = 30 * 60 * 1000;

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function readBoutiqueCatalog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function orderItemQty(order, productId) {
  return (order?.items || [])
    .filter((item) => String(item.ref || item.id) === String(productId))
    .reduce((sum, item) => sum + Math.max(1, Math.trunc(Number(item.qty) || 1)), 0);
}

function committedQty(productId, orders) {
  const now = Date.now();
  return (orders || []).reduce((sum, order) => {
    const paymentStatus = String(order?.paymentStatus || "").toLowerCase();
    const orderStatus = String(order?.status || "");
    if (["failed", "refunded", "cancelled", "canceled"].includes(paymentStatus)) return sum;

    const paid = paymentStatus === "paid" || ["À préparer", "En préparation", "Expédiée", "Livrée"].includes(orderStatus);
    const createdAt = Date.parse(order?.createdAt || "");
    const pendingFresh = paymentStatus === "pending" && (!Number.isFinite(createdAt) || now - createdAt < PENDING_RESERVATION_MS);
    if (!paid && !pendingFresh) return sum;
    return sum + orderItemQty(order, productId);
  }, 0);
}

function normalizeProduct(raw, orders) {
  const id = clean(raw?.id, 240);
  if (!id) return null;

  const baseStock = Math.max(0, Math.trunc(Number(raw?.stock) || 0));
  const reserved = committedQty(id, orders);
  const stock = Math.max(0, baseStock - reserved);
  const price = money(raw?.price);
  const boutiqueEnabled = raw?.enabled !== false && raw?.boutiqueEnabled !== false;
  const name = clean(raw?.name, 240) || "Produit CardoriaShop";
  const category = clean(raw?.category, 80).toLowerCase() || "pokemon";

  return {
    id,
    cardId: clean(raw?.cardId, 240),
    category,
    name,
    extension: clean(raw?.extension, 160),
    number: clean(raw?.number, 80),
    rarity: clean(raw?.rarity, 120),
    categoryLabel: clean(raw?.categoryLabel, 120) || category,
    packaging: clean(raw?.packaging, 80) || "boutique",
    condition: clean(raw?.condition, 120) || "Neuf",
    conditionCode: clean(raw?.conditionCode, 40),
    stock,
    baseStock,
    reservedStock: reserved,
    price,
    priceSource: "boutique_catalog",
    image: clean(raw?.image || raw?.imageUrl, 1000),
    boutiqueEnabled,
    identityReady: Boolean(name),
    priceReady: price > 0,
    purchasable: boutiqueEnabled && price > 0 && stock > 0,
    source: "boutique_catalog"
  };
}

export function listBoutiqueProducts({ includeDisabled = false } = {}) {
  const orders = readJson("orders", []);
  return readBoutiqueCatalog()
    .map((item) => normalizeProduct(item, orders))
    .filter(Boolean)
    .filter((product) => includeDisabled || product.boutiqueEnabled)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

export function getBoutiqueProduct(productId) {
  return listBoutiqueProducts({ includeDisabled: false })
    .find((product) => String(product.id) === String(productId)) || null;
}
