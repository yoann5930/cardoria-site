import { getLiveActionState } from "./actions.js";

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function resolveLiveSaleRule({ live, product, customerEmail, requestedActionId = "", requestedSpotLabel = "" }) {
  if (!live || !product) throw Object.assign(new Error("Vente Live invalide."), { status: 400 });
  if (product.mode === "giveaway") throw Object.assign(new Error("Un giveaway ne peut pas etre achete."), { status: 409 });
  const state = getLiveActionState(live.id);
  const email = String(customerEmail || "").trim().toLowerCase();
  const actionId = String(requestedActionId || "").trim();
  const requestedSpot = String(requestedSpotLabel || "").trim();
  if (state.auction?.productId === product.id && (!actionId || actionId === state.auction.id)) {
    if (state.auction.status === "running") throw Object.assign(new Error("Cette enchere est encore en cours."), { status: 409 });
    if (state.auction.status === "ended" && state.auction.highestBidder) {
      const winner = String(state.auction.highestBidder.email || "").trim().toLowerCase();
      if (!winner || winner !== email) throw Object.assign(new Error("Seul le gagnant de l'enchere peut payer ce lot."), { status: 403 });
      return { kind: "auction", unitPrice: money(state.auction.currentPrice), actionId: state.auction.id, spotLabel: String(state.auction.spotLabel || ""), saleLabel: String(state.auction.productName || product.name) };
    }
  }
  const history = state.break?.productId === product.id && Array.isArray(state.break?.completedBoosters)
    ? state.break.completedBoosters
    : [];
  const historical = actionId
    ? history.find((item) => String(item.auctionId || "") === actionId)
    : requestedSpot
      ? history.find((item) => String(item.boosterLabel || "") === requestedSpot && String(item.winner?.email || "").trim().toLowerCase() === email)
      : null;
  if (historical) {
    const winner = String(historical.winner?.email || "").trim().toLowerCase();
    if (!winner || winner !== email) throw Object.assign(new Error("Seul le gagnant de cette enchere peut payer ce booster."), { status: 403 });
    return {
      kind: "auction",
      unitPrice: money(historical.amount),
      actionId: String(historical.auctionId || ""),
      spotLabel: String(historical.boosterLabel || ""),
      saleLabel: String(historical.productName || `#${historical.boosterNumber || ""} Booster ${product.name}`).trim()
    };
  }
  if (actionId) throw Object.assign(new Error("Cette enchere gagnee n'est plus disponible pour ce paiement."), { status: 409, code: "LIVE_AUCTION_HISTORY_NOT_FOUND" });
  if (state.flash?.productId === product.id && state.flash.status === "running" && new Date(state.flash.endsAt).getTime() > Date.now()) {
    return { kind: "flash", unitPrice: money(state.flash.price), actionId: state.flash.id };
  }
  if (state.break?.productId === product.id && state.break.status === "running") {
    return { kind: "break", unitPrice: money(state.break.pricePerSpot), actionId: state.break.id, breakType: String(state.break.breakType || "break"), spotLabels: Array.isArray(state.break.spotLabels) ? [...state.break.spotLabels] : [] };
  }
  return { kind: "buy_now", unitPrice: money(product.price), actionId: "" };
}
