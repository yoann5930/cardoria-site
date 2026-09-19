import test from "node:test";
import assert from "node:assert/strict";
import * as sc from "../lib/sendcloud.js";
const address = { recipientName: "Jean Test", addressLine1: "12 rue de la Republique et des Anciens Combattants", postalCode: "59330", city: "Hautmont", countryCode: "FR", phone: "0600000000" };
const point = { id: 123, name: "Test Relay", carrier: { code: "mondial_relay", name: "Mondial Relay" }, address: { street: "rue Test", postal_code: "59330", city: "Hautmont", country_code: "FR" } };
const option = { code: "mondial_relay:test", carrier: { code: "mondial_relay" }, functionalities: { last_mile: "service_point", returns: false, labelless: false }, contract: { id: 42 } };
const input = { orderNumber: "LSH-AUDIT-TEST", toAddress: address, fromAddress: address, weightGrams: 500, carrierCode: "mondial_relay", servicePointId: 123, totalOrderValue: 11 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function mocked(fn, run) {
  const original = globalThis.fetch, pub = process.env.SENDCLOUD_PUBLIC_KEY, sec = process.env.SENDCLOUD_SECRET_KEY;
  process.env.SENDCLOUD_PUBLIC_KEY = "fake-test-public"; process.env.SENDCLOUD_SECRET_KEY = "fake-test-secret";
  globalThis.fetch = fn;
  try { return await run(); } finally { globalThis.fetch = original; if (pub === undefined) delete process.env.SENDCLOUD_PUBLIC_KEY; else process.env.SENDCLOUD_PUBLIC_KEY = pub; if (sec === undefined) delete process.env.SENDCLOUD_SECRET_KEY; else process.env.SENDCLOUD_SECRET_KEY = sec; }
}
test("address and recipient are preserved, not cut to 32 characters", () => {
  const out = sc.normalizeSendcloudAddress(address); assert.equal(out.address_line_1, address.addressLine1); assert.equal(out.name, address.recipientName);
  assert.throws(() => sc.normalizeSendcloudAddress({ ...address, countryCode: "FRANCE" }), { code: "SENDCLOUD_INPUT_INVALID" });
  assert.throws(() => sc.normalizeSendcloudAddress({ ...address, addressLine1: "x".repeat(161) }), { code: "SENDCLOUD_INPUT_INVALID" });
});
test("Mondial Relay requires mobile rather than a French landline", () => {
  assert.equal(sc.requireMondialRelayMobile("06 00 00 00 00"), "+33600000000");
  assert.throws(() => sc.requireMondialRelayMobile("0950000000"), { code: "MONDIAL_RELAY_MOBILE_REQUIRED" });
});
test("fractional and unsafe relay ids are rejected without network access", async () => {
  for (const id of [-1, 0, 1.1, "../../secrets", "9007199254740993"]) await assert.rejects(sc.getServicePoint(id), { code: "SERVICE_POINT_INVALID" });
});
test("search filters a mismatched carrier and country instead of returning it", async () => {
  await mocked(async () => json({ data: { results: [point, { ...point, id: 124, carrier: { code: "wrong" } }, { ...point, id: 125, address: { ...point.address, country_code: "BE" } }] } }), async () => {
    const result = await sc.searchMondialRelayServicePoints({ postalCode: "59330" }); assert.equal(result.points.length, 1); assert.equal(result.points[0].id, 123);
  });
});
test("wrong carrier, return, labelless and home options never act as silent fallbacks", async () => {
  for (const changed of [{ carrier: { code: "wrong" } }, { functionalities: { last_mile: "home_delivery" } }, { functionalities: { last_mile: "service_point", returns: true } }, { functionalities: { last_mile: "service_point", labelless: true } }]) {
    await mocked(async () => json({ data: [{ ...option, ...changed }] }), async () => assert.rejects(sc.resolveShippingOption({ carrierCode: "mondial_relay", weightGrams: 500, servicePointId: 123 }), { code: "SENDCLOUD_SHIPPING_OPTION_UNAVAILABLE" }));
  }
});
test("foreign relay prevents any announcement request", async () => {
  const calls = []; await mocked(async url => { calls.push(url); return json({ data: { ...point, carrier: { code: "other" } } }); }, async () => assert.rejects(sc.createSendcloudShipment(input), { code: "SERVICE_POINT_MISMATCH" })); assert.equal(calls.length, 1);
});
test("valid contract sends stable idempotency reference and preserves address", async () => {
  const calls = []; await mocked(async (url, init) => {
    calls.push({ url, init }); assert.equal(init.redirect, "error"); assert.ok(init.signal);
    if (url.includes("/service-points/")) return json({ data: point });
    if (url.endsWith("/shipping-options")) return json({ data: [option] });
    return json({ data: { id: "SHIP-1", carrier: { code: "mondial_relay" }, errors: [], parcels: [{ id: 999, status: { code: "READY_TO_SEND" }, tracking_url: "javascript:alert(1)", documents: [{ type: "label", link: "https://evil.invalid/steal" }] }] } }, 201);
  }, async () => {
    const result = await sc.createSendcloudShipment(input);
    assert.equal(result.trackingUrl, ""); assert.equal(result.labelUrl, "https://panel.sendcloud.sc/api/v3/parcels/999/documents/label");
  });
  const sent = JSON.parse(calls[2].init.body); assert.equal(sent.external_reference_id, input.orderNumber); assert.equal(sent.to_address.address_line_1, address.addressLine1); assert.equal(sent.ship_with.properties.contract_id, 42);
});
test("HTTP success with carrier announcement errors is a failure", async () => {
  for (const data of [{ id: "S", errors: [{ detail: "bad" }], parcels: [{ id: 9 }] }, { id: "S", carrier: { code: "mondial_relay" }, parcels: [{ id: 9, status: { code: "ANNOUNCEMENT_FAILED" }, documents: [{ type: "label" }] }] }, { id: "S", carrier: { code: "mondial_relay" }, parcels: [{ id: 9, status: { code: "READY_TO_SEND" }, documents: [{ type: "customs" }] }] }]) {
    await mocked(async url => url.includes("/service-points/") ? json({ data: point }) : url.endsWith("/shipping-options") ? json({ data: [option] }) : json({ data }), async () => assert.rejects(sc.createSendcloudShipment(input), { code: "SENDCLOUD_ANNOUNCEMENT_FAILED" }));
  }
});
test("malformed JSON, oversized responses and provider errors fail without exposing payloads", async () => {
  const q = () => sc.searchMondialRelayServicePoints({ postalCode: "59330" });
  await mocked(async () => new Response("broken", { headers: { "Content-Type": "application/json" } }), async () => assert.rejects(q(), { code: "SENDCLOUD_RESPONSE_INVALID" }));
  await mocked(async () => new Response("{}", { headers: { "Content-Length": "3000000" } }), async () => assert.rejects(q(), { code: "SENDCLOUD_RESPONSE_TOO_LARGE" }));
  await mocked(async () => json({ detail: "private recipient data" }, 400), async () => assert.rejects(q(), error => error.code === "SENDCLOUD_API_ERROR" && !error.message.includes("private recipient") && !error.sendcloudPayload));
});
test("network failures are not automatically retried", async () => {
  let calls = 0; await mocked(async () => { calls++; throw new Error("secret internal response"); }, async () => assert.rejects(sc.searchMondialRelayServicePoints({ postalCode: "59330" }), { code: "SENDCLOUD_NETWORK_ERROR" })); assert.equal(calls, 1);
});
test("label download uses canonical protected endpoint and rejects HTML pretending to be PDF", async () => {
  await mocked(async (url, init) => { assert.equal(url, "https://panel.sendcloud.sc/api/v3/parcels/999/documents/label?dpi=72"); assert.equal(init.headers.Accept, "application/pdf"); return new Response("%PDF-1.4\nTEST FIXTURE ONLY", { headers: { "Content-Type": "application/pdf" } }); }, async () => assert.ok(Buffer.isBuffer(await sc.downloadSendcloudLabel(999))));
  await mocked(async () => new Response("<html>login</html>", { headers: { "Content-Type": "application/pdf" } }), async () => assert.rejects(sc.downloadSendcloudLabel(999), { code: "SENDCLOUD_LABEL_INVALID" }));
});
test("cancellation accepted is not mislabeled as cancellation confirmed", async () => {
  await mocked(async () => json({ data: { status: "cancellation_requested" } }, 202), async () => assert.equal((await sc.cancelSendcloudShipment("S1")).confirmed, false));
  await mocked(async () => json({ data: { status: "cancelled" } }), async () => assert.equal((await sc.cancelSendcloudShipment("S1")).confirmed, true));
});
