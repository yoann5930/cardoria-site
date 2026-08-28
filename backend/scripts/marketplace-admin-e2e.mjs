import crypto from "crypto";
import { getDb } from "../lib/engine/database.js";
import { getUserByEmail } from "../lib/auth/users.js";
import { registerSeller } from "../lib/marketplace/sellers.js";
import { createListingV1, updateListingV1 } from "../lib/marketplace/v1/listings.js";
import { createOrder } from "../lib/marketplace/orders.js";
import { createDispute } from "../lib/marketplace/v1/disputes.js";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const email = String(process.env.ADMIN_EMAIL || "ci-admin@cardoria.invalid").trim().toLowerCase();
const password = String(process.env.ADMIN_LOGIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD || "");

function assert(condition, message) { if (!condition) throw new Error(message); }
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = String(input || "").toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const c of str) { const val = alphabet.indexOf(c); if (val < 0) throw new Error("Invalid base32 secret"); bits += val.toString(2).padStart(5, "0"); }
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30); const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest(); const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function json(path, options = {}) { const response = await fetch(BASE + path, options); let body = {}; try { body = await response.json(); } catch {} return { response, body }; }
async function admin(path, token, options = {}) { options.headers = { ...(options.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" }; return json(path, options); }
async function loginSuperAdmin() {
  const first = await json("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert(first.response.status === 200 && first.body.requires2fa === true, "Admin login must require 2FA");
  const secret = first.body.setup?.secret || "";
  assert(secret, "Marketplace E2E requires clean auth DB and first 2FA setup");
  const verified = await json("/api/auth/2fa/login/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken: first.body.challengeToken, totpCode: totp(secret) }) });
  assert(verified.response.status === 200 && verified.body.token, "Admin 2FA verification failed");
  return { token: verified.body.token, actor: verified.body.user };
}

assert(password, "ADMIN password missing");
const { token, actor } = await loginSuperAdmin();
assert(actor?.role === "super_admin", "Marketplace E2E actor must be super_admin");
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const seller = registerSeller({ email: `seller-${suffix}@cardoria.invalid`, displayName: "Marketplace E2E Seller", sellerType: "professional", bio: "E2E", authUserId: actor.id });
const listing = createListingV1({ sellerId: seller.id, title: `Carte E2E ${suffix}`, description: "Annonce de test moderation", price: 19.9, stock: 3, status: "active" });

const before = await admin("/api/admin/marketplace/listings", token);
assert(before.response.status === 200 && before.body.listings?.some((x) => x.id === listing.id), "Admin listing inventory missing test listing");

const noReason = await admin(`/api/admin/marketplace/listings/${listing.id}/moderation`, token, { method: "PUT", body: JSON.stringify({ status: "suspended", reason: "" }) });
assert(noReason.response.status === 400, "Suspension without reason must be rejected");

const suspended = await admin(`/api/admin/marketplace/listings/${listing.id}/moderation`, token, { method: "PUT", body: JSON.stringify({ status: "suspended", reason: "Photo ou description à vérifier" }) });
assert(suspended.response.status === 200 && suspended.body.listing?.status === "suspended", "Admin suspension failed");
assert(suspended.body.listing?.moderationLocked === true, "Admin suspension must lock listing");
assert(suspended.body.listing?.moderatedBy === email, "Moderator identity missing");

const hidden = await json(`/api/marketplace/v1/listings/${listing.id}`);
assert(hidden.response.status === 404, "Suspended listing remains publicly accessible");
let sellerBypassBlocked = false;
try { updateListingV1(listing.id, seller.id, { status: "active" }); } catch (error) { sellerBypassBlocked = error?.status === 409; }
assert(sellerBypassBlocked, "Seller can bypass Cardoria moderation lock");

const reactivated = await admin(`/api/admin/marketplace/listings/${listing.id}/moderation`, token, { method: "PUT", body: JSON.stringify({ status: "active" }) });
assert(reactivated.response.status === 200 && reactivated.body.listing?.status === "active" && reactivated.body.listing?.moderationLocked === false, "Admin reactivation failed");
const visible = await json(`/api/marketplace/v1/listings/${listing.id}`);
assert(visible.response.status === 200 && visible.body.listing?.id === listing.id, "Reactivated listing not publicly visible");

const order = createOrder({ listingId: listing.id, buyerEmail: `buyer-${suffix}@cardoria.invalid`, buyerName: "Buyer E2E", buyerId: `buyer-${suffix}`, qty: 1, shippingCarrier: "colissimo", shippingCost: 2.5, shippingAddress: "Test" });
const dispute = createDispute({ orderId: order.id, buyerEmail: order.buyerEmail, reason: "Carte reçue non conforme à la description" });

const disputes = await admin("/api/admin/marketplace/disputes", token);
assert(disputes.response.status === 200 && disputes.body.disputes?.some((x) => x.id === dispute.id), "Admin disputes list missing test dispute");

const badClose = await admin(`/api/admin/marketplace/disputes/${dispute.id}/manage`, token, { method: "PUT", body: JSON.stringify({ status: "resolved", resolutionCode: "agreement", resolution: "" }) });
assert(badClose.response.status === 400, "Resolved dispute without resolution must be rejected");

const investigating = await admin(`/api/admin/marketplace/disputes/${dispute.id}/manage`, token, { method: "PUT", body: JSON.stringify({ status: "investigating", priority: "urgent", adminNote: "Vérifier les photos vendeur et acheteur" }) });
assert(investigating.response.status === 200 && investigating.body.dispute?.status === "investigating" && investigating.body.dispute?.priority === "urgent", "Dispute investigation update failed");

const resolved = await admin(`/api/admin/marketplace/disputes/${dispute.id}/manage`, token, { method: "PUT", body: JSON.stringify({ status: "resolved", priority: "high", resolutionCode: "agreement", resolution: "Accord validé entre les deux parties", adminNote: "Dossier clôturé après vérification" }) });
assert(resolved.response.status === 200 && resolved.body.dispute?.status === "resolved", "Dispute resolution failed");
assert(resolved.body.dispute?.resolvedBy === email, "Resolved-by Admin identity missing");

const detail = await admin(`/api/admin/marketplace/disputes/${dispute.id}/detail`, token);
assert(detail.response.status === 200 && detail.body.dispute?.history?.length >= 3, "Durable dispute history missing");
assert(detail.body.dispute.history.some((e) => e.toStatus === "investigating"), "Investigation event missing from dispute history");
assert(detail.body.dispute.history.some((e) => e.toStatus === "resolved"), "Resolution event missing from dispute history");
const dbRow = getDb().prepare("SELECT history_json, resolved_by, resolution_code FROM mk_disputes WHERE id=?").get(dispute.id);
assert(String(dbRow?.history_json || "").includes("investigating") && dbRow?.resolved_by === email && dbRow?.resolution_code === "agreement", "Authoritative dispute persistence fields missing");

const invalidTransition = await admin(`/api/admin/marketplace/disputes/${dispute.id}/manage`, token, { method: "PUT", body: JSON.stringify({ status: "open", resolution: "Réouverture invalide" }) });
assert(invalidTransition.response.status === 409, "Invalid resolved-to-open transition must be blocked");

const removed = await admin(`/api/admin/marketplace/listings/${listing.id}/moderation`, token, { method: "PUT", body: JSON.stringify({ status: "removed", reason: "Annonce retirée après contrôle E2E" }) });
assert(removed.response.status === 200 && removed.body.listing?.status === "removed" && removed.body.listing?.moderationLocked === true, "Admin listing removal failed");
const removedPublic = await json(`/api/marketplace/v1/listings/${listing.id}`);
assert(removedPublic.response.status === 404, "Removed listing remains public");

await json("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
console.log("MARKETPLACE_ADMIN_E2E_PASS");
