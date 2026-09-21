const DEFAULT_API_BASE = "https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1";
const DEFAULT_PRODUCT_CODE = "DOM";
const DEFAULT_LABEL_FORMAT = "PDF_10x15_300dpi";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const clean = (value, max = 240) => String(value == null ? "" : value).trim().slice(0, max);
const failure = (code, message, status = 502, meta = {}) => Object.assign(new Error(message), { code, status, ...meta });

function apiKey() {
  return clean(process.env.COLISSIMO_API_KEY, 512);
}

function apiBase() {
  const value = clean(process.env.COLISSIMO_API_BASE, 500) || DEFAULT_API_BASE;
  let url;
  try { url = new URL(value); } catch { throw failure("COLISSIMO_CONFIG_INVALID", "URL API Colissimo invalide.", 503); }
  if (url.protocol !== "https:" || url.hostname !== "ws.colissimo.fr") {
    throw failure("COLISSIMO_CONFIG_INVALID", "Hôte API Colissimo non autorisé.", 503);
  }
  return url.href.replace(/\/$/, "");
}

function productCode() {
  const value = clean(process.env.COLISSIMO_PRODUCT_CODE, 20).toUpperCase() || DEFAULT_PRODUCT_CODE;
  if (!/^[A-Z0-9_+-]{2,12}$/.test(value)) throw failure("COLISSIMO_CONFIG_INVALID", "Code produit Colissimo invalide.", 503);
  return value;
}

function labelFormat() {
  const value = clean(process.env.COLISSIMO_LABEL_FORMAT, 40) || DEFAULT_LABEL_FORMAT;
  const allowed = new Set([
    "PDF_10x15_300dpi",
    "PDF_A4_300dpi",
    "PDF_10x12_300dpi",
    "PDF_10x10_300dpi"
  ]);
  if (!allowed.has(value)) throw failure("COLISSIMO_CONFIG_INVALID", "Format d'étiquette Colissimo non autorisé.", 503);
  return value;
}

function normalizeCountry(value) {
  const code = clean(value || "FR", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw failure("COLISSIMO_INPUT_INVALID", "Code pays Colissimo invalide.", 400);
  return code;
}

function normalizeWeightGrams(value) {
  const grams = Math.trunc(Number(value));
  if (!Number.isFinite(grams) || grams < 1 || grams > 30000) {
    throw failure("COLISSIMO_WEIGHT_INVALID", "Poids Colissimo requis entre 1 g et 30 kg.", 400);
  }
  return grams;
}

function normalizePhone(value) {
  return clean(value, 20).replace(/[^0-9+]/g, "");
}

function senderAddress() {
  const name = clean(process.env.CARDORIA_SENDER_NAME || "Cardoria", 35);
  const line2 = clean(process.env.CARDORIA_SENDER_ADDRESS_LINE1, 35);
  const line3 = clean(process.env.CARDORIA_SENDER_ADDRESS_LINE2, 35);
  const zipCode = clean(process.env.CARDORIA_SENDER_POSTAL_CODE, 10);
  const city = clean(process.env.CARDORIA_SENDER_CITY, 35);
  const countryCode = normalizeCountry(process.env.CARDORIA_SENDER_COUNTRY || "FR");
  const phoneNumber = normalizePhone(process.env.CARDORIA_SENDER_PHONE);
  const email = clean(process.env.CARDORIA_SENDER_EMAIL, 80);
  if (!name || !line2 || !zipCode || !city) {
    throw failure("COLISSIMO_SENDER_NOT_CONFIGURED", "Adresse expéditeur Cardoria incomplète pour Colissimo.", 503);
  }
  return {
    companyName: name,
    line2,
    ...(line3 ? { line3 } : {}),
    countryCode,
    city,
    zipCode,
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(email ? { email } : {})
  };
}

function recipientAddress(order = {}) {
  const shipping = order.shippingAddress || {};
  const name = clean(order.client || shipping.recipientName || shipping.name, 35);
  const line2 = clean(shipping.address || shipping.addressLine1, 35);
  const line3 = clean(shipping.addressLine2, 35);
  const zipCode = clean(shipping.postalCode || shipping.zipCode, 10);
  const city = clean(shipping.city, 35);
  const countryCode = normalizeCountry(shipping.countryCode || shipping.country || "FR");
  const phoneNumber = normalizePhone(order.phone || shipping.phone);
  const email = clean(order.email || shipping.email, 80);
  if (countryCode !== "FR") {
    throw failure("COLISSIMO_FRANCE_ONLY", "L'intégration Boutique Colissimo est actuellement limitée aux adresses en France.", 400);
  }
  if (!name || !line2 || !zipCode || !city) {
    throw failure("COLISSIMO_RECIPIENT_INVALID", "Adresse destinataire incomplète pour Colissimo.", 400);
  }
  return {
    lastName: name,
    line2,
    ...(line3 ? { line3 } : {}),
    countryCode,
    city,
    zipCode,
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(email ? { email } : {})
  };
}

export function isColissimoConfigured() {
  return Boolean(apiKey());
}

export function isColissimoSenderConfigured() {
  return Boolean(
    clean(process.env.CARDORIA_SENDER_NAME || "Cardoria") &&
    clean(process.env.CARDORIA_SENDER_ADDRESS_LINE1) &&
    clean(process.env.CARDORIA_SENDER_POSTAL_CODE) &&
    clean(process.env.CARDORIA_SENDER_CITY)
  );
}

export function colissimoLabelPurchasesEnabled() {
  return String(process.env.COLISSIMO_LIVE_LABELS_ENABLED || "").toLowerCase() === "true";
}

export function getColissimoStatus() {
  let base = DEFAULT_API_BASE;
  let code = DEFAULT_PRODUCT_CODE;
  let format = DEFAULT_LABEL_FORMAT;
  try { base = apiBase(); } catch {}
  try { code = productCode(); } catch {}
  try { format = labelFormat(); } catch {}
  return {
    provider: "colissimo_direct",
    configured: isColissimoConfigured(),
    senderConfigured: isColissimoSenderConfigured(),
    labelPurchasesEnabled: colissimoLabelPurchasesEnabled(),
    apiVersion: "3.1",
    apiBase: base,
    productCode: code,
    labelFormat: format
  };
}

export function buildColissimoLabelRequest({ order, weightGrams, depositDate = new Date() } = {}) {
  const grams = normalizeWeightGrams(weightGrams);
  const date = depositDate instanceof Date && !Number.isNaN(depositDate.getTime())
    ? depositDate.toISOString().slice(0, 10)
    : clean(depositDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw failure("COLISSIMO_INPUT_INVALID", "Date de dépôt Colissimo invalide.", 400);
  const sender = senderAddress();
  const addressee = recipientAddress(order);
  const orderNumber = clean(order?.id, 35);
  if (!orderNumber) throw failure("COLISSIMO_INPUT_INVALID", "Référence de commande requise.", 400);
  return {
    outputFormat: {
      x: 0,
      y: 0,
      outputPrintingType: labelFormat()
    },
    letter: {
      service: {
        productCode: productCode(),
        depositDate: date,
        orderNumber,
        commercialName: clean(process.env.CARDORIA_SENDER_NAME || "Cardoria", 35)
      },
      parcel: {
        weight: Number((grams / 1000).toFixed(3)),
        nonMachinable: false
      },
      sender,
      addressee
    }
  };
}

function boundaryFrom(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  return match ? (match[1] || match[2] || "") : "";
}

function parseHeaders(raw) {
  const headers = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const pos = line.indexOf(":");
    if (pos <= 0) continue;
    headers[line.slice(0, pos).trim().toLowerCase()] = line.slice(pos + 1).trim();
  }
  return headers;
}

export function parseColissimoResponse(bytes, contentType = "") {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const type = String(contentType || "").toLowerCase();
  if (type.includes("application/json")) {
    const json = JSON.parse(buffer.toString("utf8") || "{}");
    return { json, label: null };
  }
  if (type.includes("application/pdf") || buffer.subarray(0, 4).toString("ascii") === "%PDF") {
    return { json: null, label: buffer };
  }
  const boundary = boundaryFrom(contentType);
  if (!boundary) {
    const text = buffer.toString("utf8");
    try { return { json: JSON.parse(text), label: null }; } catch {}
    throw failure("COLISSIMO_RESPONSE_INVALID", "Réponse Colissimo illisible.", 502);
  }
  const raw = buffer.toString("latin1");
  const marker = "--" + boundary;
  const chunks = raw.split(marker);
  let json = null;
  let label = null;
  for (let chunk of chunks) {
    chunk = chunk.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    if (!chunk || chunk === "--") continue;
    chunk = chunk.replace(/--\r?\n?$/, "");
    const separator = chunk.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
    const index = chunk.indexOf(separator);
    if (index < 0) continue;
    const headers = parseHeaders(chunk.slice(0, index));
    let body = chunk.slice(index + separator.length).replace(/\r?\n$/, "");
    const disposition = headers["content-disposition"] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || "";
    const partType = (headers["content-type"] || "").toLowerCase();
    if (name === "jsonInfos" || partType.includes("json")) {
      try { json = JSON.parse(Buffer.from(body, "latin1").toString("utf8")); } catch {}
    } else if (name === "label" || partType.includes("pdf") || body.startsWith("%PDF")) {
      label = Buffer.from(body, "latin1");
    }
  }
  return { json, label };
}

function providerMessage(json) {
  const messages = json?.messages || json?.labelV2Response?.messages || [];
  if (!Array.isArray(messages)) return "";
  const bad = messages.find((item) => {
    const type = clean(item?.type, 30).toLowerCase();
    return type && !["info", "information", "success", "ok"].includes(type);
  });
  return clean(bad?.messageContent || bad?.message || "", 500);
}

function parcelNumberFrom(json) {
  return clean(
    json?.parcelNumber ||
    json?.labelV2Response?.parcelNumber ||
    json?.jsonInfos?.parcelNumber,
    30
  );
}

function pdfUrlFrom(json) {
  return clean(json?.pdfUrl || json?.labelV2Response?.pdfUrl || json?.jsonInfos?.pdfUrl, 1000);
}

async function readBounded(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw failure("COLISSIMO_RESPONSE_TOO_LARGE", "Réponse Colissimo trop volumineuse.", 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) throw failure("COLISSIMO_RESPONSE_TOO_LARGE", "Réponse Colissimo trop volumineuse.", 502);
  return bytes;
}

async function post(method, payload, { ambiguousCreation = false } = {}) {
  if (!apiKey()) throw failure("COLISSIMO_NOT_CONFIGURED", "Clé API Colissimo absente.", 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(apiBase() + "/" + method, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        apiKey: apiKey(),
        Accept: "multipart/mixed, application/json, application/pdf",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (ambiguousCreation) {
      throw failure("COLISSIMO_RECONCILIATION_REQUIRED", "Création Colissimo non confirmée. Vérifiez la Cbox avant tout nouvel essai.", 502);
    }
    throw failure(controller.signal.aborted ? "COLISSIMO_TIMEOUT" : "COLISSIMO_NETWORK_ERROR", "Connexion Colissimo indisponible.", 502);
  } finally {
    clearTimeout(timer);
  }
  const bytes = await readBounded(response);
  let parsed;
  try { parsed = parseColissimoResponse(bytes, response.headers.get("content-type") || ""); }
  catch (error) {
    if (!response.ok) throw failure("COLISSIMO_PROVIDER_ERROR", "Erreur Colissimo (" + response.status + ").", response.status >= 400 && response.status < 600 ? response.status : 502);
    throw error;
  }
  if (!response.ok) {
    const message = providerMessage(parsed.json) || clean(parsed.json?.message || parsed.json?.error, 500) || "Erreur Colissimo (" + response.status + ").";
    throw failure("COLISSIMO_PROVIDER_ERROR", message, response.status >= 400 && response.status < 600 ? response.status : 502);
  }
  return parsed;
}

function safeColissimoUrl(value) {
  if (!value) return "";
  let url;
  try { url = new URL(String(value)); } catch { return ""; }
  if (url.protocol !== "https:") return "";
  if (url.hostname !== "ws.colissimo.fr" && !url.hostname.endsWith(".colissimo.fr")) return "";
  return url.href;
}

async function downloadSafeUrl(url) {
  const safe = safeColissimoUrl(url);
  if (!safe) throw failure("COLISSIMO_LABEL_URL_INVALID", "URL d'étiquette Colissimo invalide.", 502);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(safe, { redirect: "error", signal: controller.signal, headers: { apiKey: apiKey() } });
    if (!response.ok) throw failure("COLISSIMO_LABEL_UNAVAILABLE", "Téléchargement de l'étiquette Colissimo impossible.", 502);
    const bytes = await readBounded(response);
    if (bytes.subarray(0, 4).toString("ascii") !== "%PDF") throw failure("COLISSIMO_LABEL_INVALID", "Le document Colissimo reçu n'est pas un PDF.", 502);
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

export async function createColissimoLabel({ order, weightGrams } = {}) {
  if (!colissimoLabelPurchasesEnabled()) {
    throw failure("COLISSIMO_LABELS_NOT_ACTIVATED", "Création réelle d'étiquettes Colissimo désactivée.", 503);
  }
  const request = buildColissimoLabelRequest({ order, weightGrams });
  const parsed = await post("generateLabel", request, { ambiguousCreation: true });
  const message = providerMessage(parsed.json);
  if (message && !parcelNumberFrom(parsed.json)) throw failure("COLISSIMO_PROVIDER_ERROR", message, 502);
  const parcelNumber = parcelNumberFrom(parsed.json);
  if (!parcelNumber) throw failure("COLISSIMO_RECONCILIATION_REQUIRED", "Colissimo n'a pas confirmé le numéro de colis. Vérifiez la Cbox avant tout nouvel essai.", 502);
  return {
    provider: "colissimo_direct",
    parcelNumber,
    trackingNumber: parcelNumber,
    trackingUrl: "https://www.laposte.fr/outils/suivre-vos-envois?code=" + encodeURIComponent(parcelNumber),
    pdfUrl: pdfUrlFrom(parsed.json),
    productCode: request.letter.service.productCode,
    labelFormat: request.outputFormat.outputPrintingType
  };
}

export async function downloadColissimoLabel(parcelNumber, preferredPdfUrl = "") {
  const parcel = clean(parcelNumber, 30);
  if (!parcel) throw failure("COLISSIMO_PARCEL_REQUIRED", "Numéro de colis Colissimo requis.", 400);
  const preferred = safeColissimoUrl(preferredPdfUrl);
  if (preferred) {
    try { return await downloadSafeUrl(preferred); } catch { /* fallback to official getLabel */ }
  }
  const parsed = await post("getLabel", {
    parcelNumber: parcel,
    outputPrintingType: labelFormat()
  });
  if (parsed.label?.length) return parsed.label;
  const location = safeColissimoUrl(parsed.json?.location || parsed.json?.url || pdfUrlFrom(parsed.json));
  if (location) return downloadSafeUrl(location);
  throw failure("COLISSIMO_LABEL_UNAVAILABLE", "Étiquette Colissimo introuvable pour ce colis.", 404);
}
