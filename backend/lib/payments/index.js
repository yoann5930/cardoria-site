import { migratePayments } from "./migrate.js";

export function initPayments() {
  migratePayments();
  return { ok: true, provider: "revolut" };
}

export {
  isRevolutConfigured,
  getRevolutEnvironment,
  getRevolutApiBase,
  createRevolutCheckout,
  retrieveRevolutOrder,
  syncRevolutOrder,
  syncRevolutOrderByCardoriaOrder,
  refundRevolutOrder,
  handleRevolutWebhook,
  verifyRevolutWebhookSignature,
  mapRevolutOrderStatus
} from "./revolut.js";

// Stubs SumUp retirés du runtime (410). Conservés pour les anciens imports.
export {
  isSumUpConfigured,
  retrieveSumUpCheckout,
  syncPaymentFromCheckout
} from "./sumup.js";

export {
  recordPayment,
  listPayments,
  getPayment,
  getPaymentByCheckoutId,
  getPaymentByProviderOrderId,
  getPaymentByOrderId,
  updatePayment,
  PAYMENT_STATUSES
} from "./ledger.js";
