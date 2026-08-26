/**
 * Initialisation du moteur Cardoria sans contenu de démonstration.
 * Les licences restent disponibles, mais aucune carte n'est créée automatiquement.
 */
import { ensureDefaultLicenses } from "./licenses.js";
import { getDb } from "./database.js";

export function seedEngineIfEmpty() {
  ensureDefaultLicenses();
  const count = getDb().prepare("SELECT COUNT(*) AS c FROM cards").get()?.c ?? 0;
  return { seeded: false, count, demoSeedDisabled: true };
}
