import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";

// Only the external relay response is a fixture. The real browser collector is loaded.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let relaySearches = 0;
  let unavailable = false;
  await page.route("https://cardoria.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/mondial-relay/service-points") {
      relaySearches++;
      assert.equal(url.searchParams.get("postalCode"), "59330");
      assert.equal(url.searchParams.get("countryCode"), "FR");
      assert.equal(url.searchParams.get("city"), "Hautmont");
      assert.equal(url.searchParams.get("limit"), "10");
      assert.equal(url.searchParams.get("radius"), "15000");
      return route.fulfill({ status: unavailable ? 503 : 200, contentType: "application/json", body: JSON.stringify(unavailable
        ? { ok: false, code: "MONDIAL_RELAY_NOT_CONFIGURED", error: "Mondial Relay indisponible pour le test" }
        : { ok: true, points: [{ id: 10001, name: "Relais fictif de test", street: "rue Test", houseNumber: "1", postalCode: "59330", city: "Hautmont", countryCode: "FR", carrierCode: "mondial_relay" }] }) });
    }
    if (url.pathname !== "/") throw new Error(`Unexpected HTTP request: ${url.pathname}`);
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
  });
  await page.goto("https://cardoria.test/");
  await page.addScriptTag({ path: path.resolve("js/live-shipping-address.js") });
  const result = await page.evaluate(async () => {
    const answers = ["Jean Dupont", "12 rue des Cartes", "", "59330", "Hautmont", "FR", "0600000000", "1"];
    let calls = 0;
    window.alert = () => {};
    window.prompt = () => { calls++; return answers.shift(); };
    const first = await window.CardoriaLiveShippingAddress.collect({ liveId: "LIVE-E2E", email: "buyer@example.com", name: "Pseudo" });
    return { first, calls };
  });
  assert.equal(result.first.address.recipientName, "Jean Dupont");
  assert.equal(result.first.address.addressLine1, "12 rue des Cartes");
  assert.equal(result.first.address.postalCode, "59330");
  assert.equal(result.first.address.city, "Hautmont");
  assert.equal(result.first.address.countryCode, "FR");
  assert.equal(result.first.servicePoint.id, "10001");
  assert.equal(result.first.email, "buyer@example.com");
  assert.equal(result.calls, 8);
  assert.equal(relaySearches, 1);

  const cached = await page.evaluate(async () => {
    window.confirm = () => true;
    window.prompt = () => { throw new Error("Confirmed cached selection should not prompt again"); };
    return window.CardoriaLiveShippingAddress.collect({ liveId: "LIVE-E2E", email: "buyer@example.com", name: "Pseudo" });
  });
  assert.equal(cached.servicePoint.id, "10001");
  assert.equal(relaySearches, 1);

  const cancelled = await page.evaluate(async () => {
    window.prompt = () => null;
    return window.CardoriaLiveShippingAddress.collect({ liveId: "LIVE-CANCEL", email: "buyer@example.com", name: "Pseudo" });
  });
  assert.equal(cancelled, null);

  unavailable = true;
  const failure = await page.evaluate(async () => {
    const answers = ["Jean Dupont", "12 rue des Cartes", "", "59330", "Hautmont", "FR", "0600000000"];
    window.prompt = () => answers.shift();
    try {
      await window.CardoriaLiveShippingAddress.collect({ liveId: "LIVE-FAIL", email: "buyer@example.com", name: "Pseudo" });
      return { unexpectedSuccess: true };
    } catch (error) { return { code: error.code }; }
  });
  assert.equal(failure.code, "MONDIAL_RELAY_NOT_CONFIGURED");
  console.log("Postal address and relay Chromium E2E: PASS (external Mondial Relay response mocked)");
} finally {
  await browser.close();
}
