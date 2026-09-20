export const CARD_MIN_PRICE_EUR = 1;

export function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

export function floorCardPrice(value) {
  const amount = roundMoney(value);
  if (amount <= 0) return 0;
  return Math.max(CARD_MIN_PRICE_EUR, amount);
}

export function normalizeCardSalePrice(value) {
  const amount = roundMoney(value);
  if (amount <= 0) {
    const error = new Error("Le prix d'une carte doit être supérieur à 0 €.");
    error.status = 400;
    throw error;
  }
  return Math.max(CARD_MIN_PRICE_EUR, amount);
}
