/** Profils vendeurs — identite Cardoria, evaluations et statut PayPal. */
import { getDb } from "../engine/database.js";
import { getSellerPlanState } from "../subscriptions/seller-plans.js";
import { makeMarketId } from "./migrate.js";

export function getSeller(id) {
  const row = getDb().prepare("SELECT * FROM mk_sellers WHERE id = ?").get(id);
  return row ? toSeller(row) : null;
}
export function getSellerByEmail(email) {
  const row = getDb().prepare("SELECT * FROM mk_sellers WHERE email = ?").get(String(email || "").trim().toLowerCase());
  return row ? toSeller(row) : null;
}
export function getSellerByAuthUserId(authUserId) {
  if (!authUserId) return null;
  const row = getDb().prepare("SELECT * FROM mk_sellers WHERE auth_user_id = ?").get(String(authUserId));
  return row ? toSeller(row) : null;
}

export function registerSeller({ email, displayName, sellerType, bio, authUserId }) {
  const db = getDb();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const ownerId = String(authUserId || "").trim();
  if (!ownerId) throw Object.assign(new Error("Identite Cardoria requise pour creer un vendeur."), { status: 401 });
  const owned = getSellerByAuthUserId(ownerId);
  if (owned) return owned;
  const existing = getSellerByEmail(normalizedEmail);
  if (existing) {
    if (existing.authUserId === ownerId) return existing;
    // Un profil historique non lie ne peut jamais etre revendique sur la seule preuve d'un email saisi.
    throw Object.assign(new Error("Ce profil vendeur historique doit etre reactive par Cardoria apres verification d'identite."), { status: 409, code: 409 });
  }
  const id = makeMarketId("SLR");
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO mk_sellers (id,email,auth_user_id,display_name,seller_type,bio,created_at) VALUES (?,?,?,?,?,?,?)`).run(id, normalizedEmail, ownerId, displayName || normalizedEmail.split("@")[0], sellerType || "individual", bio || "", now);
  return getSeller(id);
}

export function updateSellerPayPal(sellerId, patch = {}) {
  const seller = getSeller(sellerId);
  if (!seller) return null;
  const db = getDb();
  db.prepare(`UPDATE mk_sellers SET paypal_merchant_id=COALESCE(?,paypal_merchant_id), paypal_tracking_id=COALESCE(?,paypal_tracking_id), paypal_onboarding_status=COALESCE(?,paypal_onboarding_status), paypal_payments_receivable=COALESCE(?,paypal_payments_receivable), paypal_email_confirmed=COALESCE(?,paypal_email_confirmed), paypal_permissions_granted=COALESCE(?,paypal_permissions_granted), paypal_connected_at=COALESCE(?,paypal_connected_at) WHERE id=?`).run(patch.merchantId ?? null, patch.trackingId ?? null, patch.onboardingStatus ?? null, patch.paymentsReceivable != null ? (patch.paymentsReceivable ? 1 : 0) : null, patch.emailConfirmed != null ? (patch.emailConfirmed ? 1 : 0) : null, patch.permissionsGranted != null ? (patch.permissionsGranted ? 1 : 0) : null, patch.connectedAt ?? null, sellerId);
  return getSeller(sellerId);
}

function cleanSenderValue(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

export function updateSellerSenderProfile(sellerId, patch = {}) {
  const seller = getSeller(sellerId);
  if (!seller) return null;
  const sender = {
    name: cleanSenderValue(patch.name || patch.senderName || seller.sender?.name || seller.displayName, 120),
    addressLine1: cleanSenderValue(patch.addressLine1 || patch.senderAddressLine1, 160),
    addressLine2: cleanSenderValue(patch.addressLine2 || patch.senderAddressLine2, 160),
    postalCode: cleanSenderValue(patch.postalCode || patch.senderPostalCode, 24).toUpperCase(),
    city: cleanSenderValue(patch.city || patch.senderCity, 120),
    countryCode: cleanSenderValue(patch.countryCode || patch.senderCountryCode || "FR", 2).toUpperCase(),
    phone: cleanSenderValue(patch.phone || patch.senderPhone, 32)
  };
  if (!sender.name || !sender.addressLine1 || !sender.postalCode || !sender.city) {
    throw Object.assign(new Error("Nom et adresse d'expédition vendeur obligatoires."), { status: 400 });
  }
  if (!/^[A-Z]{2}$/.test(sender.countryCode)) {
    throw Object.assign(new Error("Code pays expéditeur invalide."), { status: 400 });
  }
  getDb().prepare(`UPDATE mk_sellers
    SET sender_name=?, sender_address_line1=?, sender_address_line2=?, sender_postal_code=?, sender_city=?, sender_country_code=?, sender_phone=?
    WHERE id=?`).run(sender.name, sender.addressLine1, sender.addressLine2, sender.postalCode, sender.city, sender.countryCode, sender.phone, sellerId);
  return getSeller(sellerId);
}

export function getSellerSenderProfile(sellerId) {
  const seller = getSeller(sellerId);
  if (!seller) return null;
  return seller.sender;
}
export function updateSellerStats(sellerId) {
  const db = getDb();
  const sales = db.prepare("SELECT COUNT(*) AS c FROM mk_orders WHERE seller_id=? AND status IN ('paid','preparing','shipped','delivered')").get(sellerId)?.c ?? 0;
  const reviews = db.prepare("SELECT AVG(rating) AS avg, COUNT(*) AS c FROM mk_reviews WHERE seller_id=?").get(sellerId);
  const avg = reviews?.avg ? Math.round(reviews.avg * 10) / 10 : 0;
  const count = reviews?.c ?? 0;
  const satisfaction = count ? Math.round((reviews.avg / 5) * 100) : 100;
  db.prepare("UPDATE mk_sellers SET sales_count=?,rating_avg=?,rating_count=?,satisfaction_rate=? WHERE id=?").run(sales, avg, count, satisfaction, sellerId);
  return getSeller(sellerId);
}
export function addReview({ sellerId, orderId, buyerEmail, rating, comment }) {
  const now = new Date().toISOString();
  getDb().prepare("INSERT OR REPLACE INTO mk_reviews (seller_id,order_id,buyer_email,rating,comment,created_at) VALUES (?,?,?,?,?,?)").run(sellerId, orderId, buyerEmail, Math.min(5, Math.max(1, rating)), comment || "", now);
  return updateSellerStats(sellerId);
}
export function getSellerReviews(sellerId, limit = 20) {
  return getDb().prepare("SELECT rating,comment,created_at AS createdAt,buyer_email AS buyerEmail FROM mk_reviews WHERE seller_id=? ORDER BY created_at DESC LIMIT ?").all(sellerId, limit);
}
export function setSellerVerified(sellerId, verified) {
  getDb().prepare("UPDATE mk_sellers SET verified=? WHERE id=?").run(verified ? 1 : 0, sellerId);
  return getSeller(sellerId);
}
function toSeller(row) {
  const subscription = getSellerPlanState(row.id);
  return {
    id: row.id,
    email: row.email,
    authUserId: row.auth_user_id || "",
    displayName: row.display_name,
    sellerType: row.seller_type,
    verified: !!row.verified,
    avatar: row.avatar,
    bio: row.bio,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    salesCount: row.sales_count,
    satisfactionRate: row.satisfaction_rate,
    planId: subscription.planId,
    planStatus: subscription.status,
    planStartedAt: subscription.planStartedAt,
    subscriptionActive: subscription.active,
    paypalMerchantId: row.paypal_merchant_id || "",
    paypalTrackingId: row.paypal_tracking_id || "",
    paypalOnboardingStatus: row.paypal_onboarding_status || "",
    paypalPaymentsReceivable: !!row.paypal_payments_receivable,
    paypalEmailConfirmed: !!row.paypal_email_confirmed,
    paypalPermissionsGranted: !!row.paypal_permissions_granted,
    paypalConnectedAt: row.paypal_connected_at || "",
    paypalReady: !!(row.paypal_merchant_id && row.paypal_onboarding_status === "ready" && row.paypal_payments_receivable),
    sender: {
      name: row.sender_name || row.display_name || "",
      addressLine1: row.sender_address_line1 || "",
      addressLine2: row.sender_address_line2 || "",
      postalCode: row.sender_postal_code || "",
      city: row.sender_city || "",
      countryCode: row.sender_country_code || "FR",
      phone: row.sender_phone || ""
    },
    senderReady: !!(row.sender_name && row.sender_address_line1 && row.sender_postal_code && row.sender_city),
    createdAt: row.created_at
  };
}
export function listSellers(limit = 50) { return getDb().prepare("SELECT * FROM mk_sellers ORDER BY sales_count DESC LIMIT ?").all(limit).map(toSeller); }