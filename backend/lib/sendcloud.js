/** Sendcloud API v3. Credentials stay server-side; no silent truncation or home-delivery fallback. */
const BASE_URL = "https://panel.sendcloud.sc/api/v3";
const failure = (code, message, status = 502) => Object.assign(new Error(message), { code, status });

function text(value, max = 200, required = false) {
  if (value != null && !["string", "number"].includes(typeof value)) throw failure("SENDCLOUD_INPUT_INVALID", "Champ d'expédition invalide.", 400);
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw failure("SENDCLOUD_INPUT_INVALID", "Champ d'expédition manquant, trop long ou invalide.", 400);
  return result;
}
function country(value) {
  const code = text(value, 2, true).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw failure("SENDCLOUD_COUNTRY_INVALID", "Code pays invalide.", 400);
  return code;
}
function positiveId(value) {
  const id = String(value ?? "");
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw failure("SERVICE_POINT_INVALID", "Identifiant colis ou relais invalide.", 400);
  return Number(id);
}
function contractRef(value) {
  if (value == null || value === "") return undefined;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw failure("SENDCLOUD_INPUT_INVALID", "Identifiant de contrat Sendcloud invalide.", 400);
  return id;
}
function servicePointRef(value) {
  return { id: String(positiveId(value)) };
}
function weight(value) {
  const grams = Number(value);
  if (!Number.isSafeInteger(grams) || grams <= 0 || grams > 25000) throw failure("SHIPMENT_WEIGHT_REQUIRED", "Poids entier compris entre 1 g et 25 kg requis.", 400);
  return { value: (grams / 1000).toFixed(3), unit: "kg" };
}
function compact(object) {
  const result = {};
  for (const [key, value] of Object.entries(object || {})) {
    if (value == null || value === "") continue;
    result[key] = value;
  }
  return result;
}
function credentials() {
  const publicKey = String(process.env.SENDCLOUD_PUBLIC_KEY || "").trim();
  const secretKey = String(process.env.SENDCLOUD_SECRET_KEY || "").trim();
  if (!publicKey || !secretKey) throw failure("SENDCLOUD_NOT_CONFIGURED", "Sendcloud non configuré côté serveur.", 503);
  return "Basic " + Buffer.from(publicKey + ":" + secretKey).toString("base64");
}
export function isSendcloudConfigured() {
  return Boolean(String(process.env.SENDCLOUD_PUBLIC_KEY || "").trim() && String(process.env.SENDCLOUD_SECRET_KEY || "").trim());
}
function logMeta(event, meta = {}) {
  console.info("[sendcloud]", event, JSON.stringify(compact(meta)));
}
function quoteAmount(option) {
  const quotes = option?.quotes;
  const candidates = Array.isArray(quotes) ? quotes : quotes && typeof quotes === "object" ? [quotes.price ? quotes : null, quotes.total, ...(Array.isArray(quotes.items) ? quotes.items : [])].filter(Boolean) : [];
  for (const entry of candidates) {
    const price = entry?.price || entry;
    const value = price?.value ?? price?.amount;
    const currency = String(price?.currency || price?.currency_code || "EUR").toUpperCase();
    if (value == null || value === "") continue;
    const amount = Number(value);
    if (Number.isFinite(amount) && amount >= 0) return { value: amount.toFixed(2), currency, amount };
  }
  return null;
}
function mapApiError(status, data) {
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  const codes = errors.map((item) => String(item?.code || "").toLowerCase());
  const details = errors.map((item) => String(item?.detail || item?.title || "")).join(" ").toLowerCase();
  if (codes.includes("no_valid_payment_method") || details.includes("no valid payment method")) {
    return failure("ACCOUNT_PAYMENT_METHOD_REQUIRED", "Le compte Sendcloud n'a pas de moyen de paiement valide.", 402);
  }
  return Object.assign(failure("SENDCLOUD_API_ERROR", "Requête Sendcloud refusée (HTTP " + status + ")."), { sendcloudStatus: status, sendcloudErrorCode: codes[0] || "" });
}
async function boundedBody(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) throw failure("SENDCLOUD_RESPONSE_TOO_LARGE", "Réponse transporteur trop volumineuse.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > maxBytes) throw failure("SENDCLOUD_RESPONSE_TOO_LARGE", "Réponse transporteur trop volumineuse.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function request(path, { method = "GET", body, pdf = false } = {}) {
  const authorization = credentials();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const headers = { Authorization: authorization, Accept: pdf ? "application/pdf" : "application/json" };
    if (body != null) headers["Content-Type"] = "application/json";
    const response = await fetch(BASE_URL + path, {
      method,
      redirect: "error",
      signal: controller.signal,
      headers,
      body: body == null ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      const bytes = await boundedBody(response, 200000);
      let data = {};
      try { data = JSON.parse(bytes.toString("utf8")); } catch { data = {}; }
      throw mapApiError(response.status, data);
    }
    const bytes = await boundedBody(response, pdf ? 10000000 : 2000000);
    if (pdf) {
      if (!String(response.headers.get("content-type") || "").toLowerCase().startsWith("application/pdf") || bytes.subarray(0, 5).toString() !== "%PDF-") {
        throw failure("SENDCLOUD_LABEL_INVALID", "Le transporteur n'a pas retourné une étiquette PDF.");
      }
      return bytes;
    }
    let data;
    try { data = JSON.parse(bytes.toString("utf8")); } catch { throw failure("SENDCLOUD_RESPONSE_INVALID", "Réponse JSON Sendcloud invalide."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw failure("SENDCLOUD_RESPONSE_INVALID", "Réponse Sendcloud invalide.");
    return data;
  } catch (error) {
    if (error?.code?.startsWith("SENDCLOUD_") || error?.code === "ACCOUNT_PAYMENT_METHOD_REQUIRED" || error?.code === "SERVICE_POINT_INVALID" || error?.code === "MONDIAL_RELAY_MOBILE_REQUIRED") throw error;
    throw failure(controller.signal.aborted ? "SENDCLOUD_TIMEOUT" : "SENDCLOUD_NETWORK_ERROR", "Réponse Sendcloud non confirmée. Aucun nouvel essai automatique.");
  } finally {
    clearTimeout(timeout);
  }
}

export function splitHouseNumber(addressLine1, providedHouseNumber = "") {
  const line = text(addressLine1, 160, true);
  const provided = text(providedHouseNumber, 20);
  if (provided) return { address_line_1: line, house_number: provided };
  const match = line.match(/^(\d+[a-zA-Z]?(?:\s*(?:bis|ter|quater))?)\s+(.+)$/i);
  if (!match) return { address_line_1: line };
  return { address_line_1: line, house_number: match[1].replace(/\s+/g, " ").trim() };
}

export function normalizeSendcloudAddress(address = {}, { email = "", fallbackName = "", companyName = "" } = {}) {
  const line = text(address.addressLine1 || address.address_line_1, 160, true);
  const split = splitHouseNumber(line, address.houseNumber || address.house_number);
  const result = compact({
    name: text(address.recipientName || address.name || fallbackName, 120, true),
    company_name: text(companyName || address.companyName, 160),
    address_line_1: split.address_line_1,
    address_line_2: text(address.addressLine2 || address.address_line_2, 160),
    house_number: split.house_number,
    postal_code: text(address.postalCode || address.postal_code, 12, true),
    city: text(address.city, 120, true),
    country_code: country(address.countryCode || address.country_code || "FR"),
    phone_number: text(address.phone || address.phone_number, 32),
    email: text(email || address.email, 254)
  });
  if (result.email && !/^\S+@\S+\.\S+$/.test(result.email)) throw failure("SENDCLOUD_INPUT_INVALID", "Email destinataire invalide.", 400);
  return result;
}

function shippingOptionAddress(address = {}, fallbackCountry = "FR") {
  if (address && typeof address === "object" && (address.address_line_1 || address.postal_code || address.city || address.country_code)) {
    return compact({
      country_code: country(address.country_code || fallbackCountry),
      postal_code: text(address.postal_code, 12),
      city: text(address.city, 120),
      address_line_1: text(address.address_line_1, 160)
    });
  }
  return compact({ country_code: country(fallbackCountry) });
}

export function requireMondialRelayMobile(value) {
  const phone = text(value, 32, true).replace(/[ .()-]/g, "");
  const normalized = /^0[67]\d{8}$/.test(phone) ? "+33" + phone.slice(1) : phone.replace(/^00/, "+");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized) || (normalized.startsWith("+33") && !/^\+33[67]\d{8}$/.test(normalized))) {
    throw failure("MONDIAL_RELAY_MOBILE_REQUIRED", "Un numéro de portable valide est requis pour Mondial Relay.", 400);
  }
  return normalized;
}

function pointView(point) {
  if (!point || !point.address) throw failure("SENDCLOUD_RESPONSE_INVALID", "Point Relais absent de la réponse.");
  const a = point.address;
  return {
    id: positiveId(point.id),
    carrierServicePointId: text(point.carrier_service_point_id, 120),
    name: text(point.name, 160, true),
    carrierCode: text(point.carrier?.code, 80, true),
    carrierName: text(point.carrier?.name, 120),
    shopType: text(point.general_shop_type, 60),
    street: text(a.street, 160),
    houseNumber: text(a.house_number, 30),
    postalCode: text(a.postal_code, 24),
    city: text(a.city, 120),
    countryCode: country(a.country_code),
    distance: Number(point.distance) || 0,
    openingTimes: point.opening_times || null,
    active: point.is_active !== false
  };
}

export async function searchMondialRelayServicePoints({ countryCode = "FR", postalCode = "", city = "", address = "", limit = 10, radius = 10000 } = {}) {
  const requestedCountry = country(countryCode);
  const params = new URLSearchParams({ country_code: requestedCountry, carrier_code: "mondial_relay" });
  if (text(address, 240)) params.set("address", text(address, 240));
  else {
    if (postalCode) params.set("address_postal_code", text(postalCode, 24));
    if (city) params.set("address_city", text(city, 120));
  }
  if (!address && !postalCode && !city) throw failure("SENDCLOUD_INPUT_INVALID", "Adresse de recherche requise.", 400);
  params.set("limit", String(Math.max(1, Math.min(30, Number(limit) || 10))));
  params.set("radius", String(Math.max(100, Math.min(50000, Number(radius) || 10000))));
  const payload = await request("/service-points?" + params);
  if (!Array.isArray(payload.data?.results)) throw failure("SENDCLOUD_RESPONSE_INVALID", "Liste des relais absente.");
  return {
    points: payload.data.results.map(pointView).filter((p) => p.active && p.carrierCode === "mondial_relay" && p.countryCode === requestedCountry),
    geocoding: payload.data.geocoding || null
  };
}

export async function getServicePoint(id) {
  const payload = await request("/service-points/" + positiveId(id));
  const point = pointView(payload.data);
  if (point.id !== Number(id)) throw failure("SERVICE_POINT_MISMATCH", "Point Relais incohérent.", 409);
  return point;
}

function optionText(option) {
  return `${option?.code || ""} ${option?.name || ""} ${option?.product?.name || ""}`.toLowerCase();
}
function selectCompatibleOption(options, carrier, mondialRelay, { domestic = false } = {}) {
  let compatible = options.filter((option) => {
    if (!option?.code || option.carrier?.code !== carrier) return false;
    if (option.functionalities?.returns === true || option.functionalities?.labelless === true) return false;
    if (mondialRelay) {
      if (option.functionalities?.last_mile !== "service_point") return false;
      if (option.requirements?.is_home_delivery_required === true) return false;
      return true;
    }
    return option.functionalities?.last_mile !== "service_point" && option.requirements?.is_service_point_required !== true;
  });
  if (domestic) {
    const local = compatible.filter((option) => !optionText(option).includes("international"));
    if (local.length) compatible = local;
  }
  if (!compatible.length) throw failure("SENDCLOUD_SHIPPING_OPTION_UNAVAILABLE", "Aucune méthode compatible avec le transporteur et la destination demandés.", 409);
  const withQuote = compatible.map((option) => ({ option, quote: quoteAmount(option) }));
  withQuote.sort((a, b) => {
    if (a.quote && b.quote) return a.quote.amount - b.quote.amount;
    if (a.quote && !b.quote) return -1;
    if (!a.quote && b.quote) return 1;
    return 0;
  });
  return withQuote[0];
}

export async function resolveShippingOption({
  carrierCode,
  toCountry = "FR",
  fromCountry = "FR",
  weightGrams,
  servicePointId = null,
  fromPostalCode = "",
  toPostalCode = "",
  fromAddress = null,
  toAddress = null,
  calculateQuotes = true,
  contractId = null
} = {}) {
  const carrier = text(carrierCode, 80, true);
  const mondialRelay = carrier === "mondial_relay";
  const from = shippingOptionAddress(fromAddress, fromCountry);
  const to = shippingOptionAddress(toAddress, toCountry);
  if (fromPostalCode && !from.postal_code) from.postal_code = text(fromPostalCode, 12);
  if (toPostalCode && !to.postal_code) to.postal_code = text(toPostalCode, 12);
  const body = compact({
    from_address: from,
    to_address: to,
    parcels: [{ weight: weight(weightGrams) }],
    carrier_code: carrier,
    calculate_quotes: calculateQuotes !== false,
    functionalities: compact({ last_mile: mondialRelay ? "service_point" : undefined, returns: false, labelless: false }),
    to_service_point: mondialRelay ? servicePointRef(servicePointId) : undefined,
    contract_id: contractRef(contractId)
  });
  const payload = await request("/shipping-options", { method: "POST", body });
  const options = Array.isArray(payload.data) ? payload.data : [];
  const selected = selectCompatibleOption(options, carrier, mondialRelay, { domestic: from.country_code === to.country_code });
  return {
    code: text(selected.option.code, 240, true),
    name: text(selected.option.name || selected.option.product?.name, 240),
    contractId: contractRef(selected.option.contract?.id) || contractRef(contractId) || null,
    carrierCode: carrier,
    lastMile: text(selected.option.functionalities?.last_mile, 80),
    quote: selected.quote
  };
}

function httpsTrackingUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {}
  return "";
}

export async function createSendcloudShipment({
  orderNumber,
  reference,
  toAddress,
  toEmail,
  fromAddress,
  fromEmail,
  fromCompanyName,
  weightGrams,
  totalOrderValue = 0,
  carrierCode = "mondial_relay",
  servicePointId = null
} = {}) {
  const id = text(orderNumber, 160, true);
  const parcelWeight = weight(weightGrams);
  const to = normalizeSendcloudAddress(toAddress, { email: toEmail });
  const from = normalizeSendcloudAddress(fromAddress, { email: fromEmail, companyName: fromCompanyName });
  if (!Number.isFinite(Number(totalOrderValue)) || Number(totalOrderValue) < 0) throw failure("SENDCLOUD_INPUT_INVALID", "Valeur du colis invalide.", 400);
  let point = null;
  if (carrierCode === "mondial_relay") {
    to.phone_number = requireMondialRelayMobile(to.phone_number);
    point = await getServicePoint(positiveId(servicePointId));
    if (!point.active || point.carrierCode !== "mondial_relay" || point.countryCode !== to.country_code) {
      throw failure("SERVICE_POINT_MISMATCH", "Le relais ne correspond pas à Mondial Relay ou au pays demandé.", 409);
    }
  }
  const option = await resolveShippingOption({
    carrierCode,
    fromAddress: from,
    toAddress: to,
    fromCountry: from.country_code,
    toCountry: to.country_code,
    weightGrams,
    servicePointId,
    calculateQuotes: true
  });
  const shipWith = { type: "shipping_option_code", properties: compact({ shipping_option_code: option.code, contract_id: contractRef(option.contractId) }) };
  const body = compact({
    label_details: { mime_type: "application/pdf", dpi: 72 },
    to_address: to,
    from_address: from,
    ship_with: shipWith,
    order_number: id,
    external_reference_id: id,
    reference: text(reference || id, 160),
    total_order_price: { currency: "EUR", value: Number(totalOrderValue).toFixed(2) },
    parcels: [{ weight: parcelWeight }],
    to_service_point: carrierCode === "mondial_relay" ? servicePointRef(servicePointId) : undefined
  });
  logMeta("announce_requested", { orderNumber: id, carrierCode, optionCode: option.code, servicePointId: point?.id || null, weightGrams });
  const payload = await request("/shipments/announce", { method: "POST", body });
  const data = payload.data;
  const parcel = data?.parcels?.[0];
  if (payload.errors?.length || data?.errors?.length || parcel?.errors?.length || !data?.id || !parcel?.id || /FAIL|ERROR|REJECT|CANCEL/i.test(String(parcel?.status?.code || data?.status?.code || ""))) {
    throw failure("SENDCLOUD_ANNOUNCEMENT_FAILED", "Création de l'étiquette non confirmée par le transporteur.");
  }
  const label = parcel.documents?.find((document) => document.type === "label");
  if (!label || data.carrier?.code !== carrierCode) throw failure("SENDCLOUD_ANNOUNCEMENT_FAILED", "Étiquette ou transporteur incohérent. Rapprochement requis.");
  const parcelId = String(positiveId(parcel.id));
  logMeta("announce_confirmed", { orderNumber: id, shipmentId: String(data.id), parcelId, carrierCode, optionCode: option.code });
  return {
    shipmentId: String(data.id),
    parcelId,
    trackingNumber: text(parcel.tracking_number, 160),
    trackingUrl: httpsTrackingUrl(parcel.tracking_url),
    labelUrl: BASE_URL + "/parcels/" + parcelId + "/documents/label",
    status: text(parcel.status?.code || "READY_TO_SEND", 80),
    carrierCode,
    shippingOptionCode: option.code,
    shippingOptionName: option.name,
    quote: option.quote
  };
}

export async function getSendcloudShipment(shipmentId) {
  const payload = await request("/shipments/" + encodeURIComponent(text(shipmentId, 160, true)));
  const data = payload.data;
  if (!data?.id) throw failure("SENDCLOUD_RESPONSE_INVALID", "Expédition Sendcloud introuvable.");
  const parcel = data.parcels?.[0] || {};
  return {
    shipmentId: String(data.id),
    parcelId: parcel.id != null ? String(positiveId(parcel.id)) : "",
    status: text(parcel.status?.code || data.status?.code || "", 80),
    trackingNumber: text(parcel.tracking_number, 160),
    trackingUrl: httpsTrackingUrl(parcel.tracking_url),
    carrierCode: text(data.carrier?.code, 80)
  };
}

export async function getSendcloudTracking(shipmentId) {
  const shipment = await getSendcloudShipment(shipmentId);
  if (!shipment.trackingNumber) throw failure("SENDCLOUD_TRACKING_UNAVAILABLE", "Numéro de suivi indisponible.", 409);
  return shipment;
}

export async function downloadSendcloudLabel(parcelId) {
  return request("/parcels/" + positiveId(parcelId) + "/documents/label?dpi=72", { pdf: true });
}

export async function cancelSendcloudShipment(shipmentId) {
  const id = text(shipmentId, 160, true);
  const payload = await request("/shipments/" + encodeURIComponent(id) + "/cancel", { method: "POST" });
  const status = text(payload.data?.status, 80);
  return { status: status || "cancellation_requested", confirmed: status === "cancelled" };
}
