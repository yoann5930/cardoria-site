/**
 * Ingestion automatique — marketplace, estimations, feedback admin.
 */
import { getListing } from "../marketplace/listings.js";
import { getSeller } from "../marketplace/sellers.js";
import { recordMarketTransaction } from "./record.js";
import { makeTransactionId } from "./migrate.js";
import { recordActualSaleOutcomeSync } from "../ai-enterprise/index.js";

export function ingestMarketplaceOrder(order) {
  if (!order || order.status !== "paid") return null;

  const listing = getListing(order.listingId);
  if (!listing?.cardId) return null;

  const seller = getSeller(order.sellerId);

  return recordMarketTransaction({
    id: makeTransactionId("MK"),
    cardId: listing.cardId,
    type: "listing_sale",
    salePrice: order.unitPrice,
    condition: listing.condition,
    language: listing.language || "",
    license: listing.license,
    extension: listing.extension || "",
    number: listing.cardNumber || "",
    seller: seller?.displayName || seller?.email || order.sellerId,
    buyer: order.buyerName || order.buyerEmail,
    channel: "Marketplace Cardoria",
    sourceRef: order.id,
    transactionAt: (order.updatedAt || order.createdAt || new Date().toISOString()).slice(0, 10),
    notes: order.listingTitle
  });
}

export function ingestEstimationOutcome({
  analysisId,
  cardId,
  detection = {},
  buybackPrice,
  salePrice,
  condition,
  language,
  daysToSell
}) {
  if (!cardId) return null;

  const results = [];

  if (buybackPrice > 0) {
    results.push(recordMarketTransaction({
      id: makeTransactionId("BB"),
      cardId,
      type: "estimate_buyback",
      buybackPrice,
      condition,
      language: language || detection.language,
      license: detection.license,
      extension: detection.extension,
      number: detection.number,
      buyer: "Cardoria",
      channel: "Cardoria",
      sourceRef: analysisId,
      notes: "Offre rachat estimation IA"
    }));
  }

  if (salePrice > 0) {
    results.push(recordMarketTransaction({
      id: makeTransactionId("ES"),
      cardId,
      type: "sale",
      salePrice,
      condition,
      language: language || detection.language,
      license: detection.license,
      extension: detection.extension,
      number: detection.number,
      seller: detection.seller || "",
      daysToSell: daysToSell,
      channel: "Cardoria",
      sourceRef: analysisId,
      notes: "Prix revente estimé validé"
    }));
  }

  return results;
}

export function ingestAdminFeedbackOutcome({
  analysisId,
  cardId,
  detection = {},
  priceActualBuy,
  priceActualSell,
  resaleDelayDays,
  condition
}) {
  if (!cardId) return null;
  const results = [];

  if (priceActualBuy > 0) {
    results.push(recordMarketTransaction({
      id: makeTransactionId("AB"),
      cardId,
      type: "buyback",
      buybackPrice: priceActualBuy,
      condition,
      license: detection.license,
      extension: detection.extension,
      number: detection.number,
      buyer: "Cardoria",
      channel: "Cardoria",
      sourceRef: analysisId,
      notes: "Rachat réel admin"
    }));
  }

  if (priceActualSell > 0) {
    results.push(recordMarketTransaction({
      id: makeTransactionId("AS"),
      cardId,
      type: "sale",
      salePrice: priceActualSell,
      condition,
      license: detection.license,
      extension: detection.extension,
      number: detection.number,
      daysToSell: resaleDelayDays,
      channel: "Cardoria",
      sourceRef: analysisId,
      notes: "Revente réelle admin"
    }));
    try {
      recordActualSaleOutcomeSync({
        cardId,
        analysisId,
        actualSell: priceActualSell,
        saleDelayDays: resaleDelayDays
      });
    } catch { /* ignore */ }
  }

  return results;
}

export function ingestAdminManualSale(cardId, body) {
  return recordMarketTransaction({
    cardId,
    type: body.type || "admin_sale",
    salePrice: body.price || body.salePrice,
    buybackPrice: body.buybackPrice,
    condition: body.condition,
    language: body.language,
    seller: body.seller,
    buyer: body.buyer,
    daysToSell: body.daysToSell,
    channel: body.channel || "Cardoria",
    transactionAt: body.soldAt || body.transactionAt,
    notes: body.notes
  });
}
