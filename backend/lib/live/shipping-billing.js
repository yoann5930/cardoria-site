/** Buyer postage policy confirmed by Cardoria: 10 EUR of cumulative paid items per live. */
import { isSameLiveBuyer, SETTLED_LIVE_PAYMENT_STATUSES } from "./checkout-lifecycle.js";

export const LIVE_POSTAGE_THRESHOLD_CENTS = 1000;
export const LIVE_POSTAGE_POLICY_VERSION = "cumulative-10-v1";
function cents(value) {
  if (value == null || value === "") return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw Object.assign(new Error("Montant d'achat invalide."), { status: 409, code: "LIVE_AMOUNT_INVALID" });
  const result = Math.round((number + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(result)) throw Object.assign(new Error("Montant d'achat trop élevé."), { status: 409, code: "LIVE_AMOUNT_INVALID" });
  return result;
}
export function livePurchaseProgress({ checkouts = [], liveId, ownerId, customerId = "", customerEmail, currentItemAmount = 0, excludeCheckoutId = "" }) {
  const seen = new Set();
  const paid = checkouts.filter(checkout => {
    if (checkout.liveId !== liveId || checkout.id === excludeCheckoutId) return false;
    if (ownerId && checkout.ownerId && checkout.ownerId !== ownerId) return false;
    if (!isSameLiveBuyer(checkout, { customerId, customerEmail })) return false;
    if (!SETTLED_LIVE_PAYMENT_STATUSES.has(String(checkout.status || "").toLowerCase())) return false;
    if (checkout.id && seen.has(checkout.id)) return false;
    if (checkout.id) seen.add(checkout.id);
    return true;
  });
  const paidItemCents = paid.reduce((sum, checkout) => sum + cents(checkout.itemAmount), 0);
  const buyerPostageCents = paid.reduce((sum, checkout) => sum + cents(checkout.shippingAmount), 0);
  const proposedItemCents = cents(currentItemAmount);
  return {
    paid, paidItemCents, proposedItemCents, cumulativeItemCents: paidItemCents + proposedItemCents,
    buyerPostageCents, thresholdCents: LIVE_POSTAGE_THRESHOLD_CENTS,
    alreadyQualified: paidItemCents >= LIVE_POSTAGE_THRESHOLD_CENTS,
    qualifiesWithThisPurchase: paidItemCents + proposedItemCents >= LIVE_POSTAGE_THRESHOLD_CENTS
  };
}
export function quoteLivePostage({ checkouts, liveId, ownerId, customerId, customerEmail, currentItemAmount, shippingTarget, planCovered = false, giveawayWinner = false, excludeCheckoutId = "" }) {
  const progress = livePurchaseProgress({ checkouts, liveId, ownerId, customerId, customerEmail, currentItemAmount, excludeCheckoutId });
  const targetCents = cents(shippingTarget);
  const covered = planCovered || progress.paid.some(checkout => checkout.shippingCoveredBySellerPlan === true);
  let buyerCents = 0, payer = "buyer", locked = false;
  if (covered) { payer = "cardoria"; locked = true; }
  else if (progress.alreadyQualified && progress.buyerPostageCents > 0) { locked = true; }
  else if (giveawayWinner && !progress.qualifiesWithThisPurchase) { payer = "streamer"; }
  else {
    // Credit postage already collected; never charge the full target a second time.
    buyerCents = Math.max(0, targetCents - progress.buyerPostageCents);
    locked = progress.qualifiesWithThisPurchase && targetCents > 0;
  }
  return {
    buyerAmount: buyerCents / 100, payer, locked, giveawayWinner,
    qualifyingGiveawayPurchase: progress.qualifiesWithThisPurchase,
    priorPaidItems: progress.paidItemCents / 100,
    cumulativeItems: progress.cumulativeItemCents / 100,
    buyerPostageAlreadyPaid: progress.buyerPostageCents / 100,
    thresholdEur: LIVE_POSTAGE_THRESHOLD_CENTS / 100,
    thresholdReachedBeforePurchase: progress.alreadyQualified,
    thresholdReachedWithPurchase: progress.qualifiesWithThisPurchase,
    policyVersion: LIVE_POSTAGE_POLICY_VERSION
  };
}
