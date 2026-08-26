/**
 * Mode de démonstration Marketplace Cardoria.
 *
 * En production le mode demo est DESACTIVE par defaut. Il ne peut etre active
 * que par une variable d'environnement explicite hors production, afin qu'un
 * oubli de configuration ne puisse jamais ouvrir un bypass de paiement ou
 * d'onboarding vendeur.
 */
export function isMarketplaceDemoMode() {
  const requested = String(process.env.MARKETPLACE_DEMO_MODE || "").trim().toLowerCase();
  const enabled = ["1", "true", "yes", "on"].includes(requested);
  if (process.env.NODE_ENV === "production") return false;
  return enabled;
}
