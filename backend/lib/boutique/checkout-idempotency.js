import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDataDir } from "../storage.js";

export const PENDING_CHECKOUT_REUSE_MS = 30 * 60 * 1000;
export const CHECKOUT_CREATION_STALE_MS = 2 * 60 * 1000;
export const CHECKOUT_LOCK_WAIT_MS = 20 * 1000;

const inProcessLocks = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value, max = 500) => String(value == null ? "" : value).trim().slice(0, max);

export function normalizeCheckoutRequestItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw Object.assign(new Error("Panier vide"), { status: 400 });
  }
  const combined = new Map();
  for (const raw of rawItems) {
    const ref = clean(raw?.ref || raw?.id, 240);
    if (!ref) throw Object.assign(new Error("Référence produit invalide."), { status: 400, code: "PRODUCT_ID_INVALID" });
    const qty = Math.trunc(Number(raw?.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      throw Object.assign(new Error("Quantité invalide."), { status: 400, code: "QTY_INVALID" });
    }
    if (qty > 20) throw Object.assign(new Error("Quantité trop élevée."), { status: 400, code: "QTY_INVALID" });
    combined.set(ref, (combined.get(ref) || 0) + qty);
  }
  return Array.from(combined.entries())
    .map(([ref, qty]) => ({ ref, qty }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

export function checkoutRequestFingerprint({ email, items, shippingMethod, pickupId }) {
  const normalizedItems = normalizeCheckoutRequestItems(items)
    .map((item) => `${item.ref}:${item.qty}`)
    .join("|");
  const source = [clean(email, 254).toLowerCase(), normalizedItems, clean(shippingMethod, 80), clean(pickupId, 120)].join("|");
  return crypto.createHash("sha256").update(source).digest("hex");
}

export function orderCheckoutRequestFingerprint(order) {
  return checkoutRequestFingerprint({
    email: order?.email,
    items: order?.items || [],
    shippingMethod: order?.shippingMethod,
    pickupId: order?.pickupPoint?.id || ""
  });
}

export function findRecentPendingCheckout(orders, requestKey, now = Date.now()) {
  return (orders || []).find((order) => {
    if (String(order?.paymentStatus || "").toLowerCase() !== "pending") return false;
    const createdAt = Date.parse(order?.createdAt || "");
    if (!Number.isFinite(createdAt) || now - createdAt >= PENDING_CHECKOUT_REUSE_MS) return false;
    if (order?.checkoutRequestKey && order.checkoutRequestKey === requestKey) return true;
    try { return orderCheckoutRequestFingerprint(order) === requestKey; } catch { return false; }
  }) || null;
}

export function checkoutCreationIsFresh(order, now = Date.now()) {
  const startedAt = Date.parse(order?.checkoutCreationStartedAt || order?.createdAt || "");
  return Number.isFinite(startedAt) && now - startedAt < CHECKOUT_CREATION_STALE_MS;
}

function lockFilePath(requestKey, lockRoot) {
  const safeKey = crypto.createHash("sha256").update(String(requestKey || "")).digest("hex");
  return path.join(lockRoot, `${safeKey}.lock`);
}

async function withInterProcessLock(requestKey, work, {
  lockRoot = path.join(getDataDir(), "locks", "boutique-checkout"),
  waitMs = CHECKOUT_LOCK_WAIT_MS,
  staleMs = CHECKOUT_CREATION_STALE_MS
} = {}) {
  fs.mkdirSync(lockRoot, { recursive: true });
  const lockPath = lockFilePath(requestKey, lockRoot);
  const deadline = Date.now() + waitMs;

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      } finally {
        fs.closeSync(fd);
      }
      try {
        return await work();
      } finally {
        try { fs.unlinkSync(lockPath); } catch {}
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const stat = fs.statSync(lockPath);
        stale = Date.now() - stat.mtimeMs >= staleMs;
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (stale) {
        try { fs.unlinkSync(lockPath); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
        continue;
      }
      if (Date.now() >= deadline) {
        throw Object.assign(new Error("Création du paiement déjà en cours. Réessaie dans quelques secondes."), {
          status: 409,
          code: "BOUTIQUE_CHECKOUT_IN_PROGRESS"
        });
      }
      await sleep(50);
    }
  }
}

export function withCheckoutRequestLock(requestKey, work, options) {
  const mapKey = String(requestKey || "");
  const existing = inProcessLocks.get(mapKey);
  if (existing) return existing;
  const tracked = Promise.resolve()
    .then(() => withInterProcessLock(mapKey, work, options))
    .finally(() => {
      if (inProcessLocks.get(mapKey) === tracked) inProcessLocks.delete(mapKey);
    });
  inProcessLocks.set(mapKey, tracked);
  return tracked;
}
