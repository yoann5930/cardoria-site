import test from "node:test";
import assert from "node:assert/strict";
import {
  buildServicePointSearchRequest,
  buildShipmentCreationXml,
  createMondialRelayShipment,
  downloadMondialRelayLabel,
  mondialRelayLabelPurchasesEnabled,
  mondialRelaySecurity,
  parseServicePointSearchResponse,
  parseShipmentCreationResponse
} from "../lib/mondial-relay.js";

const envKeys = [
  "MONDIAL_RELAY_ENSEIGNE","MONDIAL_RELAY_PRIVATE_KEY","MONDIAL_RELAY_API_V2_LOGIN",
  "MONDIAL_RELAY_API_V2_PASSWORD","MONDIAL_RELAY_API_V2_CUSTOMER_ID",
  "MONDIAL_RELAY_API_V2_ENV","MONDIAL_RELAY_LABEL_FORMAT","MONDIAL_RELAY_LIVE_LABELS_ENABLED"
];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
function restoreEnv() {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}
function configure() {
  process.env.MONDIAL_RELAY_ENSEIGNE = "CARDORIA";
  process.env.MONDIAL_RELAY_PRIVATE_KEY = "PRIVATEKEY";
  process.env.MONDIAL_RELAY_API_V2_LOGIN = "api@cardoria.test";
  process.env.MONDIAL_RELAY_API_V2_PASSWORD = "secret-test";
  process.env.MONDIAL_RELAY_API_V2_CUSTOMER_ID = "CARDORIA";
  process.env.MONDIAL_RELAY_API_V2_ENV = "sandbox";
  process.env.MONDIAL_RELAY_LABEL_FORMAT = "10x15";
  process.env.MONDIAL_RELAY_LIVE_LABELS_ENABLED = "false";
}
const sender = { recipientName:"All Vaps", addressLine1:"17 avenue Marcel Aime", postalCode:"59330", city:"Hautmont", countryCode:"FR", phone:"0600000000" };
const recipient = { recipientName:"Jean Test", addressLine1:"12 rue de la Republique", addressLine2:"Bat A", postalCode:"59000", city:"Lille", countryCode:"FR", phone:"0611223344" };

test.after(restoreEnv);

test("WSI4 security follows the documented concatenation order and SOAP request", () => {
  configure();
  assert.equal(mondialRelaySecurity(["AB","12"], "KEY"), "94DFB179FFD1C7B2B2D304FBAB4F962E");
  const request = buildServicePointSearchRequest({ countryCode:"FR", postalCode:"59330", city:"Hautmont", radius:15000, limit:10 });
  assert.match(request.xml, /<Enseigne>CARDORIA<\/Enseigne>/);
  assert.match(request.xml, /<Pays>FR<\/Pays>/);
  assert.match(request.xml, /<CP>59330<\/CP>/);
  assert.match(request.xml, /<Action>24R<\/Action>/);
  assert.match(request.xml, new RegExp("<Security>" + request.security + "<\\/Security>"));
  assert.equal(request.security.length, 32);
});

test("WSI4 response keeps the carrier relay number including leading zeroes", () => {
  const xml = `<?xml version="1.0"?><soap:Envelope><soap:Body><PointsRelais>
    <PointRelais_Details><STAT>0</STAT><Num>001234</Num><LgAdr1>RELAIS TEST</LgAdr1><LgAdr3>1 RUE TEST</LgAdr3><CP>59330</CP><Ville>HAUTMONT</Ville><Pays>FR</Pays><Latitude>50,25</Latitude><Longitude>3,92</Longitude><Distance>420</Distance></PointRelais_Details>
    <PointRelais_Details><STAT>93</STAT><Num>999999</Num></PointRelais_Details>
  </PointsRelais></soap:Body></soap:Envelope>`;
  const points = parseServicePointSearchResponse(xml);
  assert.equal(points.length, 1);
  assert.equal(points[0].id, "001234");
  assert.equal(points[0].carrierServicePointId, "001234");
  assert.equal(points[0].distance, 420);
});

test("API V2 XML creates one 24R parcel to the selected Point Relais", () => {
  configure();
  const xml = buildShipmentCreationXml({
    orderNumber:"LSH-12345678-1234-1234-1234-123456789012",
    reference:"LSH-12345678-1234-1234-1234-123456789012",
    fromAddress:sender,fromEmail:"sender@cardoria.test",fromCompanyName:"Cardoria",
    toAddress:recipient,toEmail:"buyer@cardoria.test",weightGrams:560,totalOrderValue:15,
    servicePointId:"001234"
  });
  assert.match(xml, /<DeliveryMode Mode="24R" Location="FR-001234" \/>/);
  assert.match(xml, /<CollectionMode Mode="CCC" Location="" \/>/);
  assert.match(xml, /<Weight Value="560" Unit="gr" \/>/);
  assert.match(xml, /<OutputFormat>10x15<\/OutputFormat>/);
  assert.match(xml, /<AddressAdd1>JEAN TEST<\/AddressAdd1>/);
  const order = xml.match(/<OrderNo>([^<]+)<\/OrderNo>/)?.[1] || "";
  assert.ok(order.length > 0 && order.length <= 15);
  assert.doesNotMatch(xml, /<ShipmentValue>/);
});

test("real label creation is disabled by default and does not touch the network", async () => {
  configure();
  assert.equal(mondialRelayLabelPurchasesEnabled(), false);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("must not call"); };
  try {
    await assert.rejects(createMondialRelayShipment({
      orderNumber:"LSH-1",reference:"LSH-1",fromAddress:sender,toAddress:recipient,
      fromEmail:"sender@cardoria.test",toEmail:"buyer@cardoria.test",weightGrams:560,servicePointId:"001234"
    }), { code:"MONDIAL_RELAY_LABELS_NOT_ACTIVATED" });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("API V2 creation uses the sandbox once and returns shipment number plus private PDF URL", async () => {
  configure();
  process.env.MONDIAL_RELAY_LIVE_LABELS_ENABLED = "true";
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({url:String(url),init});
    return new Response(`<?xml version="1.0"?><ShipmentCreationResponse><ShipmentsList><Shipment ShipmentNumber="96408887"><LabelList><Label><Output>https://connect.mondialrelay.com/label.pdf</Output></Label></LabelList></Shipment></ShipmentsList><StatusList /></ShipmentCreationResponse>`, { status:200, headers:{"Content-Type":"application/xml"} });
  };
  try {
    const result = await createMondialRelayShipment({
      orderNumber:"LSH-2",reference:"LSH-2",fromAddress:sender,toAddress:recipient,
      fromEmail:"sender@cardoria.test",toEmail:"buyer@cardoria.test",weightGrams:560,servicePointId:"001234"
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://connect-api-sandbox.mondialrelay.com/api/shipment");
    assert.equal(calls[0].init.headers.Accept, "application/xml");
    assert.equal(calls[0].init.headers["Content-Type"], "text/xml");
    assert.match(String(calls[0].init.body), /Location="FR-001234"/);
    assert.equal(result.shipmentNumber, "96408887");
    assert.equal(result.trackingNumber, "96408887");
    assert.equal(result.labelUrl, "https://connect.mondialrelay.com/label.pdf");
  } finally { globalThis.fetch = original; }
});

test("ambiguous network failure is never automatically retried", async () => {
  configure();
  process.env.MONDIAL_RELAY_LIVE_LABELS_ENABLED = "true";
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("socket closed"); };
  try {
    await assert.rejects(createMondialRelayShipment({
      orderNumber:"LSH-3",reference:"LSH-3",fromAddress:sender,toAddress:recipient,
      fromEmail:"sender@cardoria.test",toEmail:"buyer@cardoria.test",weightGrams:560,servicePointId:"001234"
    }), { code:"MONDIAL_RELAY_RECONCILIATION_REQUIRED" });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("business errors reject creation while warnings do not", () => {
  const warning = `<ShipmentCreationResponse><ShipmentsList><Shipment ShipmentNumber="1"><LabelList><Label><Output>https://connect.mondialrelay.com/a.pdf</Output></Label></LabelList></Shipment></ShipmentsList><StatusList><Status><Code>10014</Code><Level>Warning</Level><Message>order ignored</Message></Status></StatusList></ShipmentCreationResponse>`;
  assert.equal(parseShipmentCreationResponse(warning).shipmentNumber, "1");
  const error = `<ShipmentCreationResponse><StatusList><Status><Code>10060</Code><Level>Error</Level><Message>label failed</Message></Status></StatusList></ShipmentCreationResponse>`;
  assert.throws(() => parseShipmentCreationResponse(error), { code:"MONDIAL_RELAY_CREATION_REJECTED" });
});

test("label download stays server-side, upgrades official HTTP URL and rejects foreign hosts", async () => {
  configure();
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response("%PDF-1.4\nDIRECT-MR-TEST", { status:200, headers:{"Content-Type":"application/pdf"} });
  };
  try {
    const bytes = await downloadMondialRelayLabel("http://connect.mondialrelay.com/test.pdf?x=1&amp;y=2");
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(calls[0], "https://connect.mondialrelay.com/test.pdf?x=1&y=2");
    await assert.rejects(downloadMondialRelayLabel("https://evil.example/label.pdf"), { code:"MONDIAL_RELAY_LABEL_INVALID" });
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});
