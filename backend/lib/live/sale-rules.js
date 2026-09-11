import { getLiveActionState } from "./actions.js";

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function resolveLiveSaleRule({ live, product, customerEmail }) {
  if (!live || !product) throw Object.assign(new Error("Vente Live invalide."), { status: 400 });
  if (product.mode === "giveaway") throw Object.assign(new Error("Un giveaway ne peut pas etre achete."), { status: 409 });
  const state = getLiveActionState(live.id);
  const email = String(customerEmail || "").trim().toLowerCase();
  if (state.auction?.productId === product.id) {
    if (state.auction.status === "running") throw Object.assign(new Error("Cette enchere est encore en cours."), { status: 409 });
    if (state.auction.status === "ended" && state.auction.highestBidder) {
      const winner = String(state.auction.highestBidder.email || "").trim().toLowerCase();
      if (!winner || winner !== email) throw Object.assign(new Error("Seul le gagnant de l'enchere peut payer ce lot."), { status: 403 });
      return { kind: "auction", unitPrice: money(state.auction.currentPrice), actionId: state.auction.id };
    }
  }
  if (state.flash?.productId === product.id && state.flash.status === "running" && new Date(state.flash.endsAt).getTime() > Date.now()) {
    return { kind: "flash", unitPrice: money(state.flash.price), actionId: state.flash.id };
  }
  if (state.break?.productId === product.id && state.break.status === "running") {
    return { kind: "break", unitPrice: money(state.break.pricePerSpot), actionId: state.break.id };
  }
  return { kind: "buy_now", unitPrice: money(product.price), actionId: "" };
}
