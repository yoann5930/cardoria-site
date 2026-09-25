/** Sendcloud v3. Credentials stay server-side; no silent address truncation or carrier fallback. */
const BASE_URL = "https://panel.sendcloud.sc/api/v3";
const failure = (code, message, status = 502) => Object.assign(new Error(message), { code, status });
function text(value, max = 200, required = false) {
  if (value != null && !["string", "number"].includes(typeof value)) throw failure("SENDCLOUD_INPUT_INVALID", "Champ d'expédition invalide.", 400);
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw failure("SENDCLOUD_INPUT_INVALID", "Champ d'expédition manquant, trop long ou invalide.", 400);
  return result;
}
function country(value) { const code = text(value, 2, true).toUpperCase(); if (!/^[A-Z]{2}$/.test(code)) throw failure("SENDCLOUD_COUNTRY_INVALID", "Code pays invalide.", 400); return code; }
function positiveId(value) { const id = String(value ?? ""); if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw failure("SERVICE_POINT_INVALID", "Identifiant colis ou relais invalide.", 400); return Number(id); }
function weight(value) { const grams = Number(value); if (!Number.isSafeInteger(grams) || grams <= 0 || grams > 25000) throw failure("SHIPMENT_WEIGHT_REQUIRED", "Poids entier compris entre 1 g et 25 kg requis.", 400); return { value: (grams / 1000).toFixed(3), unit: "kg" }; }
function credentials() {
  const publicKey = String(process.env.SENDCLOUD_PUBLIC_KEY || "").trim(), secretKey = String(process.env.SENDCLOUD_SECRET_KEY || "").trim();
  if (!publicKey || !secretKey) throw failure("SENDCLOUD_NOT_CONFIGURED", "Sendcloud non configuré côté serveur.", 503);
  return "Basic " + Buffer.from(publicKey + ":" + secretKey).toString("base64");
}
export function isSendcloudConfigured() { return Boolean(String(process.env.SENDCLOUD_PUBLIC_KEY || "").trim() && String(process.env.SENDCLOUD_SECRET_KEY || "").trim()); }
async function boundedBody(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) throw failure("SENDCLOUD_RESPONSE_TOO_LARGE", "Réponse transporteur trop volumineuse.");
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) { size += chunk.length; if (size > maxBytes) throw failure("SENDCLOUD_RESPONSE_TOO_LARGE", "Réponse transporteur trop volumineuse."); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
async function request(path, { method = "GET", body, pdf = false } = {}) {
  const authorization = credentials(), controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(BASE_URL + path, { method, redirect: "error", signal: controller.signal, headers: { Authorization: authorization, Accept: pdf ? "application/pdf" : "application/json", "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
    if (!response.ok) throw Object.assign(failure("SENDCLOUD_API_ERROR", "Requête Sendcloud refusée (HTTP " + response.status + ")."), { sendcloudStatus: response.status });
    const bytes = await boundedBody(response, pdf ? 10000000 : 2000000);
    if (pdf) {
      if (!String(response.headers.get("content-type") || "").toLowerCase().startsWith("application/pdf") || bytes.subarray(0, 5).toString() !== "%PDF-") throw failure("SENDCLOUD_LABEL_INVALID", "Le transporteur n'a pas retourné une étiquette PDF.");
      return bytes;
    }
    let data; try { data = JSON.parse(bytes.toString("utf8")); } catch { throw failure("SENDCLOUD_RESPONSE_INVALID", "Réponse JSON Sendcloud invalide."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw failure("SENDCLOUD_RESPONSE_INVALID", "Réponse Sendcloud invalide.");
    return data;
  } catch (error) {
    if (error?.code?.startsWith("SENDCLOUD_")) throw error;
    throw failure(controller.signal.aborted ? "SENDCLOUD_TIMEOUT" : "SENDCLOUD_NETWORK_ERROR", "Réponse Sendcloud non confirmée. Aucun nouvel essai automatique.");
  } finally { clearTimeout(timeout); }
}
export function normalizeSendcloudAddress(address = {}, { email = "", fallbackName = "", companyName = "" } = {}) {
  // These are Cardoria input limits, not a guarantee of carrier acceptance.
  // Let the carrier reject its own restrictions rather than silently losing data.
  const result = {
    name: text(address.recipientName || address.name || fallbackName, 120, true),
    company_name: text(companyName || address.companyName, 160),
    address_line_1: text(address.addressLine1 || address.address_line_1, 160, true),
    address_line_2: text(address.addressLine2 || address.address_line_2, 160),
    house_number: text(address.houseNumber || address.house_number, 20),
    postal_code: text(address.postalCode || address.postal_code, 12, true),
    city: text(address.city, 120, true), country_code: country(address.countryCode || address.country_code || "FR"),
    phone_number: text(address.phone || address.phone_number, 32), email: text(email || address.email, 254)
  };
  if (result.email && !/^\S+@\S+\.\S+$/.test(result.email)) throw failure("SENDCLOUD_INPUT_INVALID", "Email destinataire invalide.", 400);
  return result;
}
export function requireMondialRelayMobile(value) {
  const phone = text(value, 32, true).replace(/[ .()-]/g, "");
  const normalized = /^0[67]\d{8}$/.test(phone) ? "+33" + phone.slice(1) : phone.replace(/^00/, "+");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized) || (normalized.startsWith("+33") && !/^\+33[67]\d{8}$/.test(normalized))) throw failure("MONDIAL_RELAY_MOBILE_REQUIRED", "Un numéro de portable valide est requis pour Mondial Relay.", 400);
  return normalized;
}
function pointView(point) {
  if (!point || !point.address) throw failure("SENDCLOUD_RESPONSE_INVALID", "Point Relais absent de la réponse.");
  const a = point.address;
  return { id: positiveId(point.id), carrierServicePointId: text(point.carrier_service_point_id, 120), name: text(point.name, 160, true), carrierCode: text(point.carrier?.code, 80, true), carrierName: text(point.carrier?.name, 120), shopType: text(point.general_shop_type, 60), street: text(a.street, 160), houseNumber: text(a.house_number, 30), postalCode: text(a.postal_code, 24), city: text(a.city, 120), countryCode: country(a.country_code), distance: Number(point.distance) || 0, openingTimes: point.opening_times || null, active: point.is_active !== false };
}
export async function searchMondialRelayServicePoints({ countryCode = "FR", postalCode = "", city = "", address = "", limit = 10, radius = 10000 } = {}) {
  const requestedCountry = country(countryCode), params = new URLSearchParams({ country_code: requestedCountry, carrier_code: "mondial_relay" });
  if (text(address, 240)) params.set("address", text(address, 240));
  else { if (postalCode) params.set("address_postal_code", text(postalCode, 24)); if (city) params.set("address_city", text(city, 120)); }
  if (!address && !postalCode && !city) throw failure("SENDCLOUD_INPUT_INVALID", "Adresse de recherche requise.", 400);
  params.set("limit", String(Math.max(1, Math.min(30, Number(limit) || 10)))); params.set("radius", String(Math.max(100, Math.min(50000, Number(radius) || 10000))));
  const payload = await request("/service-points?" + params);
  if (!Array.isArray(payload.data?.results)) throw failure("SENDCLOUD_RESPONSE_INVALID", "Liste des relais absente.");
  return { points: payload.data.results.map(pointView).filter(p => p.active && p.carrierCode === "mondial_relay" && p.countryCode === requestedCountry), geocoding: payload.data.geocoding || null };
}
export async function getServicePoint(id) { const payload = await request("/service-points/" + positiveId(id)); const point = pointView(payload.data); if (point.id !== Number(id)) throw failure("SERVICE_POINT_MISMATCH", "Point Relais incohérent.", 409); return point; }
function normalizeLabelMode(value = "print") {
  const mode = text(value || "print", 20).toLowerCase();
  if (!["print", "qr"].includes(mode)) throw failure("SENDCLOUD_LABEL_MODE_INVALID", "Mode d'étiquette Sendcloud invalide.", 400);
  return mode;
}

export async function resolveShippingOption({ carrierCode, toCountry = "FR", fromCountry = "FR", weightGrams, servicePointId = null, fromPostalCode = "", toPostalCode = "", labelMode = "print" } = {}) {
  const carrier = text(carrierCode, 80, true), mr = carrier === "mondial_relay", mode = normalizeLabelMode(labelMode);
  if (mode === "qr" && !mr) throw failure("SENDCLOUD_QR_CARRIER_UNSUPPORTED", "Le mode QR est actuellement activé uniquement pour Mondial Relay.", 409);
  const wantsLabelless = mode === "qr";
  const body = { from_country_code: country(fromCountry), to_country_code: country(toCountry), parcels: [{ weight: weight(weightGrams) }], carrier_code: carrier, calculate_quotes: false, functionalities: { returns: false, labelless: wantsLabelless } };
  if (fromPostalCode) body.from_postal_code = text(fromPostalCode, 12);
  if (toPostalCode) body.to_postal_code = text(toPostalCode, 12);
  if (mr) { body.to_service_point = { id: positiveId(servicePointId) }; body.functionalities.last_mile = "service_point"; }
  const payload = await request("/shipping-options", { method: "POST", body });
  const options = Array.isArray(payload.data) ? payload.data : [];
  const selected = options.find(o => o?.code && o.carrier?.code === carrier && o.functionalities?.returns !== true && Boolean(o.functionalities?.labelless) === wantsLabelless && (mr ? o.functionalities?.last_mile === "service_point" : o.functionalities?.last_mile !== "service_point" && o.requirements?.is_service_point_required !== true));
  if (!selected) throw failure("SENDCLOUD_SHIPPING_OPTION_UNAVAILABLE", mode === "qr" ? "Aucune méthode QR Mondial Relay compatible avec ce compte, ce poids et cette destination." : "Aucune méthode d'étiquette imprimable compatible avec le transporteur et la destination demandés.", 409);
  return { code: text(selected.code, 240, true), name: text(selected.name || selected.product?.name, 240), contractId: selected.contract?.id || null, carrierCode: carrier, labelMode: mode, labelless: wantsLabelless };
}

export async function probeMondialRelayLabelCapabilities({ toCountry = "FR", fromCountry = "FR", weightGrams, servicePointId, fromPostalCode = "", toPostalCode = "" } = {}) {
  const base = { carrierCode: "mondial_relay", toCountry, fromCountry, weightGrams, servicePointId, fromPostalCode, toPostalCode };
  const result = { carrierCode: "mondial_relay", print: { available: false }, qr: { available: false } };
  for (const mode of ["print", "qr"]) {
    try {
      const option = await resolveShippingOption({ ...base, labelMode: mode });
      result[mode] = { available: true, code: option.code, name: option.name };
    } catch (error) {
      if (error?.code !== "SENDCLOUD_SHIPPING_OPTION_UNAVAILABLE") throw error;
      result[mode] = { available: false };
    }
  }
  return result;
}
export async function createSendcloudShipment({ orderNumber, reference, toAddress, toEmail, fromAddress, fromEmail, fromCompanyName, weightGrams, totalOrderValue = 0, carrierCode = "mondial_relay", servicePointId = null } = {}) {
  const id = text(orderNumber, 160, true), parcelWeight = weight(weightGrams);
  const to = normalizeSendcloudAddress(toAddress, { email: toEmail }), from = normalizeSendcloudAddress(fromAddress, { email: fromEmail, companyName: fromCompanyName });
  if (!Number.isFinite(Number(totalOrderValue)) || Number(totalOrderValue) < 0) throw failure("SENDCLOUD_INPUT_INVALID", "Valeur du colis invalide.", 400);
  if (carrierCode === "mondial_relay") {
    to.phone_number = requireMondialRelayMobile(to.phone_number);
    const point = await getServicePoint(positiveId(servicePointId));
    if (!point.active || point.carrierCode !== "mondial_relay" || point.countryCode !== to.country_code) throw failure("SERVICE_POINT_MISMATCH", "Le relais ne correspond pas à Mondial Relay ou au pays demandé.", 409);
  }
  const option = await resolveShippingOption({ carrierCode, toCountry: to.country_code, fromCountry: from.country_code, fromPostalCode: from.postal_code, toPostalCode: to.postal_code, weightGrams, servicePointId });
  const shipWith = { type: "shipping_option_code", properties: { shipping_option_code: option.code } };
  if (option.contractId) shipWith.properties.contract_id = option.contractId;
  const body = { label_details: { mime_type: "application/pdf", dpi: 72 }, to_address: to, from_address: from, ship_with: shipWith, order_number: id, external_reference_id: id, reference: text(reference || id, 160), total_order_price: { currency: "EUR", value: Number(totalOrderValue).toFixed(2) }, parcels: [{ weight: parcelWeight }] };
  if (carrierCode === "mondial_relay") body.to_service_point = { id: positiveId(servicePointId) };
  const payload = await request("/shipments/announce", { method: "POST", body }), data = payload.data, parcel = data?.parcels?.[0];
  if (payload.errors?.length || data?.errors?.length || parcel?.errors?.length || !data?.id || !parcel?.id || /FAIL|ERROR|REJECT|CANCEL/i.test(String(parcel?.status?.code || data?.status?.code || ""))) throw failure("SENDCLOUD_ANNOUNCEMENT_FAILED", "Création de l'étiquette non confirmée par le transporteur.");
  const label = parcel.documents?.find(d => d.type === "label");
  if (!label || data.carrier?.code !== carrierCode) throw failure("SENDCLOUD_ANNOUNCEMENT_FAILED", "Étiquette ou transporteur incohérent. Rapprochement requis.");
  const parcelId = String(positiveId(parcel.id));
  const tracking = String(parcel.tracking_url || ""); let trackingUrl = "";
  try { const url = new URL(tracking); if (url.protocol === "https:" && !url.username && !url.password) trackingUrl = url.href; } catch {}
  return { shipmentId: String(data.id), parcelId, trackingNumber: text(parcel.tracking_number, 160), trackingUrl, labelUrl: BASE_URL + "/parcels/" + parcelId + "/documents/label", status: text(parcel.status?.code || "READY_TO_SEND", 80), carrierCode, shippingOptionCode: option.code };
}
export async function findSendcloudShipmentByOrderNumber(orderNumber) {
  const id = text(orderNumber, 160, true);
  const params = new URLSearchParams({ order_number: id, page_size: "10" });
  const payload = await request("/shipments?" + params);
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const shipment = rows.find(row => {
    const orderId = String(row?.order_number || "").trim();
    const externalId = String(row?.external_reference_id || "").trim();
    return orderId === id || externalId === id;
  });
  if (!shipment) return null;

  const parcels = Array.isArray(shipment.parcels) ? shipment.parcels : [];
  const parcel = parcels.find(item => item?.tracking_number) || parcels[0] || null;
  if (!parcel) return {
    shipmentId: text(shipment.id, 160),
    parcelId: "",
    trackingNumber: "",
    trackingUrl: "",
    status: text(shipment.status?.code || shipment.status, 80),
    carrierCode: text(shipment.carrier?.code, 80)
  };

  let trackingUrl = "";
  try {
    const url = new URL(String(parcel.tracking_url || ""));
    if (url.protocol === "https:" && !url.username && !url.password) trackingUrl = url.href;
  } catch {}

  return {
    shipmentId: text(shipment.id, 160),
    parcelId: parcel.id == null ? "" : String(positiveId(parcel.id)),
    trackingNumber: text(parcel.tracking_number, 160),
    trackingUrl,
    status: text(parcel.status?.code || shipment.status?.code || shipment.status, 80),
    carrierCode: text(shipment.carrier?.code || parcel.carrier?.code, 80)
  };
}
export async function downloadSendcloudLabel(parcelId) { return request("/parcels/" + positiveId(parcelId) + "/documents/label?dpi=72", { pdf: true }); }
export async function cancelSendcloudShipment(shipmentId) { const id = text(shipmentId, 160, true); const payload = await request("/shipments/" + encodeURIComponent(id) + "/cancel", { method: "POST" }); return { status: text(payload.data?.status, 80, true), confirmed: payload.data?.status === "cancelled" }; }
