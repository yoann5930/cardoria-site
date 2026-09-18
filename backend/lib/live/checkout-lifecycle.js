/** Lifecycle guards shared by checkout planning and carrier preparation. */
export const UNSETTLED_LIVE_PAYMENT_STATUSES = new Set([
  "creating", "pending", "authorized", "authorised", "reconciliation_required"
]);
export const SETTLED_LIVE_PAYMENT_STATUSES = new Set(["paid", "completed"]);
export const normalizeCheckoutStatus = value => String(value || "").toLowerCase();
const emailKey = value => String(value || "").trim().toLowerCase();
const conflict = (message, code) => Object.assign(new Error(message), { status: 409, code });

export function isSameLiveBuyer(checkout, { customerId = "", customerEmail = "" } = {}) {
  if (checkout.customerId && customerId) return String(checkout.customerId) === String(customerId);
  return Boolean(emailKey(customerEmail)) && emailKey(checkout.customerEmail) === emailKey(customerEmail);
}

export function assertCheckoutOwnership(checkout, customerId) {
  if (checkout && customerId && String(checkout.customerId || "") !== String(customerId)) {
    // A legacy guest quote must not reveal a stored address just because someone
    // later registers an account using the email that was typed into that quote.
    throw conflict("Ce paiement historique doit être vérifié avant réutilisation.", "LIVE_CHECKOUT_IDENTITY_UNVERIFIED");
  }
}

export function assertNoOtherUnsettledCheckout(checkouts, { liveId, customerId, customerEmail, excludeId = "" }) {
  const other = checkouts.find(checkout => checkout.liveId === liveId && checkout.id !== excludeId &&
    isSameLiveBuyer(checkout, { customerId, customerEmail }) &&
    UNSETTLED_LIVE_PAYMENT_STATUSES.has(normalizeCheckoutStatus(checkout.status)));
  if (other) throw conflict("Un paiement de ce Live est déjà en cours. Terminez-le avant un nouvel achat.", "LIVE_PAYMENT_PENDING");
}

export function assertExistingCheckoutReusable(checkout) {
  if (!checkout) return;
  const status = normalizeCheckoutStatus(checkout.status);
  if (SETTLED_LIVE_PAYMENT_STATUSES.has(status)) throw conflict("Ce paiement Live a déjà été traité.", "LIVE_PAYMENT_ALREADY_SETTLED");
  if (["creating", "reconciliation_required"].includes(status)) {
    throw conflict("Une tentative de paiement doit être rapprochée avant toute nouvelle création.", "LIVE_PAYMENT_RECONCILIATION_REQUIRED");
  }
  if (["authorized", "authorised"].includes(status)) throw conflict("Le paiement est autorisé mais pas encore encaissé.", "LIVE_PAYMENT_PENDING");
  if (status === "pending" && (!checkout.url || !checkout.paymentProviderOrderId)) {
    throw conflict("Le paiement en attente est incomplet et doit être vérifié.", "LIVE_PAYMENT_RECONCILIATION_REQUIRED");
  }
}

export function normalizeCheckoutRequestId(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(value)) {
    throw Object.assign(new Error("Identifiant de demande de paiement invalide."), { status: 400, code: "LIVE_REQUEST_ID_INVALID" });
  }
  return value;
}
