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
  assert.equal(out.house_number, "12");
  assert.throws(() => sc.normalizeSendcloudAddress({ ...address, countryCode: "FRANCE" }), { code: "SENDCLOUD_INPUT_INVALID" });
  assert.throws(() => sc.normalizeSendcloudAddress({ ...address, addressLine1: "x".repeat(161) }), { code: "SENDCLOUD_INPUT_INVALID" });
});
test("separated house_number is kept without dropping the original street line", () => {
  const out = sc.normalizeSendcloudAddress({ ...address, houseNumber: "17" });
  assert.equal(out.house_number, "17");
  assert.equal(out.address_line_1, address.addressLine1);
});
test("Mondial Relay requires mobile rather than a French landline", () => {
  assert.equal(sc.requireMondialRelayMobile("06 00 00 00 00"), "+33600000000");
  assert.throws(() => sc.requireMondialRelayMobile("0950000000"), { code: "MONDIAL_RELAY_MOBILE_REQUIRED" });
});
test("fractional and unsafe relay ids are rejected without network access", async () => {
  for (const id of [-1, 0, 1.1, "../../secrets", "9007199254740993"]) await assert.rejects(sc.getServicePoint(id), { code: "SERVICE_POINT_INVALID" });
});
test("search filters a mismatched carrier and country instead of returning it", async () => {
  await mocked(async (url, init) => {
    assert.equal(init.headers["Content-Type"], undefined);
    return json({ data: { results: [point, { ...point, id: 124, carrier: { code: "wrong" } }, { ...point, id: 125, address: { ...point.address, country_code: "BE" } }] } });
  }, async () => {
    const result = await sc.searchMondialRelayServicePoints({ postalCode: "59330" }); assert.equal(result.points.length, 1); assert.equal(result.points[0].id, 123);
  });
});
test("wrong carrier, return, labelless and home options never act as silent fallbacks", async () => {
  for (const changed of [{ carrier: { code: "wrong" } }, { functionalities: { last_mile: "home_delivery" } }, { functionalities: { last_mile: "service_point", returns: true } }, { functionalities: { last_mile: "service_point", labelless: true } }]) {
    await mocked(async () => json({ data: [{ ...option, ...changed }] }), async () => assert.rejects(sc.resolveShippingOption({ carrierCode: "mondial_relay", weightGrams: 500, servicePointId: 123 }), { code: "SENDCLOUD_SHIPPING_OPTION_UNAVAILABLE" }));
  }
});
test("domestic Mondial Relay is preferred over an international service-point option", async () => {
  const international = { ...option, code: "mondial_relay:service_point,international_dualapi/c2c", name: "Mondial Relay Point Relais International" };
  const domestic = { ...option, code: "mondial_relay:service_point,dualapi/size=l,c2c", name: "Mondial Relay Point Relais" };
  await mocked(async () => json({ data: [international, domestic] }), async () => {
    const selected = await sc.resolveShippingOption({ carrierCode: "mondial_relay", weightGrams: 560, servicePointId: 123, fromAddress: { country_code: "FR", postal_code: "59530" }, toAddress: { country_code: "FR", postal_code: "59330" } });
    assert.equal(selected.code, domestic.code);
    assert.doesNotMatch(selected.name.toLowerCase(), /international/);
  });
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
  assert.equal(JSON.parse(calls[1].init.body).contract_id, undefined);
  assert.equal(calls[1].init.headers["Content-Type"], "application/json");
  const optionsBody = JSON.parse(calls[1].init.body);
  assert.equal(optionsBody.from_address.country_code, "FR");
  assert.equal(optionsBody.to_address.country_code, "FR");
  assert.equal(optionsBody.to_service_point.id, "123");
  assert.equal(optionsBody.functionalities.last_mile, "service_point");
  assert.equal("from_country_code" in optionsBody, false);
  assert.equal("to_country_code" in optionsBody, false);
  const sent = JSON.parse(calls[2].init.body); assert.equal(sent.external_reference_id, input.orderNumber); assert.equal(sent.to_address.address_line_1, address.addressLine1); assert.equal(sent.to_address.house_number, "12"); assert.equal(sent.ship_with.properties.contract_id, 42); assert.equal(sent.to_service_point.id, "123");
});
test("missing Sendcloud payment method is explicit and never retried", async () => {
  let announces = 0;
  await mocked(async url => {
    if (url.includes("/service-points/")) return json({ data: point });
    if (url.endsWith("/shipping-options")) return json({ data: [option] });
    announces += 1;
    return json({ errors: [{ code: "no_valid_payment_method", status: "402", detail: "User has no valid payment method. Please add a valid payment method in your billing settings." }] }, 402);
  }, async () => assert.rejects(sc.createSendcloudShipment(input), { code: "ACCOUNT_PAYMENT_METHOD_REQUIRED", status: 402 }));
  assert.equal(announces, 1);
});
test("HTTP 402 without a detailed code is still a billing block, not a retry", async () => {
  await mocked(async url => url.includes("/service-points/") ? json({ data: point }) : url.endsWith("/shipping-options") ? json({ data: [option] }) : json({}, 402), async () => {
    await assert.rejects(sc.createSendcloudShipment(input), { code: "ACCOUNT_PAYMENT_METHOD_REQUIRED", status: 402 });
  });
});
test("shipment retrieve exposes tracking without a second announce", async () => {
  await mocked(async url => {
    assert.match(String(url), /\/shipments\/SHIP-1$/);
    return json({ data: { id: "SHIP-1", carrier: { code: "mondial_relay" }, parcels: [{ id: 999, tracking_number: "MR123", tracking_url: "https://tracking.example/MR123", status: { code: "READY_TO_SEND" } }] } });
  }, async () => {
    const tracking = await sc.getSendcloudTracking("SHIP-1");
    assert.equal(tracking.trackingNumber, "MR123");
    assert.equal(tracking.trackingUrl, "https://tracking.example/MR123");
  });
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
