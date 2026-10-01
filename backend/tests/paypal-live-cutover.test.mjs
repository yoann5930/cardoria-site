import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertLiveSellerOnboardingUrl,
  paypalApiBase,
  probePayPalLiveOAuth,
  resolvePayPalEnvironment,
  sellerPayPalSyncReady
} from "../lib/marketplace/paypal.js";

const liveEnv = {
  NODE_ENV: "test",
  PAYPAL_ENV: "live",
  PAYPAL_CLIENT_ID: "LIVECLIENTID123456",
  PAYPAL_CLIENT_SECRET: "LIVESECRETVALUE123456"
};

test("production refuses a sandbox PayPal environment", () => {
  const resolved = resolvePayPalEnvironment({ NODE_ENV: "production", PAYPAL_ENV: "sandbox" });
  assert.equal(resolved.blocked, true);
  assert.throws(() => paypalApiBase({ NODE_ENV: "production", PAYPAL_ENV: "sandbox" }), /PAYPAL_ENV=live/);
});

test("live and sandbox PayPal API hosts stay separate", () => {
  assert.equal(paypalApiBase({ NODE_ENV: "test", PAYPAL_ENV: "live" }), "https://api-m.paypal.com");
  assert.equal(paypalApiBase({ NODE_ENV: "test", PAYPAL_ENV: "sandbox" }), "https://api-m.sandbox.paypal.com");
});

test("live onboarding URL cannot point at sandbox", () => {
  assert.throws(
    () => assertLiveSellerOnboardingUrl("https://www.sandbox.paypal.com/bizsignup/partner", liveEnv),
    /Sandbox/
  );
  const liveUrl = assertLiveSellerOnboardingUrl("https://www.paypal.com/bizsignup/partner/entry?token=abc", liveEnv);
  assert.equal(liveUrl.includes("sandbox"), false);
});

test("seller sync is ready only when merchant, permissions, email and payments are valid", () => {
  assert.equal(sellerPayPalSyncReady({
    merchantId: "MERCHANT123",
    permissionsGranted: true,
    emailConfirmed: true,
    paymentsReceivable: true
  }), true);
  assert.equal(sellerPayPalSyncReady({
    merchantId: "MERCHANT123",
    permissionsGranted: true,
    emailConfirmed: false,
    paymentsReceivable: true
  }), false);
});

test("oauth probe does not return or print a token", async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, PAYPAL_ENV: process.env.PAYPAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.PAYPAL_ENV = "sandbox";
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    const result = await probePayPalLiveOAuth();
    assert.deepEqual(result, { ok: false });
    assert.equal("access_token" in result, false);
    assert.equal(logs.some((line) => /access_token|client_secret/i.test(line)), false);
  } finally {
    console.log = original;
    if (saved.NODE_ENV == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.PAYPAL_ENV == null) delete process.env.PAYPAL_ENV;
    else process.env.PAYPAL_ENV = saved.PAYPAL_ENV;
  }
});

test("checkout builders do not call PayPal capture", () => {
  const source = fs.readFileSync(new URL("../lib/marketplace/paypal.js", import.meta.url), "utf8");
  const createLive = source.slice(source.indexOf("export async function createLivePayPalOrder"), source.indexOf("export function mapLivePayPalOrderStatus"));
  const createMarket = source.slice(source.indexOf("export async function createMarketplacePayPalOrder"), source.indexOf("export async function probePayPalLiveOAuth"));
  assert.match(createLive, /\/v2\/checkout\/orders/);
  assert.doesNotMatch(createLive, /\/capture/);
  assert.match(createMarket, /\/v2\/checkout\/orders/);
  assert.doesNotMatch(createMarket, /\/capture/);
});

test("seller UI uses live onboarding and does not embed PayPal secrets", () => {
  for (const file of ["../../js/marketplace-sell.js", "../../js/live-vendeur.js", "../../backend/public/js/marketplace-sell.js", "../../backend/public/js/live-vendeur.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /Connecter PayPal/);
    assert.match(source, /sandbox\\\.paypal\\\.com/);
    assert.doesNotMatch(source, /PAYPAL_CLIENT_SECRET|PAYPAL_CLIENT_ID\s*=/);
    assert.doesNotMatch(source, /https:\/\/www\.sandbox\.paypal\.com/);
  }
  const live = fs.readFileSync(new URL("../../js/live-vendeur.js", import.meta.url), "utf8");
  assert.match(live, /PayPal prêt/);
  assert.match(live, /Connexion PayPal requise/);
  assert.match(live, /id='lvCam1'/);
  assert.doesNotMatch(live, /if\s*\(!seller\.paypalReady\)[\s\S]{0,120}lvCam1/);
  const sell = fs.readFileSync(new URL("../../js/marketplace-sell.js", import.meta.url), "utf8");
  assert.match(sell, /Particuliers et professionnels peuvent vendre/);
  assert.match(sell, /SIRET est exigé uniquement pour un Liveur Pro/);
});

test("paypal configure reads GitHub secrets and never commits them", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/ovh-ops-run.yml", import.meta.url), "utf8");
  const script = fs.readFileSync(new URL("../../oracle/paypal-configure.sh", import.meta.url), "utf8");
  for (const name of ["OVH_PAYPAL_CLIENT_ID", "OVH_PAYPAL_CLIENT_SECRET", "OVH_PAYPAL_PARTNER_MERCHANT_ID", "OVH_PAYPAL_PARTNER_ATTRIBUTION_ID", "OVH_PAYPAL_WEBHOOK_ID"]) {
    assert.match(workflow, new RegExp(name));
  }
  assert.match(script, /PAYPAL_ENV' 'live'/);
  assert.match(script, /PAYPAL_DISBURSEMENT_MODE' 'INSTANT'/);
  assert.match(script, /install -m 0600/);
  assert.match(script, /paypal_configure: rollback/);
  assert.doesNotMatch(workflow, /PAYPAL_CLIENT_SECRET:\s*["'][^$]/);
});
