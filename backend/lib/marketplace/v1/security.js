/**
 * Sécurité marketplace v1 — droits vendeur / acheteur / admin.
 */
import { getListing } from "../listings.js";
import { getOrder } from "../orders.js";
import { getSeller } from "../sellers.js";

export class MarketplaceAuthError extends Error {
  constructor(message, code = 403) {
    super(message);
    this.code = code;
  }
}

export function assertSellerOwnsListing(sellerId, listingId) {
  const listing = getListing(listingId);
  if (!listing) throw new MarketplaceAuthError("Annonce introuvable", 404);
  if (listing.sellerId !== sellerId) throw new MarketplaceAuthError("Accès refusé — annonce d'un autre vendeur");
  return listing;
}

export function assertSellerSession(body, query = {}) {
  const sellerId = body?.sellerId || query?.sellerId;
  const sellerEmail = body?.sellerEmail || query?.sellerEmail;
  if (!sellerId) throw new MarketplaceAuthError("Identifiant vendeur requis");
  const seller = getSeller(sellerId);
  if (!seller) throw new MarketplaceAuthError("Vendeur introuvable", 404);
  if (sellerEmail && seller.email.toLowerCase() !== String(sellerEmail).toLowerCase()) {
    throw new MarketplaceAuthError("Session vendeur invalide");
  }
  return seller;
}

export function assertBuyerOwnsOrder(orderId, buyerEmail, buyerId = "") {
  const order = getOrder(orderId);
  if (!order) throw new MarketplaceAuthError("Commande introuvable", 404);
  const emailOk = buyerEmail && order.buyerEmail.toLowerCase() === String(buyerEmail).toLowerCase();
  const idOk = buyerId && order.buyerId === buyerId;
  if (!emailOk && !idOk) throw new MarketplaceAuthError("Accès refusé — commande d'un autre client");
  return order;
}

export function validateServerSidePrice(listingId, clientPrice, qty = 1) {
  const listing = getListing(listingId);
  if (!listing || listing.status !== "active") throw new MarketplaceAuthError("Annonce indisponible", 400);
  if (listing.stock < qty) throw new MarketplaceAuthError("Stock insuffisant", 400);
  const serverTotal = Math.round(listing.price * qty * 100) / 100;
  const clientTotal = Math.round(Number(clientPrice) * 100) / 100;
  if (Math.abs(serverTotal - clientTotal) > 0.02) {
    throw new MarketplaceAuthError("Prix invalidé — actualisez le panier", 409);
  }
  return { listing, serverTotal };
}
