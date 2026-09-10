/**
 * Sessions Live Cardoria — paiement et lots, indépendants du lecteur Whatnot.
 */
import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { resolvePaymentRoute } from "../payments/routing.js";

const STORE_KEY = "live-sessions.json";
const inflight = new Map();

function emptyStore() {
  return { sessions: [], checkouts: [], adminAccess: [] };
}

let testStore = null;

export function __setLiveStoreForTests(store) {
  testStore = store || emptyStore();
}

export function __resetLiveStoreForTests() {
  testStore = null;
  inflight.clear();
}

function load() {
  if (testStore) {
    if (!Array.isArray(testStore.adminAccess)) testStore.adminAccess = [];
    return testStore;
  }
  const data = readJson(STORE_KEY, emptyStore());
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.checkouts)) data.checkouts = [];
  if (!Array.isArray(data.adminAccess)) data.adminAccess = [];
  return data;
}

function save(data) {
  if (testStore) {
    testStore.sessions = data.sessions;
    testStore.checkouts = data.checkouts;
    testStore.adminAccess = data.adminAccess || [];
    return;
  }
  writeJson(STORE_KEY, data);
}

function clean(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeProducts(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw Object.assign(new Error("Au moins un produit Live est requis."), { status: 400 });
  }
  return raw.slice(0, 50).map((item, index) => {
    const id = clean(item?.id, 120) || `LOT-${index + 1}`;
    const name = clean(item?.name, 160) || `Lot ${index + 1}`;
    const qty = Math.max(1, Math.min(50, Math.trunc(Number(item?.qty) || 1)));
    const stock = Math.max(0, Math.trunc(Number(item?.stock ?? qty) || 0));
    const price = money(item?.price);
    if (price <= 0) throw Object.assign(new Error(`Prix Live invalide pour ${name}.`), { status: 400 });
    return {
      id,
      name,
      qty,
      stock,
      price,
      mode: String(item?.mode || "buy_now").toLowerCase() === "auction" ? "auction" : "buy_now"
    };
  });
}

function withProvider(session) {
  const route = resolvePaymentRoute({
    channel: "live",
    ownerRole: session.ownerRole
  });
  return { ...session, channel: route.channel, paymentProvider: route.provider };
}

export function publicLiveSession(session) {
  if (!session) return null;
  const live = withProvider(session);
  return {
    id: live.id,
    title: live.title,
    ownerRole: live.ownerRole,
    ownerId: live.ownerId,
    status: live.status,
    scheduledAt: live.scheduledAt || "",
    startedAt: live.startedAt || "",
    endedAt: live.endedAt || "",
    products: live.products,
    paymentProvider: live.paymentProvider,
    channel: live.channel,
    createdAt: live.createdAt,
    updatedAt: live.updatedAt
  };
}

export function listLiveSessions({ ownerRole, ownerId, status } = {}) {
  let sessions = load().sessions.map(withProvider);
  if (ownerRole) sessions = sessions.filter((item) => item.ownerRole === ownerRole);
  if (ownerId) sessions = sessions.filter((item) => item.ownerId === ownerId);
  if (status) sessions = sessions.filter((item) => item.status === status);
  return sessions;
}

export function getLiveSession(id) {
  const session = load().sessions.find((item) => item.id === String(id || ""));
  return session ? withProvider(session) : null;
}

function isCardoriaAdminRole(role) {
  return ["super_admin", "admin", "employee"].includes(String(role || "").toLowerCase());
}

function hashGrantToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function liveUrlPrivilegeQueryIsIgnored() {
  return true;
}

export function assertCanManageLive(actor, session, { adminOverride = false } = {}) {
  if (!session) throw Object.assign(new Error("Live introuvable."), { status: 404 });
  const role = String(actor?.role || "").toLowerCase();
  const isAdmin = isCardoriaAdminRole(role);
  if (adminOverride && isAdmin) return session;
  if (session.ownerRole === "admin") {
    if (!isAdmin) throw Object.assign(new Error("Ce Live Cardoria est réservé à l'administration."), { status: 403 });
    return session;
  }
  const sellerId = String(actor?.sellerId || actor?.id || "");
  if (!sellerId || sellerId !== session.ownerId) {
    throw Object.assign(new Error("Ce Live appartient à un autre vendeur."), { status: 403 });
  }
  return session;
}

export function assertAdminLiveEnter(actor, session) {
  if (!session) throw Object.assign(new Error("Live introuvable."), { status: 404 });
  if (!isCardoriaAdminRole(actor?.role)) {
    throw Object.assign(new Error("Accès admin Live réservé à Cardoria."), { status: 403 });
  }
  return session;
}

export function grantAdminLiveAccess(sessionId, actor) {
  const session = getLiveSession(sessionId);
  if (!session) throw Object.assign(new Error("Live introuvable."), { status: 404 });
  assertAdminLiveEnter(actor, session);
  const now = Date.now();
  const token = crypto.randomBytes(32).toString("base64url");
  const grant = {
    id: "ALG-" + crypto.randomUUID(),
    liveId: session.id,
    tokenHash: hashGrantToken(token),
    actorId: String(actor?.id || actor?.email || "admin"),
    actorEmail: String(actor?.email || ""),
    actorRole: String(actor?.role || "admin"),
    accessRole: "admin",
    accessContext: "cardoria",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 8 * 3600000).toISOString()
  };
  const data = load();
  data.adminAccess = (data.adminAccess || [])
    .filter((item) => new Date(item.expiresAt).getTime() > now)
    .slice(0, 200);
  data.adminAccess.unshift(grant);
  const index = data.sessions.findIndex((item) => item.id === session.id);
  if (index >= 0) {
    data.sessions[index] = {
      ...data.sessions[index],
      lastAdminEnterAt: grant.createdAt,
      lastAdminEnterBy: grant.actorEmail || grant.actorId,
      ownerRole: data.sessions[index].ownerRole,
      ownerId: data.sessions[index].ownerId
    };
  }
  save(data);
  const live = getLiveSession(session.id);
  return {
    grantToken: token,
    grantId: grant.id,
    expiresAt: grant.expiresAt,
    accessRole: "admin",
    accessContext: "cardoria",
    session: publicLiveSession(live),
    url: `/live.html?session=${encodeURIComponent(live.id)}`,
    paymentCreated: false,
    checkoutCreated: false,
    commissionCreated: false
  };
}

export function resolveAdminLiveAccess({ liveId, grantToken, actor } = {}) {
  const session = getLiveSession(liveId);
  if (!session) return null;
  if (isCardoriaAdminRole(actor?.role)) {
    return { session, accessRole: "admin", accessContext: "cardoria", via: "admin_session" };
  }
  const token = String(grantToken || "").trim();
  if (!token) return null;
  const now = Date.now();
  const grant = (load().adminAccess || []).find((item) => (
    item.liveId === session.id
    && item.tokenHash === hashGrantToken(token)
    && item.accessRole === "admin"
    && item.accessContext === "cardoria"
    && new Date(item.expiresAt).getTime() > now
  ));
  if (!grant) return null;
  return { session, accessRole: "admin", accessContext: "cardoria", via: "grant", grantId: grant.id };
}

export function listAdminLiveAccess({ liveId } = {}) {
  let grants = load().adminAccess || [];
  if (liveId) grants = grants.filter((item) => item.liveId === String(liveId));
  return grants.map((item) => ({
    id: item.id,
    liveId: item.liveId,
    accessRole: item.accessRole,
    accessContext: item.accessContext,
    actorId: item.actorId,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt
  }));
}

export function createLiveSession({ title, ownerRole, ownerId, ownerEmail, products, scheduledAt, actor }) {
  const role = String(ownerRole || "").toLowerCase() === "seller" ? "seller" : "admin";
  if (role === "seller" && ["super_admin", "admin", "employee"].includes(String(actor?.role || "")) === false) {
    if (actor?.sellerId && actor.sellerId !== String(ownerId || "")) {
      throw Object.assign(new Error("Un vendeur ne peut créer un Live que pour son propre compte."), { status: 403 });
    }
  }
  if (role === "admin" && actor?.sellerId && !["super_admin", "admin", "employee"].includes(String(actor?.role || ""))) {
    throw Object.assign(new Error("Un vendeur ne peut pas créer un Live Cardoria/Admin."), { status: 403 });
  }
  const now = new Date().toISOString();
  const session = withProvider({
    id: "LIVE-" + crypto.randomUUID(),
    title: clean(title, 160) || "Live Cardoria",
    ownerRole: role,
    ownerId: clean(ownerId, 120) || (role === "admin" ? "cardoria" : ""),
    ownerEmail: clean(ownerEmail, 254),
    status: scheduledAt ? "scheduled" : "draft",
    scheduledAt: clean(scheduledAt, 40),
    startedAt: "",
    endedAt: "",
    products: normalizeProducts(products),
    currentLot: null,
    createdAt: now,
    updatedAt: now
  });
  if (!session.ownerId) throw Object.assign(new Error("Identifiant propriétaire Live obligatoire."), { status: 400 });
  const data = load();
  data.sessions.unshift(session);
  save(data);
  return session;
}

export function updateLiveSession(id, patch, actor, { adminOverride = false } = {}) {
  const data = load();
  const index = data.sessions.findIndex((item) => item.id === String(id || ""));
  if (index < 0) throw Object.assign(new Error("Live introuvable."), { status: 404 });
  const current = withProvider(data.sessions[index]);
  assertCanManageLive(actor, current, { adminOverride });
  const next = { ...current };
  if (patch.title != null) next.title = clean(patch.title, 160) || next.title;
  if (patch.products) next.products = normalizeProducts(patch.products);
  if (patch.scheduledAt != null) {
    next.scheduledAt = clean(patch.scheduledAt, 40);
    if (next.status === "draft" && next.scheduledAt) next.status = "scheduled";
  }
  if (patch.currentLot) next.currentLot = patch.currentLot;
  next.ownerRole = current.ownerRole;
  next.updatedAt = new Date().toISOString();
  data.sessions[index] = withProvider(next);
  save(data);
  return data.sessions[index];
}

export function setLiveStatus(id, status, actor, { adminOverride = false } = {}) {
  const allowed = new Set(["draft", "scheduled", "live", "ended", "cancelled"]);
  const nextStatus = String(status || "").toLowerCase();
  if (!allowed.has(nextStatus)) throw Object.assign(new Error("Statut Live invalide."), { status: 400 });
  const data = load();
  const index = data.sessions.findIndex((item) => item.id === String(id || ""));
  if (index < 0) throw Object.assign(new Error("Live introuvable."), { status: 404 });
  const current = withProvider(data.sessions[index]);
  assertCanManageLive(actor, current, { adminOverride });
  const now = new Date().toISOString();
  current.status = nextStatus;
  if (nextStatus === "live") current.startedAt = current.startedAt || now;
  if (nextStatus === "ended" || nextStatus === "cancelled") current.endedAt = now;
  current.updatedAt = now;
  data.sessions[index] = withProvider(current);
  save(data);
  return data.sessions[index];
}

export function listLiveCheckouts({ liveId, ownerId } = {}) {
  let checkouts = load().checkouts;
  if (liveId) checkouts = checkouts.filter((item) => item.liveId === liveId);
  if (ownerId) checkouts = checkouts.filter((item) => item.ownerId === ownerId);
  return checkouts;
}

export function getLiveCheckout(id) {
  return load().checkouts.find((item) => item.id === String(id || "") || item.idempotencyKey === String(id || "")) || null;
}

export function saveLiveCheckout(checkout) {
  const data = load();
  const index = data.checkouts.findIndex((item) => item.id === checkout.id);
  if (index >= 0) data.checkouts[index] = checkout;
  else data.checkouts.unshift(checkout);
  save(data);
  return checkout;
}

export async function withLiveLock(key, fn) {
  const token = String(key || "");
  if (inflight.has(token)) return inflight.get(token);
  const pending = Promise.resolve().then(fn).finally(() => inflight.delete(token));
  inflight.set(token, pending);
  return pending;
}

export function decrementLiveStock(liveId, productId, qty) {
  const data = load();
  const session = data.sessions.find((item) => item.id === liveId);
  if (!session) return;
  const product = (session.products || []).find((item) => item.id === productId);
  if (!product) return;
  product.stock = Math.max(0, Number(product.stock || 0) - qty);
  session.updatedAt = new Date().toISOString();
  save(data);
}

export function applyLivePaymentStatus(orderId, status, patch = {}) {
  const checkout = getLiveCheckout(orderId) || listLiveCheckouts().find((item) => item.paymentProviderOrderId === String(orderId || ""));
  if (!checkout) return null;
  const previous = checkout.status;
  if (previous === "paid" && status === "paid") {
    return { ...checkout, alreadyPaid: true };
  }
  if (previous === "paid" && status !== "paid") {
    return { ...checkout, alreadyPaid: true, protected: true };
  }
  if (previous === status) {
    return { ...checkout, duplicate: true };
  }
  checkout.status = status;
  if (patch.paymentProviderOrderId) checkout.paymentProviderOrderId = patch.paymentProviderOrderId;
  if (patch.paymentProviderTransactionId) checkout.paymentProviderTransactionId = patch.paymentProviderTransactionId;
  checkout.updatedAt = new Date().toISOString();
  if (status === "paid" && previous !== "paid") {
    decrementLiveStock(checkout.liveId, checkout.productId, checkout.qty);
  }
  return saveLiveCheckout(checkout);
}
