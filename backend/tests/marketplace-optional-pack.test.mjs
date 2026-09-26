import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("backend/routes/marketplace-v1.js", "utf8");
const paypal = fs.readFileSync("backend/lib/marketplace/paypal.js", "utf8");
const sellers = fs.readFileSync("backend/lib/marketplace/sellers.js", "utf8");
const ui = fs.readFileSync("js/marketplace-sell.js", "utf8");
const runtime = fs.readFileSync("backend/public/js/marketplace-sell.js", "utf8");

test("Marketplace publication does not require a professional pack", () => {
  assert.doesNotMatch(route, /assertActiveSellerPlan/);
  assert.doesNotMatch(paypal, /doit avoir un abonnement Cardoria actif avant la vente/);
});

test("Active seller packs are linked to Marketplace benefits", () => {
  assert.match(sellers, /marketplaceOfferLinked: row\.seller_type === "professional" && subscription\.active/);
  assert.match(sellers, /marketplaceOfferPlanId: row\.seller_type === "professional" && subscription\.active \? subscription\.planId/);
  assert.match(sellers, /marketplaceOffer: subscription\.active \? subscription\.entitlements\?\.marketplace/);
});

test("PayPal applies seller pack benefits only to professional sellers", () => {
  assert.match(paypal, /useSellerPlanBenefits: seller\?\.sellerType === "professional"/);
});

test("Marketplace UI distinguishes standard sellers from linked pack benefits", () => {
  assert.match(ui, /Particulier : conditions Market standard, aucun pack professionnel requis/);
  assert.match(ui, /Professionnel sans pack Market lié : conditions Market standard/);
  assert.match(ui, /Offre Market liée au pack/);
  assert.equal(runtime, ui);
});
