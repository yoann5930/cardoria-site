/**
 * Mode de démonstration temporaire de la Marketplace Cardoria.
 *
 * IMPORTANT : ce flag est volontairement activé pendant la phase de construction
 * de la Marketplace afin de permettre l'accès vendeur sans onboarding PayPal réel.
 * Il ne doit jamais être utilisé pour contourner le checkout acheteur PayPal.
 *
 * Nettoyage final Marketplace : passer DEMO_MODE_ENABLED à false puis supprimer
 * les bypass associés une fois l'étape Marketplace totalement validée.
 */
const DEMO_MODE_ENABLED = true;

export function isMarketplaceDemoMode() {
  return DEMO_MODE_ENABLED;
}
