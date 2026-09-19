import crypto from "node:crypto";

const SOAP_URL = "https://www.mondialrelay.com/WebService/Web_Services.asmx";
const SOAP_ACTION = "http://www.mondialrelay.fr/webservice/WSI4_PointRelais_Recherche";
const SHIPMENT_URLS = Object.freeze({
  sandbox: "https://connect-api-sandbox.mondialrelay.com/api/shipment",
  production: "https://connect-api.mondialrelay.com/api/shipment"
});
const LABEL_HOSTS = new Set(["connect.mondialrelay.com", "www.mondialrelay.com", "mondialrelay.com"]);

const failure = (code, message, status = 502, meta = {}) => Object.assign(new Error(message), { code, status, ...meta });
const rawText = value => String(value == null ? "" : value).trim();

function requiredEnv(name) {
  const value = rawText(process.env[name]);
  if (!value) throw failure("MONDIAL_RELAY_NOT_CONFIGURED", "Mondial Relay direct n'est pas configuré côté serveur.", 503, { missing: name });
  return value;
}
function xmlEscape(value) {
  return rawText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function xmlDecode(value) {
  return rawText(value)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function xmlValue(block, tag) {
  const match = String(block || "").match(new RegExp("<(?:\\w+:)?" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?" + tag + ">", "i"));
  return match ? xmlDecode(match[1]) : "";
}
function xmlAttribute(block, tag, attribute) {
  const match = String(block || "").match(new RegExp("<(?:\\w+:)?" + tag + "\\b[^>]*\\b" + attribute + '="([^"]*)"', "i"));
  return match ? xmlDecode(match[1]) : "";
}
function ascii(value) {
  return rawText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}
function mrText(value, max, { required = false, allowEmail = false } = {}) {
  let out = ascii(value);
  if (allowEmail) {
    if (out && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) || out.length > max)) throw failure("MONDIAL_RELAY_INPUT_INVALID", "Adresse email d'expédition invalide.", 400);
    return out;
  }
  out = out.toUpperCase().replace(/[^0-9A-Z _\-'.\/,]/g, " ").replace(/\s+/g, " ").trim();
  if ((required && !out) || out.length > max) throw failure("MONDIAL_RELAY_INPUT_INVALID", "Champ Mondial Relay manquant ou trop long.", 400);
  return out;
}
function country(value) {
  const code = rawText(value || "FR").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw failure("MONDIAL_RELAY_INPUT_INVALID", "Code pays Mondial Relay invalide.", 400);
  return code;
}
function postalCode(value) {
  const code = ascii(value).toUpperCase().replace(/\s+/g, "");
  if (!/^[0-9A-Z-]{2,10}$/.test(code)) throw failure("MONDIAL_RELAY_INPUT_INVALID", "Code postal Mondial Relay invalide.", 400);
  return code;
}
function relayNumber(value) {
  const id = rawText(value);
  if (!/^\d{1,8}$/.test(id) || Number(id) <= 0) throw failure("MONDIAL_RELAY_SERVICE_POINT_INVALID", "Identifiant Point Relais Mondial Relay invalide.", 400);
  return id;
}
function grams(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 10 || n > 25000) throw failure("SHIPMENT_WEIGHT_REQUIRED", "Poids Mondial Relay entier compris entre 10 g et 25 kg requis.", 400);
  return n;
}
function normalizePhone(value, countryCode = "FR") {
  let phone = rawText(value).replace(/[.()\s-]/g, "");
  if (!phone) return "";
  if (countryCode === "FR") {
    if (/^0[1-9]\d{8}$/.test(phone)) phone = "+33" + phone.slice(1);
    else if (/^0033[1-9]\d{8}$/.test(phone)) phone = "+33" + phone.slice(4);
    if (!/^\+33[1-9]\d{8}$/.test(phone)) throw failure("MONDIAL_RELAY_INPUT_INVALID", "Numéro de téléphone français invalide.", 400);
  } else if (!/^\+\d{7,15}$/.test(phone)) {
    throw failure("MONDIAL_RELAY_INPUT_INVALID", "Numéro de téléphone international invalide.", 400);
  }
  return phone;
}
function splitStreet(addressLine1, explicitHouseNumber = "") {
  const source = ascii(addressLine1).trim();
  let houseNo = ascii(explicitHouseNumber).trim();
  let street = source;
  if (!houseNo) {
    const match = source.match(/^([0-9]{1,5}(?:[A-Za-z])?)\s+(.+)$/);
    if (match) { houseNo = match[1]; street = match[2]; }
  } else {
    const escaped = houseNo.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    street = street.replace(new RegExp("^" + escaped + "\\s+", "i"), "");
  }
  houseNo = mrText(houseNo, 10);
  street = mrText(street, 40, { required: true });
  if ((houseNo + street).length > 40) throw failure("MONDIAL_RELAY_INPUT_INVALID", "Numéro et rue dépassent la limite Mondial Relay.", 400);
  return { houseNo, street };
}
function addressXml(raw = {}, email = "", labelName = "") {
  const name = mrText(labelName || raw.recipientName || raw.name || "", 30, { required: true });
  const code = country(raw.countryCode || raw.country || "FR");
  const { houseNo, street } = splitStreet(raw.addressLine1 || raw.street || "", raw.houseNumber || "");
  const phone = normalizePhone(raw.phone || "", code);
  const isMobileFr = code === "FR" && /^\+33[67]\d{8}$/.test(phone);
  return [
    "<Address>",
    "<Title />",
    "<Firstname />",
    "<Lastname />",
    "<Streetname>" + xmlEscape(street) + "</Streetname>",
    "<HouseNo>" + xmlEscape(houseNo) + "</HouseNo>",
    "<CountryCode>" + xmlEscape(code) + "</CountryCode>",
    "<PostCode>" + xmlEscape(postalCode(raw.postalCode || raw.postCode)) + "</PostCode>",
    "<City>" + xmlEscape(mrText(raw.city, 30, { required: true })) + "</City>",
    "<AddressAdd1>" + xmlEscape(name) + "</AddressAdd1>",
    "<AddressAdd2>" + xmlEscape(mrText(raw.addressLine2 || "", 30)) + "</AddressAdd2>",
    "<AddressAdd3 />",
    "<PhoneNo>" + xmlEscape(isMobileFr ? "" : phone) + "</PhoneNo>",
    "<MobileNo>" + xmlEscape(isMobileFr ? phone : "") + "</MobileNo>",
    "<Email>" + xmlEscape(mrText(email, 70, { allowEmail: true })) + "</Email>",
    "</Address>"
  ].join("");
}
async function boundedText(response, maxBytes = 1000000) {
  if (Number(response.headers.get("content-length") || 0) > maxBytes) throw failure("MONDIAL_RELAY_RESPONSE_TOO_LARGE", "Réponse Mondial Relay trop volumineuse.");
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > maxBytes) throw failure("MONDIAL_RELAY_RESPONSE_TOO_LARGE", "Réponse Mondial Relay trop volumineuse.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function fetchOnce(url, init, { ambiguousCreation = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, { ...init, redirect: "error", signal: controller.signal });
  } catch (error) {
    if (error?.code?.startsWith?.("MONDIAL_RELAY_")) throw error;
    if (ambiguousCreation) throw failure("MONDIAL_RELAY_RECONCILIATION_REQUIRED", "Création Mondial Relay non confirmée. Vérification manuelle requise avant tout nouvel essai.", 502);
    throw failure(controller.signal.aborted ? "MONDIAL_RELAY_TIMEOUT" : "MONDIAL_RELAY_NETWORK_ERROR", "Connexion Mondial Relay indisponible.", 502);
  } finally {
    clearTimeout(timer);
  }
}

export function isMondialRelayServicePointConfigured() {
  return Boolean(rawText(process.env.MONDIAL_RELAY_ENSEIGNE) && rawText(process.env.MONDIAL_RELAY_PRIVATE_KEY));
}
export function isMondialRelayShipmentConfigured() {
  return Boolean(rawText(process.env.MONDIAL_RELAY_API_V2_LOGIN) && rawText(process.env.MONDIAL_RELAY_API_V2_PASSWORD) && rawText(process.env.MONDIAL_RELAY_API_V2_CUSTOMER_ID));
}
export function mondialRelayLabelPurchasesEnabled() {
  return process.env.MONDIAL_RELAY_LIVE_LABELS_ENABLED === "true";
}
export function mondialRelaySecurity(params, privateKey = process.env.MONDIAL_RELAY_PRIVATE_KEY) {
  const key = rawText(privateKey);
  if (!key) throw failure("MONDIAL_RELAY_NOT_CONFIGURED", "Clé privée Mondial Relay absente.", 503);
  return crypto.createHash("md5").update(params.map(value => rawText(value)).join("") + key, "utf8").digest("hex").toUpperCase();
}

export function buildServicePointSearchRequest({ countryCode = "FR", postalCode: cp = "", city = "", relayId = "", weightGrams = "", radius = 15000, limit = 10 } = {}) {
  const enseigne = requiredEnv("MONDIAL_RELAY_ENSEIGNE");
  const values = [
    enseigne,
    country(countryCode),
    relayId ? relayNumber(relayId) : "",
    mrText(city, 30),
    cp ? postalCode(cp) : "",
    "", "",
    "",
    weightGrams ? String(grams(Math.max(10, Number(weightGrams)))) : "",
    "24R",
    "0",
    String(Math.min(50000, Math.max(100, Math.trunc(Number(radius) || 15000)))),
    "", "",
    String(Math.min(30, Math.max(1, Math.trunc(Number(limit) || 10))))
  ];
  const security = mondialRelaySecurity(values);
  const tags = ["Enseigne","Pays","NumPointRelais","Ville","CP","Latitude","Longitude","Taille","Poids","Action","DelaiEnvoi","RayonRecherche","TypeActivite","NACE","NombreResultats"];
  const payload = tags.map((tag, index) => "<" + tag + ">" + xmlEscape(values[index]) + "</" + tag + ">").join("");
  return {
    security,
    xml: '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soap:Body><WSI4_PointRelais_Recherche xmlns="http://www.mondialrelay.fr/webservice/">' +
      payload + "<Security>" + security + "</Security></WSI4_PointRelais_Recherche></soap:Body></soap:Envelope>"
  };
}
export function parseServicePointSearchResponse(xml) {
  const body = String(xml || "");
  const blocks = [...body.matchAll(/<(?:\w+:)?PointRelais_Details\b[^>]*>([\s\S]*?)<\/(?:\w+:)?PointRelais_Details>/gi)].map(match => match[1]);
  return blocks.map(block => {
    const stat = xmlValue(block, "STAT");
    if (stat && stat !== "0") return null;
    const id = xmlValue(block, "Num");
    if (!/^\d+$/.test(id)) return null;
    const distance = Number(String(xmlValue(block, "Distance")).replace(",", "."));
    return {
      id,
      carrierServicePointId: id,
      name: xmlValue(block, "LgAdr1") || xmlValue(block, "LgAdr2") || ("Point Relais " + id),
      street: xmlValue(block, "LgAdr3") || xmlValue(block, "LgAdr2"),
      houseNumber: "",
      postalCode: xmlValue(block, "CP"),
      city: xmlValue(block, "Ville"),
      countryCode: xmlValue(block, "Pays") || "FR",
      latitude: Number(String(xmlValue(block, "Latitude")).replace(",", ".")) || null,
      longitude: Number(String(xmlValue(block, "Longitude")).replace(",", ".")) || null,
      distance: Number.isFinite(distance) ? distance : null,
      information: xmlValue(block, "Information"),
      photoUrl: xmlValue(block, "URL_Photo"),
      planUrl: xmlValue(block, "URL_Plan"),
      carrierCode: "mondial_relay"
    };
  }).filter(Boolean);
}
export async function searchMondialRelayServicePoints(input = {}) {
  if (!isMondialRelayServicePointConfigured()) throw failure("MONDIAL_RELAY_NOT_CONFIGURED", "Recherche Point Relais Mondial Relay non configurée.", 503);
  const request = buildServicePointSearchRequest(input);
  const response = await fetchOnce(SOAP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '"' + SOAP_ACTION + '"', Accept: "text/xml" },
    body: request.xml
  });
  const xml = await boundedText(response);
  if (!response.ok) throw failure("MONDIAL_RELAY_API_ERROR", "Recherche Point Relais refusée (HTTP " + response.status + ").", 502, { providerStatus: response.status });
  const points = parseServicePointSearchResponse(xml);
  return { points, count: points.length };
}

export function buildShipmentCreationXml({ orderNumber, reference = "", toAddress, toEmail = "", fromAddress, fromEmail = "", fromCompanyName = "", weightGrams, totalOrderValue = 0, servicePointId, content = "CARTES TCG" } = {}) {
  const login = requiredEnv("MONDIAL_RELAY_API_V2_LOGIN");
  const password = requiredEnv("MONDIAL_RELAY_API_V2_PASSWORD");
  const customerId = requiredEnv("MONDIAL_RELAY_API_V2_CUSTOMER_ID");
  const relay = relayNumber(servicePointId);
  const order = mrText(orderNumber, 15, { required: true });
  const customerNo = mrText(reference || orderNumber, 15);
  const parcelWeight = grams(weightGrams);
  const amount = Number(totalOrderValue);
  if (!Number.isFinite(amount) || amount < 0) throw failure("MONDIAL_RELAY_INPUT_INVALID", "Valeur de commande Mondial Relay invalide.", 400);
  const outputFormat = ["A4","A5","10X15"].includes(rawText(process.env.MONDIAL_RELAY_LABEL_FORMAT || "10x15").toUpperCase()) ? rawText(process.env.MONDIAL_RELAY_LABEL_FORMAT || "10x15") : "10x15";
  const sender = addressXml(fromAddress, fromEmail, fromCompanyName || fromAddress?.recipientName || fromAddress?.name);
  const recipient = addressXml(toAddress, toEmail, toAddress?.recipientName || toAddress?.name);
  const valueXml = amount > 0 ? "<ShipmentValue><Amount>" + amount.toFixed(2) + "</Amount><Currency>EUR</Currency></ShipmentValue>" : "";
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<ShipmentCreationRequest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.example.org/Request">' +
    "<Context><Login>" + xmlEscape(login) + "</Login><Password>" + xmlEscape(password) + "</Password><CustomerId>" + xmlEscape(customerId) + "</CustomerId><Culture>fr-FR</Culture><VersionAPI>1.0</VersionAPI></Context>" +
    "<OutputOptions><OutputFormat>" + xmlEscape(outputFormat) + "</OutputFormat><OutputType>PdfUrl</OutputType></OutputOptions>" +
    "<ShipmentsList><Shipment><OrderNo>" + xmlEscape(order) + "</OrderNo><CustomerNo>" + xmlEscape(customerNo) + "</CustomerNo><ParcelCount>1</ParcelCount>" +
    valueXml +
    '<DeliveryMode Mode="24R" Location="' + xmlEscape(country(toAddress?.countryCode || "FR") + "-" + relay) + '" />' +
    '<CollectionMode Mode="CCC" Location="" />' +
    "<Parcels><Parcel><Content>" + xmlEscape(mrText(content, 40)) + "</Content><Weight Value=\"" + parcelWeight + "\" Unit=\"gr\" /></Parcel></Parcels>" +
    "<Sender>" + sender + "</Sender><Recipient>" + recipient + "</Recipient></Shipment></ShipmentsList></ShipmentCreationRequest>";
}
function parseStatuses(xml) {
  const statusBlocks = [...String(xml || "").matchAll(/<(?:\w+:)?Status\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Status>/gi)];
  return statusBlocks.map(match => ({
    code: xmlAttribute("<Status " + match[1] + ">", "Status", "Code") || xmlValue(match[2], "Code"),
    level: xmlAttribute("<Status " + match[1] + ">", "Status", "Level") || xmlValue(match[2], "Level"),
    message: xmlAttribute("<Status " + match[1] + ">", "Status", "Message") || xmlValue(match[2], "Message")
  }));
}
export function parseShipmentCreationResponse(xml) {
  const body = String(xml || "");
  const statuses = parseStatuses(body);
  const fatal = statuses.find(item => /error|critical/i.test(item.level || "") || (item.code && item.code !== "0"));
  if (fatal) throw failure("MONDIAL_RELAY_CREATION_REJECTED", "Mondial Relay a refusé la création de l'étiquette.", 502, { providerCode: fatal.code || "", providerLevel: fatal.level || "" });
  const shipmentMatch = body.match(/<(?:\w+:)?Shipment\b[^>]*\bShipmentNumber="([^"]+)"/i);
  const shipmentNumber = shipmentMatch ? xmlDecode(shipmentMatch[1]) : "";
  const output = xmlValue(body, "Output");
  if (!shipmentNumber || !output) throw failure("MONDIAL_RELAY_CREATION_INVALID", "Réponse Mondial Relay incomplète : numéro d'expédition ou PDF absent.", 502);
  return { shipmentNumber, labelUrl: output, statuses };
}
export async function createMondialRelayShipment(input = {}) {
  if (!mondialRelayLabelPurchasesEnabled()) throw failure("MONDIAL_RELAY_LABELS_NOT_ACTIVATED", "Création réelle d'étiquettes Mondial Relay désactivée.", 503);
  if (!isMondialRelayShipmentConfigured()) throw failure("MONDIAL_RELAY_NOT_CONFIGURED", "API V2 Mondial Relay non configurée.", 503);
  const env = rawText(process.env.MONDIAL_RELAY_API_V2_ENV || "sandbox").toLowerCase();
  const url = SHIPMENT_URLS[env] || SHIPMENT_URLS.sandbox;
  const xml = buildShipmentCreationXml(input);
  const response = await fetchOnce(url, {
    method: "POST",
    headers: { Accept: "application/xml", "Content-Type": "text/xml" },
    body: xml
  }, { ambiguousCreation: true });
  const responseXml = await boundedText(response, 2000000);
  if (!response.ok) throw failure("MONDIAL_RELAY_API_ERROR", "Création Mondial Relay refusée (HTTP " + response.status + ").", 502, { providerStatus: response.status });
  const parsed = parseShipmentCreationResponse(responseXml);
  return { ...parsed, provider: "mondial_relay_direct", status: "READY_TO_SEND", trackingNumber: parsed.shipmentNumber, trackingUrl: "" };
}
function safeLabelUrl(value) {
  let url;
  try { url = new URL(xmlDecode(value)); } catch { throw failure("MONDIAL_RELAY_LABEL_INVALID", "URL d'étiquette Mondial Relay invalide."); }
  if (url.protocol === "http:" && url.hostname.toLowerCase() === "connect.mondialrelay.com") url.protocol = "https:";
  if (url.protocol !== "https:" || !LABEL_HOSTS.has(url.hostname.toLowerCase())) throw failure("MONDIAL_RELAY_LABEL_INVALID", "Hôte d'étiquette Mondial Relay non autorisé.");
  return url.toString();
}
export async function downloadMondialRelayLabel(labelUrl) {
  const url = safeLabelUrl(labelUrl);
  const response = await fetchOnce(url, { method: "GET", headers: { Accept: "application/pdf" } });
  if (!response.ok) throw failure("MONDIAL_RELAY_LABEL_UNAVAILABLE", "Étiquette Mondial Relay indisponible (HTTP " + response.status + ").");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 10000000) throw failure("MONDIAL_RELAY_RESPONSE_TOO_LARGE", "Étiquette Mondial Relay trop volumineuse.");
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > 10000000) throw failure("MONDIAL_RELAY_RESPONSE_TOO_LARGE", "Étiquette Mondial Relay trop volumineuse.");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString() !== "%PDF-") throw failure("MONDIAL_RELAY_LABEL_INVALID", "Mondial Relay n'a pas retourné un PDF valide.");
  return bytes;
}
