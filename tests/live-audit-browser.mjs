import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const admin of [false, true]) {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><div class='live-studio-actions'><button id='lasGiveFollow'>Giveaway Abonné</button><button id='lasGiveBuyer'>Giveaway Acheteur</button></div></body></html>" }));
    await page.goto("https://cardoria.test/" + (admin ? "admin-live.html" : "live-vendeur.html"));
    await page.addStyleTag({ path: path.resolve("css/live-studio-clean.css") });
    await page.addScriptTag({ path: path.resolve("js/live-studio-sales-controls.js") });
    const state = await page.evaluate(() => { window.CardoriaLiveSalesControls.decorate(); return { follow: getComputedStyle(document.getElementById("lasGiveFollow")).display !== "none" && !document.getElementById("lasGiveFollow").hidden, buyer: getComputedStyle(document.getElementById("lasGiveBuyer")).display !== "none" && !document.getElementById("lasGiveBuyer").hidden, followClick: typeof document.getElementById("lasGiveFollow").onclick, buyerClick: typeof document.getElementById("lasGiveBuyer").onclick }; });
    assert.equal(state.follow, !admin); assert.equal(state.buyer, true); assert.equal(state.buyerClick, "function"); if (!admin) assert.equal(state.followClick, "function");
    results.push({ scenario: admin ? "admin-only-visibility" : "seller-both-giveaway-buttons-visible", passed: true }); await page.close();
  }
  const page = await browser.newPage();
  await page.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/api/auth/me")) return route.fulfill({ json: { ok: true, user: { id: "A", role: "client", name: "Client", email: "test@cardoria.invalid" } } });
    if (url.endsWith("/api/live/my-shipments")) return route.fulfill({ json: { ok: true, shipments: [{ carrier: '<img src=x onerror="window.pwned=1">', status: '<script>window.pwned=1</script>', trackingNumber: '<img src=x onerror="window.pwned=1">', trackingUrl: "javascript:window.pwned=1" }, { carrier: "Mondial Relay", status: "Test", trackingNumber: "TEST", trackingUrl: "https://example.invalid/tracking" }] } });
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><div id='clientAuthCard'></div><div id='clientAccountCard' hidden><div id='clientAccountName'></div><div id='clientAccountEmail'></div><div id='clientLiveShipments'></div></div></body></html>" });
  });
  await page.goto("https://cardoria.test/client-login.html");
  await page.evaluate(() => localStorage.setItem("cardoria_client_session", "fake-session"));
  await page.addScriptTag({ path: path.resolve("js/client-auth.js") });
  await page.evaluate(() => document.dispatchEvent(new Event("DOMContentLoaded")));
  await page.waitForFunction(() => document.getElementById("clientLiveShipments").textContent.includes("TEST"));
  assert.equal(await page.locator("#clientLiveShipments img, #clientLiveShipments script").count(), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator("#clientLiveShipments a").count(), 1);
  assert.equal(await page.locator("#clientLiveShipments a").getAttribute("href"), "https://example.invalid/tracking");
  results.push({ scenario: "tracking-malicious-values-render-as-text", passed: true });
  await page.close();
  console.log(JSON.stringify({ browser: "Chromium", externalServices: "mocked", results }, null, 2));
} finally { await browser.close(); }
