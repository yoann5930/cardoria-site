import { getDb } from "../engine/database.js";

/**
 * Aucun vendeur ni aucune annonce de démonstration ne doit être créé automatiquement.
 * La Marketplace reste vide jusqu'à la publication de vraies annonces.
 */
export function seedMarketplaceIfEmpty() {
  const count = getDb().prepare("SELECT COUNT(*) AS c FROM mk_listings").get()?.c ?? 0;
  return { seeded: false, count, demoSeedDisabled: true };
}
