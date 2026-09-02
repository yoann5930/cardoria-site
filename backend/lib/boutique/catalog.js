/**
 * Compatibilite Boutique : une seule source de stock.
 *
 * Le stock public Boutique et la validation checkout doivent utiliser exactement
 * le meme moteur que l'administration Stock : achats Pokemon payes, preferences
 * Boutique, reservations, ventes et remboursements.
 *
 * Ce pont conserve les imports historiques vers catalog.js sans maintenir une
 * seconde source basee sur products.json.
 */
export { listBoutiqueProducts, getBoutiqueProduct } from "./stock.js";
