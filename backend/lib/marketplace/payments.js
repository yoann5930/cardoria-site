/**
 * Ancien pont SumUp Marketplace — entièrement retiré.
 * Les fonctions exportées lèvent 410 et ne contactent plus SumUp.
 */
export {
  isSumUpConfigured,
  createCheckoutSession,
  createSumUpCheckout,
  handleSumUpWebhook,
  syncPaymentFromCheckout,
  retrieveSumUpCheckout
} from "../payments/sumup.js";
