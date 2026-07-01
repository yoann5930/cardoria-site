/**
 * Comparateur automatique des prix — annonces vs moteur cartes vs marché.
 */
import { getListing, getListingsByCardId, searchListings } from "./listings.js";
import { getCardById } from "../engine/cards.js";
import { estimatePrice } from "../engine/pricing.js";

export function comparePrices({ listingId, cardId, q }) {
  let listing = listingId ? getListing(listingId) : null;
  const cid = cardId || listing?.cardId;

  let catalog = cid ? getCardById(cid) : null;
  let engineEstimate = cid ? estimatePrice(cid, listing?.condition?.toLowerCase() || "nm") : null;

  let marketplaceListings = [];
  if (cid) {
    marketplaceListings = getListingsByCardId(cid);
  } else if (listing) {
    marketplaceListings = searchListings({ q: listing.title, limit: 10 }).listings.filter((l) => l.id !== listing.id);
  } else if (q) {
    marketplaceListings = searchListings({ q, limit: 10 }).listings;
  }

  const prices = [];
  if (listing) prices.push({ source: "Cette annonce", price: listing.price, type: "listing", id: listing.id });
  if (catalog) {
    prices.push({ source: "Prix moteur Cardoria (conseillé)", price: catalog.prices.recommended, type: "engine" });
    prices.push({ source: "Prix bas marché (moteur)", price: catalog.prices.low, type: "engine_low" });
    prices.push({ source: "Prix haut marché (moteur)", price: catalog.prices.high, type: "engine_high" });
  }
  if (engineEstimate) {
    prices.push({ source: "Estimation état " + engineEstimate.condition.toUpperCase(), price: engineEstimate.recommended, type: "estimate" });
  }

  marketplaceListings.slice(0, 5).forEach((l) => {
    prices.push({ source: `Annonce : ${l.seller?.displayName || "Vendeur"}`, price: l.price, type: "marketplace", id: l.id });
  });

  const sorted = [...prices].sort((a, b) => a.price - b.price);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const reference = listing?.price || catalog?.prices.recommended || sorted[0]?.price;
  const savings = reference && best ? Math.round((reference - best.price) * 100) / 100 : 0;

  return {
    listing: listing ? { id: listing.id, title: listing.title, price: listing.price } : null,
    catalog: catalog ? { id: catalog.id, name: catalog.name, prices: catalog.prices } : null,
    comparison: sorted,
    summary: {
      lowest: best,
      highest: worst,
      average: sorted.length ? Math.round(sorted.reduce((s, p) => s + p.price, 0) / sorted.length * 100) / 100 : 0,
      potentialSavings: savings > 0 ? savings : 0,
      recommendation: savings > 5 ? "Meilleur prix détecté ailleurs sur Cardoria" : "Prix compétitif"
    }
  };
}
