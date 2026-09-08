import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const auth = read("../backend/routes/auth.js");
const adminOrders = read("../js/admin/admin-orders.js");
const adminCore = read("../js/admin/admin-core.js");
const clientOrders = read("../js/client-orders.js");
const clientLogin = read("../client-login.html");
const boutiqueOrdersPage = read("../client-orders.html");
const marketplaceOrdersPage = read("../mes-commandes.html");
const payments = read("../backend/routes/payments.js");
const paymentsAdmin = read("../backend/routes/payments-admin.js");

test("admin temporary code login stays disabled", () => {
  assert.match(auth, /const ADMIN_CODE_LOGIN_TEMP_DISABLED = true;/);
  assert.doesNotMatch(auth, /const ADMIN_CODE_LOGIN_TEMP_DISABLED = false;/);
});

test("client boutique orders endpoint is session scoped", () => {
  const ordersStart = auth.indexOf('router.get("/orders"');
  const ordersEnd = auth.indexOf("router.post(\"/password/request\"", ordersStart);
  const ordersHandler = auth.slice(ordersStart, ordersEnd);
  assert.match(auth, /router\.get\("\/orders"/);
  assert.match(ordersHandler, /if \(user\.role !== "client"\) return res\.status\(403\)/);
  assert.match(ordersHandler, /normalizedEmail\(order\?\.email\) === email/);
  assert.doesNotMatch(ordersHandler, /req\.query|req\.body/);
  assert.match(auth, /function publicClientOrder/);
  assert.doesNotMatch(auth, /internalNote|providerOrderId|sumupCheckoutId|address: order\.address|phone: order\.phone/);
  assert.match(auth, /if \(value === "À préparer"\) return "Commande confirmée";/);
});

test("boutique and marketplace order pages stay separated", () => {
  assert.match(boutiqueOrdersPage, /js\/client-orders\.js/);
  assert.match(boutiqueOrdersPage, /COMMANDES BOUTIQUE/);
  assert.doesNotMatch(boutiqueOrdersPage, /marketplace-orders\.js/);
  assert.match(marketplaceOrdersPage, /marketplace-orders\.js/);
  assert.doesNotMatch(marketplaceOrdersPage, /js\/client-orders\.js/);
  assert.match(read("../backend/public/client-orders.html"), /js\/client-orders\.js/);
  assert.match(read("../backend/public/mes-commandes.html"), /marketplace-orders\.js/);
  assert.match(clientLogin, /href="\/client-orders\.html"/);
  assert.match(clientLogin, /href="\/mes-commandes\.html"/);
  assert.match(clientLogin, /Mot de passe oublié/);
});

test("admin order UI uses Revolut and compatible statuses", () => {
  assert.match(adminOrders, /Synchroniser paiement Revolut/);
  assert.match(adminOrders, /Rembourser Revolut/);
  assert.match(adminOrders, /statusLabel\(v\) \{ return v === "À préparer" \? "Commande confirmée" : v; \}/);
  assert.match(adminCore, /Paiements Revolut/);
  assert.doesNotMatch(adminOrders, /Synchroniser SumUp|Rembourser SumUp|sync-sumup/);
  assert.doesNotMatch(adminCore, /Paiements SumUp/);
  for (const carrier of [
    "La Poste", "Colissimo", "Chronopost", "Mondial Relay", "Relais Colis", "Colis Privé",
    "DPD", "GLS", "UPS", "DHL Express", "FedEx", "TNT", "Geodis", "DB Schenker", "Ciblex",
    "France Express", "Amazon Logistics", "Cainiao", "Correos", "Royal Mail", "PostNL", "bpost", "Autre transporteur"
  ]) {
    assert.match(paymentsAdmin, new RegExp(`"${carrier}"`));
    assert.match(adminOrders, new RegExp(carrier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(paymentsAdmin, /Commande confirmée" \? "À préparer"/);
  assert.match(paymentsAdmin, /sync-sumup[\s\S]*410/);
});

test("client tracking does not invent a URL for Autre transporteur", () => {
  assert.match(clientOrders, /if\(c\.includes\("autre"\)\)return "";/);
  assert.doesNotMatch(clientOrders, /google\.com\/search/);
  assert.match(clientOrders, /Suivre mon colis/);
});

test("Revolut configuration errors point to OVH", () => {
  const revolut = read("../backend/lib/payments/revolut.js");
  assert.match(payments, /\/etc\/cardoria\/cardoria\.env sur OVH/);
  assert.match(revolut, /\/etc\/cardoria\/cardoria\.env sur OVH/);
  assert.doesNotMatch(payments, /REVOLUT_SECRET_KEY dans Render/);
  assert.doesNotMatch(revolut, /manquante sur Render|dans Render/);
});
