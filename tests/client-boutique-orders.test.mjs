import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read=(path)=>fs.readFileSync(new URL(path,import.meta.url),"utf8");
const auth=read("../backend/routes/auth.js"),session=read("../backend/lib/auth/session.js"),checkout=read("../backend/lib/boutique/checkout.js"),clientAuth=read("../js/client-auth.js"),marketClient=read("../js/marketplace-client.js"),boutique=read("../js/boutique.js"),adminOrders=read("../js/admin/admin-orders.js"),adminCore=read("../js/admin/admin-core.js"),clientOrders=read("../js/client-orders.js"),clientLogin=read("../client-login.html"),boutiqueOrdersPage=read("../client-orders.html"),marketplaceOrdersPage=read("../mes-commandes.html"),payments=read("../backend/routes/payments.js"),paymentsAdmin=read("../backend/routes/payments-admin.js");
test("admin temporary code login stays disabled",()=>{assert.match(auth,/const ADMIN_CODE_LOGIN_TEMP_DISABLED = true;/);assert.doesNotMatch(auth,/const ADMIN_CODE_LOGIN_TEMP_DISABLED = false;/);});
test("client boutique orders endpoint is session scoped",()=>{const s=auth.indexOf('router.get("/orders"'),e=auth.indexOf("router.post(\"/password/request\"",s),h=auth.slice(s,e);assert.match(auth,/router\.get\("\/orders"/);assert.match(h,/if \(user\.role !== "client"\) return res\.status\(403\)/);assert.match(h,/normalizedEmail\(order\?\.email\) === email/);assert.doesNotMatch(h,/req\.query|req\.body/);assert.match(auth,/function publicClientOrder/);assert.doesNotMatch(auth,/internalNote|providerOrderId|sumupCheckoutId|address: order\.address|phone: order\.phone/);});
test("boutique and marketplace order pages stay separated",()=>{assert.match(boutiqueOrdersPage,/js\/client-orders\.js/);assert.match(boutiqueOrdersPage,/COMMANDES BOUTIQUE/);assert.doesNotMatch(boutiqueOrdersPage,/marketplace-orders\.js/);assert.match(marketplaceOrdersPage,/marketplace-orders\.js/);assert.match(clientLogin,/href="\/client-orders\.html"/);assert.match(clientLogin,/href="\/mes-commandes\.html"/);});
test("admin order controls use SumUp",()=>{assert.match(adminOrders,/Synchroniser SumUp/);assert.match(adminOrders,/Rembourser SumUp/);assert.doesNotMatch(adminOrders,/Synchroniser paiement Revolut|Rembourser Revolut/);for(const carrier of ["La Poste","Mondial Relay","Relais Colis"]){assert.match(paymentsAdmin,new RegExp(`"${carrier}"`));assert.match(adminOrders,new RegExp(carrier));}assert.match(paymentsAdmin,/sync-sumup/);});
test("current admin shell keeps Live navigation and OVH-safe backend",()=>{assert.match(adminCore,/admin-live\.html/);assert.match(adminCore,/var BACKEND = .*\|\| "";/);assert.doesNotMatch(adminCore,/cardoria-site-2\.onrender\.com/);});
test("client tracking does not invent a URL for Autre transporteur",()=>{assert.match(clientOrders,/if\(c\.includes\("autre"\)\)return "";/);assert.doesNotMatch(clientOrders,/google\.com\/search/);assert.match(clientOrders,/Suivre mon colis/);});
test("SumUp configuration and retired Revolut routes are explicit",()=>{assert.match(payments,/Paiement SumUp non configuré/);assert.match(payments,/\/sumup\/webhook/);assert.match(payments,/\/revolut\/\*/);assert.match(payments,/Revolut n'est plus utilisé/);assert.doesNotMatch(payments,/REVOLUT_SECRET_KEY/);});

test("client account uses one persistent session across Cardoria",()=>{
  assert.match(auth,/CLIENT_SESSION_HOURS/);
  assert.match(auth,/CLIENT_SESSION_DAYS \|\| 30/);
  assert.match(session,/ttlHours = SESSION_HOURS/);
  for(const source of [clientAuth,marketClient,boutique,clientOrders]) assert.match(source,/cardoria_session_token/);
  assert.match(clientAuth,/cardoria_client_session/);
  assert.match(marketClient,/cardoria_client_session/);
});
test("boutique checkout attaches authenticated purchases to the client account",()=>{
  assert.match(payments,/validateSession/);
  assert.match(payments,/accountUserId: account\?\.id/);
  assert.match(checkout,/userId: clean\(accountUserId/);
  const s=auth.indexOf('router.get("/orders"'),e=auth.indexOf('router.post("/password/request"',s),body=auth.slice(s,e);
  assert.match(body,/order\?\.userId/);
  assert.match(body,/normalizedEmail\(order\?\.email\) === email/);
});
test("client dashboard exposes Cardoria navigation and account data sections",()=>{
  for(const href of ["/","/boutique.html","/marketplace.html","/estimation.html","/live.html"]) assert.ok(clientLogin.includes('href="'+href+'"'));
  for(const id of ["clientStatBoutique","clientStatMarketplace","clientStatLive","clientProfileForm","clientRecentOrders","clientLiveShipments"]) assert.ok(clientLogin.includes('id="'+id+'"'));
  assert.match(clientAuth,/\/api\/auth\/orders/);
  assert.match(clientAuth,/\/api\/marketplace\/v1\/orders/);
  assert.match(clientAuth,/\/api\/live\/my-shipments/);
});
test("boutique keeps cart and reuses the connected client profile",()=>{
  assert.match(boutique,/cardoria_boutique_cart/);
  assert.match(boutique,/\/api\/auth\/me/);
  assert.match(boutique,/headers\.Authorization="Bearer "\+token/);
});

// Human-authored dashboard CI retrigger after frontend runtime sync; no behavior change.

test("client dashboard hidden state cannot be overridden by layout CSS",()=>{
  const css=read("../css/client-auth.css");
  assert.match(css,/\[hidden\]\{display:none!important\}/);
  assert.match(clientAuth,/function setAuthenticatedUi\(authenticated\)/);
  assert.match(clientAuth,/guest\.hidden = !!authenticated/);
  assert.match(clientAuth,/account\.hidden = !authenticated/);
  assert.match(clientAuth,/setAuthenticatedUi\(true\)/);
  assert.match(clientAuth,/setAuthenticatedUi\(false\)/);
});

// Human-authored hidden-state CI retrigger after frontend runtime sync; no behavior change.

test("client login and dashboard are mutually exclusive even with cached layout rules",()=>{
  const css=read("../css/client-auth.css");
  assert.match(css,/body\.client-is-authenticated #clientGuestShell\{display:none!important\}/);
  assert.match(css,/body:not\(\.client-is-authenticated\) #clientAccountCard\{display:none!important\}/);
  assert.match(clientAuth,/function setAuthenticatedUi\(authenticated\)/);
  assert.match(clientAuth,/style\.setProperty\("display", "none", "important"\)/);
  assert.match(clientAuth,/setAuthenticatedUi\(true\)/);
  assert.match(clientAuth,/setAuthenticatedUi\(false\)/);
  assert.match(clientLogin,/client-auth\.css\?v=20260920-dashboard-2/);
  assert.match(clientLogin,/client-auth\.js\?v=20260920-dashboard-3/);
});
