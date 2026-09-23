/** Reservation windows for Live quotes and provider checkouts. */
import { UNSETTLED_LIVE_PAYMENT_STATUSES, normalizeCheckoutStatus } from "./checkout-lifecycle.js";

function boundedMs(value, fallback, minimum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(minimum, Math.trunc(parsed));
}

export const LIVE_PLAN_RESERVATION_MS = boundedMs(process.env.LIVE_PLAN_RESERVATION_MS, 5 * 60 * 1000, 60 * 1000);
export const LIVE_PENDING_RESERVATION_MS = boundedMs(process.env.LIVE_PENDING_RESERVATION_MS, 20 * 60 * 1000, 5 * 60 * 1000);

function parseTime(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

export function reservationExpiryForStatus(status, now = Date.now()) {
  const normalized = normalizeCheckoutStatus(status);
  const ttl = normalized === "planned"
    ? LIVE_PLAN_RESERVATION_MS
    : normalized === "pending"
      ? LIVE_PENDING_RESERVATION_MS
      : 0;
  return ttl ? new Date(Number(now) + ttl).toISOString() : "";
}

export function checkoutReservationExpiryMs(checkout) {
  const explicit = parseTime(checkout?.reservationExpiresAt);
  if (Number.isFinite(explicit)) return explicit;
  const status = normalizeCheckoutStatus(checkout?.status);
  const base = parseTime(checkout?.reservationStartedAt || checkout?.updatedAt || checkout?.createdAt);
  if (!Number.isFinite(base)) return NaN;
  if (status === "planned") return base + LIVE_PLAN_RESERVATION_MS;
  if (status === "pending") return base + LIVE_PENDING_RESERVATION_MS;
  return NaN;
}

export function isCheckoutReservationDue(checkout, { now = Date.now() } = {}) {
  const status = normalizeCheckoutStatus(checkout?.status);
  if (!["planned", "pending"].includes(status)) return false;
  const expiresAt = checkoutReservationExpiryMs(checkout);
  return Number.isFinite(expiresAt) && Number(now) >= expiresAt;
}

export function liveCheckoutReservationHolds(checkout, { now = Date.now() } = {}) {
  if (!checkout || checkout.reservationReleasedAt) return false;
  const status = normalizeCheckoutStatus(checkout.status);
  if (status === "planned") return !isCheckoutReservationDue(checkout, { now });
  if (status === "pending") return true; // Provider must be checked before release.
  return UNSETTLED_LIVE_PAYMENT_STATUSES.has(status);
}

export function withFreshReservation(checkout, status, { now = Date.now() } = {}) {
  const stamp = new Date(Number(now)).toISOString();
  const reservationExpiresAt = reservationExpiryForStatus(status, now);
  return {
    ...checkout,
    status,
    reservationStartedAt: stamp,
    reservationExpiresAt,
    reservationReleasedAt: "",
    reservationReleaseReason: ""
  };
}
