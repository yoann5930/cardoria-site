/**
 * SumUp est retiré du runtime Cardoria.
 * Ce module ne fait plus aucun appel réseau. Il reste uniquement pour
 * les anciens imports et le contrôle syntaxique CI.
 */
export function isSumUpConfigured() {
  return false;
}

function gone(action = "opération SumUp") {
  const error = new Error(`SumUp n'est plus utilisé sur Cardoria (${action}). Boutique et Live Admin utilisent Revolut. Marketplace et Live vendeur utilisent PayPal.`);
  error.status = 410;
  error.provider = "retired";
  throw error;
}

export function mapSumUpStatus() {
  return "failed";
}

export async function retrieveSumUpCheckout() {
  gone("lecture checkout");
}

export async function createSumUpCheckout() {
  gone("création checkout");
}

export async function createCheckoutSession() {
  gone("session checkout");
}

export async function createBoutiqueCheckout() {
  gone("checkout boutique");
}

export async function syncPaymentFromCheckout() {
  gone("synchronisation");
}

export async function handleSumUpWebhook() {
  gone("webhook");
}

export const createPaymentLink = createSumUpCheckout;
