import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import router from "../routes/mondial-relay.js";

const envKeys = [
  "MONDIAL_RELAY_ENSEIGNE","MONDIAL_RELAY_PRIVATE_KEY","MONDIAL_RELAY_API_V2_LOGIN",
  "MONDIAL_RELAY_API_V2_PASSWORD","MONDIAL_RELAY_API_V2_CUSTOMER_ID",
  "MONDIAL_RELAY_API_V2_ENV","MONDIAL_RELAY_LIVE_LABELS_ENABLED"
];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
function restoreEnv() {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

async function listen() {
  const app = express();
  app.use("/api/mondial-relay", router);
  const server = await new Promise(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/mondial-relay`;
  return { server, base };
}

test.after(restoreEnv);

test("status and service-point routes never leak secrets and fail closed without input", async () => {
  for (const key of envKeys) delete process.env[key];
  process.env.MONDIAL_RELAY_LIVE_LABELS_ENABLED = "false";
  const { server, base } = await listen();
  try {
    const status = await fetch(base + "/status").then(r => r.json());
    assert.equal(status.ok, true);
    assert.equal(status.provider, "mondial_relay_direct");
    assert.equal(status.servicePointSearchConfigured, false);
    assert.equal(status.shipmentApiConfigured, false);
    assert.equal(status.labelPurchasesEnabled, false);
    assert.equal(status.shipmentApiVersion, "v2");
    assert.equal(status.servicePointApi, "WSI4");
    assert.ok(status.missing.includes("MONDIAL_RELAY_ENSEIGNE"));
    assert.equal(JSON.stringify(status).includes("secret-test"), false);
    assert.equal(JSON.stringify(status).includes("PRIVATEKEY"), false);
    const empty = await fetch(base + "/service-points");
    assert.equal(empty.status, 400);
    const emptyBody = await empty.json();
    assert.equal(emptyBody.code, "MONDIAL_RELAY_SEARCH_INPUT_REQUIRED");
    const missing = await fetch(base + "/service-points?postalCode=59330&city=Hautmont");
    assert.equal(missing.status, 503);
    const missingBody = await missing.json();
    assert.equal(missingBody.code, "MONDIAL_RELAY_NOT_CONFIGURED");
    assert.deepEqual(missingBody.missing, ["MONDIAL_RELAY_ENSEIGNE", "MONDIAL_RELAY_PRIVATE_KEY"]);
    assert.equal(JSON.stringify(missingBody).includes("PRIVATEKEY"), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("configured search returns WSI4 points as strings and does not call Sendcloud", async () => {
  process.env.MONDIAL_RELAY_ENSEIGNE = "CARDORIA";
  process.env.MONDIAL_RELAY_PRIVATE_KEY = "PRIVATEKEY";
  process.env.MONDIAL_RELAY_LIVE_LABELS_ENABLED = "false";
  const original = globalThis.fetch;
  const { server, base } = await listen();
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("127.0.0.1")) return original(url, init);
    assert.match(target, /mondialrelay\.com\/WebService\/Web_Services\.asmx/);
    return new Response(`<?xml version="1.0"?><soap:Envelope><soap:Body><WSI4_PointRelais_RechercheResult><STAT>0</STAT><PointsRelais>
      <PointRelais_Details><STAT>0</STAT><Num>001111</Num><LgAdr1>ALL VAPS</LgAdr1><LgAdr3>17 AVENUE TEST</LgAdr3><CP>59330</CP><Ville>HAUTMONT</Ville><Pays>FR</Pays><Distance>120</Distance></PointRelais_Details>
    </PointsRelais></WSI4_PointRelais_RechercheResult></soap:Body></soap:Envelope>`, { status:200, headers:{"Content-Type":"text/xml"} });
  };
  try {
    const response = await fetch(base + "/service-points?postalCode=59330&city=Hautmont&countryCode=FR&limit=10&radius=15000");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.provider, "mondial_relay_direct");
    assert.equal(body.points[0].id, "001111");
    assert.equal(body.points[0].carrierCode, "mondial_relay");
    assert.equal(JSON.stringify(body).includes("PRIVATEKEY"), false);
    assert.equal(JSON.stringify(body).includes("panel.sendcloud"), false);
  } finally {
    globalThis.fetch = original;
    await new Promise(resolve => server.close(resolve));
  }
});

// Human-authored CI retrigger after frontend runtime sync; no behavior change.
