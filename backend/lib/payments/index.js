import { migratePayments } from "./migrate.js";

export function initPayments() {
  migratePayments();
  return { ok: true, provider: "sumup" };
}

export {
  isSumUpConfigured,
  createSumUpCheckout,
  createCheckoutSession,
  createBoutiqueCheckout,
  retrieveSumUpCheckout,
  syncPaymentFromCheckout,
  handleSumUpWebhook,
  handleSumUpReturnCallback,
  verifySumUpWebhookSignature,
  mapSumUpStatus,
  applyPaymentStatus
} from "./sumup.js";

export { recordPayment, listPayments, getPayment, getPaymentByCheckoutId, updatePayment, PAYMENT_STATUSES } from "./ledger.js";
