/** Server-owned buyer identity. Never accept an email or user id as authentication. */
import { validateSession } from "../auth/session.js";

const emailKey = value => String(value || "").trim().toLowerCase();
const denied = (message, status, code) => Object.assign(new Error(message), { status, code });

export function liveBuyerFromRequest(req) {
  const authorization = req?.headers?.authorization;
  const alternative = req?.headers?.["x-session-token"];
  let token = "";
  if (authorization !== undefined) {
    if (typeof authorization !== "string" || !/^Bearer\s+\S+$/i.test(authorization)) {
      throw denied("Connexion client requise.", 401, "CLIENT_LOGIN_REQUIRED");
    }
    token = authorization.replace(/^Bearer\s+/i, "");
  } else if (typeof alternative === "string") token = alternative;
  const user = validateSession(token);
  if (!user || user.role !== "client" || !user.id || !emailKey(user.email)) {
    throw denied("Connexion à votre compte client requise pour acheter.", 401, "CLIENT_LOGIN_REQUIRED");
  }
  return user;
}

export function checkoutInputForBuyer(user, body = {}) {
  if (!user || user.role !== "client" || !user.id || !emailKey(user.email)) {
    throw denied("Compte client requis.", 401, "CLIENT_LOGIN_REQUIRED");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw denied("Demande de paiement invalide.", 400, "LIVE_CHECKOUT_INPUT_INVALID");
  }
  for (const key of ["customerEmail", "buyerEmail"]) {
    if (body[key] != null && emailKey(body[key]) !== emailKey(user.email)) {
      throw denied("L'acheteur doit correspondre au compte connecté.", 403, "LIVE_BUYER_MISMATCH");
    }
  }
  for (const key of ["customerId", "buyerId", "userId"]) {
    if (body[key] != null && String(body[key]) !== String(user.id)) {
      throw denied("L'acheteur doit correspondre au compte connecté.", 403, "LIVE_BUYER_MISMATCH");
    }
  }
  // Only these fields may cross the public API boundary. Totals, commissions,
  // seller identities, payer flags and payment statuses remain server-owned.
  return {
    liveId: body.liveId, productId: body.productId, qty: body.qty,
    spotLabel: body.spotLabel, checkoutRequestId: body.checkoutRequestId,
    customerId: String(user.id), customerEmail: emailKey(user.email),
    customerName: String(user.name || "Client Live").trim().slice(0, 120),
    shippingAddress: body.shippingAddress, servicePoint: body.servicePoint,
    requestedProvider: body.provider, requestedAmount: body.amount ?? body.total,
    successUrl: body.successUrl, cancelUrl: body.cancelUrl
  };
}

export function authenticatedCheckoutInput(req) {
  return checkoutInputForBuyer(liveBuyerFromRequest(req), req.body || {});
}
