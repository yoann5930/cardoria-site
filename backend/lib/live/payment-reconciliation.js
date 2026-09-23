/** Safe release of stale Live payment reservations after provider verification. */
import { logAudit } from "../audit.js";
import { mapSumUpStatus, retrieveSumUpCheckout } from "../payments/sumup.js";
import { mapLivePayPalOrderStatus, retrieveLivePayPalOrder } from "../marketplace/paypal.js";
import { applyVerifiedLiveCapture } from "./paypal-capture-validation.js";
import { applyLivePaymentStatus, getLiveCheckout, listLiveCheckouts, saveLiveCheckout, withLiveLock } from "./sessions.js";
import { isCheckoutReservationDue } from "./checkout-reservations.js";
import { isSameLiveBuyer, normalizeCheckoutStatus } from "./checkout-lifecycle.js";

function providerName(checkout) {
  return String(checkout?.provider || checkout?.paymentProvider || "").trim().toLowerCase();
}

function completedPayPalCapture(order) {
  for (const unit of order?.purchase_units || []) {
    for (const capture of unit?.payments?.captures || []) {
      if (String(capture?.status || "").toUpperCase() !== "COMPLETED") continue;
      return {
        capture: { ...capture, custom_id: capture.custom_id || unit.custom_id || "" },
        merchantId: String(capture?.payee?.merchant_id || unit?.payee?.merchant_id || "")
      };
    }
  }
  return null;
}

function sumUpTransactionId(checkout) {
  const tx = checkout?.transactions?.[0];
  return String(tx?.id || tx?.transaction_code || checkout?.transaction_code || "");
}

export async function resolveLiveCheckoutProviderState(checkout) {
  const provider = providerName(checkout);
  if (provider === "sumup") {
    const raw = await retrieveSumUpCheckout(checkout.paymentProviderOrderId);
    return {
      provider,
      status: mapSumUpStatus(raw.status),
      providerStatus: String(raw.status || ""),
      transactionId: sumUpTransactionId(raw),
      raw
    };
  }
  if (provider === "paypal") {
    const raw = await retrieveLivePayPalOrder(checkout.paymentProviderOrderId, checkout.ownerId);
    const completed = completedPayPalCapture(raw);
    return {
      provider,
      status: completed ? "paid" : mapLivePayPalOrderStatus(raw.status),
      providerStatus: String(raw.status || ""),
      capture: completed?.capture || null,
      merchantId: completed?.merchantId || "",
      raw
    };
  }
  throw Object.assign(new Error("Fournisseur de paiement Live inconnu."), { status: 409, code: "LIVE_PAYMENT_PROVIDER_UNKNOWN" });
}

function markProviderVerified(checkout, patch = {}) {
  return saveLiveCheckout({
    ...checkout,
    ...patch,
    lastReconciledAt: new Date().toISOString(),
    lastReconciliationError: "",
    updatedAt: new Date().toISOString()
  });
}

function releaseReservation(checkout, providerStatus) {
  const now = new Date().toISOString();
  return saveLiveCheckout({
    ...checkout,
    status: "expired",
    providerLastStatus: String(providerStatus || ""),
    reservationReleasedAt: now,
    reservationReleaseReason: "provider_pending_after_timeout",
    lastReconciledAt: now,
    lastReconciliationError: "",
    updatedAt: now
  });
}

export async function reconcileLiveCheckoutReservation(checkout, { now = Date.now(), resolveProvider = resolveLiveCheckoutProviderState } = {}) {
  const initial = getLiveCheckout(checkout?.id) || checkout;
  if (!initial || normalizeCheckoutStatus(initial.status) !== "pending") return { checkout: initial || null, skipped: true, reason: "not_pending" };
  if (!isCheckoutReservationDue(initial, { now })) return { checkout: initial, skipped: true, reason: "not_due" };
  if (!initial.paymentProviderOrderId) return { checkout: initial, skipped: true, reason: "provider_id_missing" };

  return withLiveLock(`live-payment-reconcile:${initial.id}`, async () => {
    const current = getLiveCheckout(initial.id) || initial;
    if (normalizeCheckoutStatus(current.status) !== "pending" || !isCheckoutReservationDue(current, { now })) {
      return { checkout: current, skipped: true, reason: "changed" };
    }

    let providerState;
    try {
      providerState = await resolveProvider(current);
    } catch (error) {
      const updated = saveLiveCheckout({
        ...current,
        lastReconciledAt: new Date().toISOString(),
        lastReconciliationError: String(error?.code || error?.status || "provider_error").slice(0, 80),
        updatedAt: new Date().toISOString()
      });
      console.warn(`[live-payment] reconciliation deferred checkout=${current.id} provider=${providerName(current)} code=${error?.code || error?.status || "provider_error"}`);
      return { checkout: updated, deferred: true, error };
    }

    const normalized = normalizeCheckoutStatus(providerState?.status);
    if (normalized === "paid") {
      if (providerName(current) === "paypal") {
        if (!providerState.capture) {
          const updated = markProviderVerified(current, {
            status: "reconciliation_required",
            providerLastStatus: providerState.providerStatus || "",
            paymentReconciliationReason: "paypal_completed_without_verified_capture"
          });
          return { checkout: updated, reconciliationRequired: true };
        }
        const result = applyVerifiedLiveCapture(current, providerState.capture, {
          paypalOrderId: current.paymentProviderOrderId,
          merchantId: providerState.merchantId || ""
        });
        const updated = getLiveCheckout(current.id) || current;
        logAudit({ type: "payment", action: "live_stale_payment_reconciled", user: current.customerEmail || "client", detail: `${current.id} paypal paid` });
        return { checkout: updated, settled: true, result };
      }
      const updated = applyLivePaymentStatus(current.id, "paid", {
        paymentProviderOrderId: current.paymentProviderOrderId,
        paymentProviderTransactionId: providerState.transactionId || ""
      });
      logAudit({ type: "payment", action: "live_stale_payment_reconciled", user: current.customerEmail || "client", detail: `${current.id} sumup paid` });
      return { checkout: updated, settled: true };
    }

    if (["failed", "refunded"].includes(normalized)) {
      const updated = applyLivePaymentStatus(current.id, normalized, {
        paymentProviderOrderId: current.paymentProviderOrderId,
        paymentProviderTransactionId: providerState.transactionId || ""
      });
      return { checkout: updated, released: true, providerStatus: normalized };
    }

    if (["authorized", "authorised"].includes(normalized)) {
      const updated = markProviderVerified(current, {
        status: "authorized",
        providerLastStatus: providerState.providerStatus || "",
        reservationExpiresAt: ""
      });
      return { checkout: updated, protected: true, providerStatus: "authorized" };
    }

    const updated = releaseReservation(current, providerState?.providerStatus);
    logAudit({ type: "payment", action: "live_stale_reservation_released", user: current.customerEmail || "client", detail: `${current.id} ${providerName(current)} pending` });
    return { checkout: updated, released: true, providerStatus: "pending" };
  });
}

export async function reconcileStaleLiveCheckouts({ liveId = "", customerId = "", customerEmail = "", now = Date.now(), resolveProvider, limit = 50 } = {}) {
  const candidates = listLiveCheckouts({ liveId: liveId || undefined })
    .filter((checkout) => normalizeCheckoutStatus(checkout.status) === "pending")
    .filter((checkout) => isCheckoutReservationDue(checkout, { now }))
    .filter((checkout) => !customerId && !customerEmail ? true : isSameLiveBuyer(checkout, { customerId, customerEmail }))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));

  const results = [];
  for (const checkout of candidates) {
    results.push(await reconcileLiveCheckoutReservation(checkout, { now, resolveProvider }));
  }
  return {
    checked: results.length,
    released: results.filter((item) => item?.released).length,
    settled: results.filter((item) => item?.settled).length,
    deferred: results.filter((item) => item?.deferred).length,
    results
  };
}
