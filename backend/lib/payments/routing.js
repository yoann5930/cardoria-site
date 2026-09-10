/**
 * Routage paiement Cardoria — déterminé uniquement côté serveur.
 * Le fournisseur éventuel envoyé par le client n'est jamais honoré.
 */
export const PAYMENT_MATRIX = Object.freeze({
  boutique: "revolut",
  live_admin: "revolut",
  live_seller: "paypal",
  marketplace: "paypal"
});

export const RETIRED_PROVIDERS = Object.freeze(["sumup"]);

export function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function resolvePaymentRoute({ channel, ownerRole } = {}) {
  const rawChannel = String(channel || "").trim().toLowerCase();
  const role = String(ownerRole || "").trim().toLowerCase();
  let key = rawChannel;
  if (rawChannel === "shop") key = "boutique";
  if (rawChannel === "live" || rawChannel === "live_cardoria" || rawChannel === "live_admin") {
    key = role === "seller" ? "live_seller" : "live_admin";
  }
  if (rawChannel === "live_seller") key = "live_seller";
  const provider = PAYMENT_MATRIX[key];
  if (!provider) {
    throw Object.assign(new Error("Canal de paiement Cardoria inconnu."), { status: 400 });
  }
  return { channel: key, provider };
}

export function assertSaleProvider({ channel, ownerRole, requestedProvider } = {}) {
  const resolved = resolvePaymentRoute({ channel, ownerRole });
  const requested = normalizeProvider(requestedProvider);
  if (!requested) return { ...resolved, requestedProvider: "" };
  if (RETIRED_PROVIDERS.includes(requested)) {
    const error = new Error("SumUp n'est plus utilisé sur Cardoria.");
    error.status = 410;
    error.provider = resolved.provider;
    error.expectedProvider = resolved.provider;
    error.requestedProvider = requested;
    throw error;
  }
  if (requested !== resolved.provider) {
    const error = new Error(`Fournisseur ${requested} refusé. Cette vente utilise ${resolved.provider}.`);
    error.status = 403;
    error.provider = resolved.provider;
    error.expectedProvider = resolved.provider;
    error.requestedProvider = requested;
    throw error;
  }
  return { ...resolved, requestedProvider: requested };
}

export function assertServerAmount(serverAmount, clientAmount) {
  const server = money(serverAmount);
  if (clientAmount == null || clientAmount === "") return server;
  const client = money(clientAmount);
  if (client !== server) {
    throw Object.assign(new Error("Le montant envoyé par le client ne correspond pas au montant serveur."), { status: 403 });
  }
  return server;
}
