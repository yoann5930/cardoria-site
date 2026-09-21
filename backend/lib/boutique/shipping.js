/** Frais de port Boutique — tarif serveur uniquement, jamais le montant client. */
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const BOUTIQUE_SHIPPING = Object.freeze({
  "La Poste": Object.freeze({
    id: "La Poste",
    method: "Colissimo domicile",
    cost: 6.5,
    days: "2-3 jours"
  }),
  "Mondial Relay": Object.freeze({
    id: "Mondial Relay",
    method: "Point Relais",
    cost: 4.95,
    days: "3-5 jours"
  })
});

export function listBoutiqueShippingOptions() {
  return Object.values(BOUTIQUE_SHIPPING).map((option) => ({ ...option }));
}

export function resolveBoutiqueShipping(carrier) {
  const key = String(carrier || "").trim();
  const option = BOUTIQUE_SHIPPING[key] || (key ? null : BOUTIQUE_SHIPPING["La Poste"]);
  if (!option) {
    throw Object.assign(new Error("Mode d'envoi invalide."), { status: 400, code: "SHIPPING_METHOD_INVALID" });
  }
  return option;
}

export function boutiqueShippingCost(carrier) {
  return money(resolveBoutiqueShipping(carrier).cost);
}
