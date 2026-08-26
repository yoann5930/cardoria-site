/**
 * Controle d'acces Marketplace Cardoria.
 * L'identite ne vient jamais du body/query : elle provient d'une session Cardoria.
 */
import { validateSession } from "../../auth/session.js";
import { getSeller, getSellerByEmail } from "../sellers.js";
import { getListing } from "../listings.js";
import { getOrder } from "../orders.js";

export class MarketplaceAuthError extends Error {
  constructor(message = "Acces refuse", code = 403) {
    super(message);
    this.name = "MarketplaceAuthError";
    this.code = code;
    this.status = code;
  }
}

export function getMarketplaceUser(req) {
  const header = String(req?.headers?.authorization || "");
  const token = header.replace(/^Bearer\s+/i, "") || String(req?.headers?.["x-session-token"] || "");
  const user = validateSession(token);
  if (!user) throw new MarketplaceAuthError("Connexion Cardoria requise.", 401);
  return user;
}

export function assertSellerSession(req, expectedSellerId = "") {
  const user = getMarketplaceUser(req);
  const seller = getSellerByEmail(String(user.email || "").toLowerCase());
  if (!seller) throw new MarketplaceAuthError("Compte vendeur introuvable.", 403);
  if (expectedSellerId && seller.id !== String(expectedSellerId)) throw new MarketplaceAuthError("Ce compte ne possede pas ce profil vendeur.", 403);
  return seller;
}

export function assertSellerOwnsListing(req, listingId) {
  const seller = assertSellerSession(req);
  const listing = getListing(listingId);
  if (!listing) throw new MarketplaceAuthError("Annonce introuvable.", 404);
  if (listing.sellerId !== seller.id) throw new MarketplaceAuthError("Cette annonce ne vous appartient pas.", 403);
  return { seller, listing };
}

export function assertBuyerOwnsOrder(req, orderId) {
  const user = getMarketplaceUser(req);
  const order = getOrder(orderId);
  if (!order) throw new MarketplaceAuthError("Commande introuvable.", 404);
  const emailMatches = String(order.buyerEmail || "").toLowerCase() === String(user.email || "").toLowerCase();
  const idMatches = order.buyerId && String(order.buyerId) === String(user.id);
  if (!emailMatches && !idMatches) throw new MarketplaceAuthError("Cette commande ne vous appartient pas.", 403);
  return { user, order };
}

export function assertOrderParticipant(req, orderId) {
  const user = getMarketplaceUser(req);
  const order = getOrder(orderId);
  if (!order) throw new MarketplaceAuthError("Commande introuvable.", 404);
  const buyer = String(order.buyerEmail || "").toLowerCase() === String(user.email || "").toLowerCase() || String(order.buyerId || "") === String(user.id);
  const seller = getSellerByEmail(String(user.email || "").toLowerCase());
  if (!buyer && (!seller || seller.id !== order.sellerId)) throw new MarketplaceAuthError("Acces refuse a cette commande.", 403);
  return { user, order, seller: seller || null };
}

export function assertSellerOwnsOrder(req, orderId, expectedSellerId = "") {
  const seller = assertSellerSession(req, expectedSellerId);
  const order = getOrder(orderId);
  if (!order) throw new MarketplaceAuthError("Commande introuvable.", 404);
  if (order.sellerId !== seller.id) throw new MarketplaceAuthError("Cette commande ne vous appartient pas.", 403);
  return { seller, order };
}
