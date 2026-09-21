import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./storage.js";

const GENERATE_URL = "https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/2.0/generateLabel";
const TRACKING_URL = "https://www.laposte.fr/outils/suivre-vos-envois?code=";
const PRODUCT_CODES = new Set(["DOM", "DOS", "CORE", "COLD", "COLI"]);
const PRINT_TYPES = new Set(["PDF_A4_300dpi", "PDF_10x15_300dpi"]);

const failure = (code, message, status = 502, meta = {}) => Object.assign(new Error(message), { code, status, ...meta });
const rawText = (value) => String(value == null ? "" : value).trim();

function env(name) {
  return rawText(process.env[name]);
}

export function isColissimoConfigured() {
  return Boolean(env("COLISSIMO_CONTRACT_NUMBER") && env("COLISSIMO_PASSWORD"));
}

export function colissimoLabelPurchasesEnabled() {
  return process.env.COLISSIMO_LABELS_ENABLED === "true";
}

export function colissimoPublicStatus() {
  return {
    ok: true,
    provider: "colissimo",
    carrier: "la_poste",
    configured: isColissimoConfigured(),
    labelPurchasesEnabled: colissimoLabelPurchasesEnabled(),
    productCode: productCode(),
    service: "SLS"
  };
}

function productCode() {
  const code = env("COLISSIMO_PRODUCT_CODE").toUpperCase() || "DOM";
  return PRODUCT_CODES.has(code) ? code : "DOM";
}

function printType() {
  const type = env("COLISSIMO_OUTPUT_PRINTING_TYPE") || "PDF_A4_300dpi";
  return PRINT_TYPES.has(type) ? type : "PDF_A4_300dpi";
}

function ascii(value) {
  return rawText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'");
}

function field(value, max, required = false) {
  const out = ascii(value).replace(/\s+/g, " ").trim().slice(0, max);
  if (required && !out) throw failure("COLISSIMO_INPUT_INVALID", "Adresse Colissimo incomplète.", 400);
  return out;
}

function country(value) {
  const code = rawText(value || "FR").toUpperCase();
  if (code === "FRANCE") return "FR";
  if (!/^[A-Z]{2}$/.test(code)) throw failure("COLISSIMO_INPUT_INVALID", "Code pays Colissimo invalide.", 400);
  return code;
}

function zipCode(value, countryCode = "FR") {
  const code = ascii(value).toUpperCase().replace(/\s+/g, "");
  if (countryCode === "FR" && !/^\d{5}$/.test(code)) throw failure("COLISSIMO_INPUT_INVALID", "Code postal Colissimo invalide.", 400);
  if (!/^[0-9A-Z-]{2,10}$/.test(code)) throw failure("COLISSIMO_INPUT_INVALID", "Code postal Colissimo invalide.", 400);
  return code;
}

function phoneFr(value) {
  let digits = rawText(value).replace(/\D/g, "");
  if (digits.startsWith("33") && digits.length === 11) digits = "0" + digits.slice(2);
  if (digits.startsWith("0033") && digits.length === 13) digits = "0" + digits.slice(4);
  return /^0[1-9]\d{8}$/.test(digits) ? digits : "";
}

function splitName(fullName) {
  const parts = field(fullName, 70, true).split(" ").filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" ").slice(0, 29), lastName: parts.at(-1).slice(0, 35) };
}

function kgFromGrams(grams) {
  const n = Number(grams);
  if (!Number.isFinite(n) || n <= 0) throw failure("COLISSIMO_INPUT_INVALID", "Poids Colissimo invalide.", 400);
  return Math.min(30, Math.max(0.015, Math.round(n) / 1000));
}

function depositDate() {
  return new Date().toISOString().slice(0, 10);
}

function orderNumber(value) {
  const source = rawText(value).replace(/[^0-9A-Za-z_-]/g, "");
  if (source.length <= 30 && source) return source;
  return "CRD" + crypto.createHash("sha256").update(rawText(value), "utf8").digest("hex").slice(0, 12).toUpperCase();
}

export function cardoriaSenderAddress() {
  const address = {
    companyName: field(env("CARDORIA_SENDER_NAME") || "Cardoria", 35, true),
    line2: field(env("CARDORIA_SENDER_ADDRESS_LINE1"), 35, true),
    line3: field(env("CARDORIA_SENDER_ADDRESS_LINE2"), 35),
    countryCode: country(env("CARDORIA_SENDER_COUNTRY") || "FR"),
    zipCode: zipCode(env("CARDORIA_SENDER_POSTAL_CODE"), country(env("CARDORIA_SENDER_COUNTRY") || "FR")),
    city: field(env("CARDORIA_SENDER_CITY"), 35, true),
    email: field(env("CARDORIA_SENDER_EMAIL"), 80),
    mobileNumber: phoneFr(env("CARDORIA_SENDER_PHONE"))
  };
  return address;
}

export function buildGenerateLabelRequest({
  orderId,
  weightGrams,
  toAddress = {},
  toEmail = "",
  fromAddress = {},
  content = "CARTES TCG"
} = {}) {
  if (!isColissimoConfigured()) throw failure("COLISSIMO_NOT_CONFIGURED", "Colissimo n'est pas configuré côté serveur.", 503);
  const destCountry = country(toAddress.countryCode || toAddress.country || "FR");
  const destName = splitName(toAddress.recipientName || toAddress.name || "");
  const sender = fromAddress.companyName || fromAddress.line2 ? fromAddress : cardoriaSenderAddress();
  const destPhone = phoneFr(toAddress.phone || toAddress.mobileNumber || "");
  return {
    contractNumber: env("COLISSIMO_CONTRACT_NUMBER"),
    password: env("COLISSIMO_PASSWORD"),
    outputFormat: { x: 0, y: 0, outputPrintingType: printType() },
    letter: {
      service: {
        productCode: productCode(),
        depositDate: depositDate(),
        orderNumber: orderNumber(orderId),
        commercialName: field(sender.companyName || "Cardoria", 35, true)
      },
      parcel: {
        weight: kgFromGrams(weightGrams)
      },
      sender: {
        senderParcelRef: orderNumber(orderId),
        address: {
          companyName: field(sender.companyName, 35),
          lastName: field(sender.lastName, 35),
          firstName: field(sender.firstName, 29),
          line2: field(sender.line2 || sender.addressLine1, 35, true),
          line3: field(sender.line3 || sender.addressLine2, 35),
          countryCode: country(sender.countryCode || "FR"),
          city: field(sender.city, 35, true),
          zipCode: zipCode(sender.zipCode || sender.postalCode, country(sender.countryCode || "FR")),
          email: field(sender.email, 80),
          phoneNumber: phoneFr(sender.phoneNumber || sender.phone || sender.mobileNumber)
        }
      },
      addressee: {
        addresseeParcelRef: orderNumber(orderId),
        address: {
          lastName: destName.lastName,
          firstName: destName.firstName,
          line2: field(toAddress.addressLine1 || toAddress.address || toAddress.line2, 35, true),
          line3: field(toAddress.addressLine2 || toAddress.line3, 35),
          countryCode: destCountry,
          city: field(toAddress.city, 35, true),
          zipCode: zipCode(toAddress.postalCode || toAddress.zipCode, destCountry),
          email: field(toEmail || toAddress.email, 80),
          phoneNumber: destPhone,
          mobileNumber: destPhone
        }
      }
    },
    content
  };
}

export function parseGenerateLabelResponse(body, pdfBuffer) {
  const data = typeof body === "string" ? JSON.parse(body) : (body || {});
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const error = messages.find((item) => {
    const type = String(item?.type || "").toUpperCase();
    const id = String(item?.id ?? "0");
    return type === "ERROR" || (id !== "0" && type !== "INFOS");
  });
  if (error) {
    throw failure("COLISSIMO_CREATION_REJECTED", rawText(error.messageContent || error.message) || "Colissimo a refusé l'étiquette.", 502, { providerId: error.id });
  }
  const payload = data.labelV2Response || data.labelResponse || data;
  const parcelNumber = rawText(payload.parcelNumber || payload.parcelNumberPartner);
  if (!parcelNumber) throw failure("COLISSIMO_CREATION_INVALID", "Réponse Colissimo incomplète.", 502);
  const pdf = Buffer.isBuffer(pdfBuffer) && pdfBuffer.length ? pdfBuffer : decodeLabelPdf(payload.label || payload.pdfBase64 || data.label);
  if (!pdf?.length) throw failure("COLISSIMO_LABEL_MISSING", "Le PDF Colissimo n'a pas été renvoyé.", 502);
  return {
    parcelNumber,
    trackingNumber: parcelNumber,
    trackingUrl: TRACKING_URL + encodeURIComponent(parcelNumber),
    pdf
  };
}

function decodeLabelPdf(value) {
  const raw = rawText(value);
  if (!raw) return null;
  try {
    const bytes = Buffer.from(raw, "base64");
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

export function parseMultipartLabel(buffer, contentType) {
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ""), "binary");
  const boundaryMatch = String(contentType || "").match(/boundary="?([^";]+)"?/i);
  if (!boundaryMatch) {
    const asText = body.toString("utf8");
    if (asText.trim().startsWith("{")) return parseGenerateLabelResponse(asText, null);
    if (body.slice(0, 5).toString() === "%PDF-") throw failure("COLISSIMO_CREATION_INVALID", "Réponse Colissimo PDF sans métadonnées.", 502);
    return parseGenerateLabelResponse(asText, null);
  }
  const boundary = Buffer.from("--" + boundaryMatch[1]);
  const parts = [];
  let start = body.indexOf(boundary);
  while (start >= 0) {
    const next = body.indexOf(boundary, start + boundary.length);
    if (next < 0) break;
    parts.push(body.slice(start + boundary.length, next));
    start = next;
  }
  let json = "";
  let pdf = null;
  for (const part of parts) {
    const split = part.indexOf(Buffer.from("\r\n\r\n"));
    if (split < 0) continue;
    const headers = part.slice(0, split).toString("utf8");
    let content = part.slice(split + 4);
    if (content.slice(-2).toString() === "\r\n") content = content.slice(0, -2);
    if (/application\/pdf/i.test(headers) || content.slice(0, 5).toString() === "%PDF-") pdf = Buffer.from(content);
    else if (/json/i.test(headers) || content.toString("utf8").trim().startsWith("{")) json = content.toString("utf8").trim();
  }
  if (!json) throw failure("COLISSIMO_CREATION_INVALID", "Réponse Colissimo illisible.", 502);
  return parseGenerateLabelResponse(json, pdf);
}

export function labelFilePath(orderId) {
  const id = rawText(orderId).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 80);
  if (!id) throw failure("COLISSIMO_INPUT_INVALID", "Identifiant de commande invalide.", 400);
  const dir = path.join(DATA_DIR, "labels");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, id + ".pdf");
}

export function readStoredLabelPdf(orderId) {
  const file = labelFilePath(orderId);
  if (!fs.existsSync(file)) throw failure("COLISSIMO_LABEL_MISSING", "Bordereau Colissimo introuvable.", 404);
  return fs.readFileSync(file);
}

function saveLabelPdf(orderId, pdf) {
  const file = labelFilePath(orderId);
  fs.writeFileSync(file, pdf, { mode: 0o600 });
  return path.relative(DATA_DIR, file).replace(/\\/g, "/");
}

export async function createColissimoShipment(input = {}) {
  if (!colissimoLabelPurchasesEnabled()) {
    throw failure("COLISSIMO_LABELS_NOT_ACTIVATED", "Création réelle d'étiquettes Colissimo désactivée.", 503);
  }
  const request = buildGenerateLabelRequest(input);
  const response = await fetch(GENERATE_URL, {
    method: "POST",
    headers: { Accept: "*/*", "Content-Type": "application/json" },
    body: JSON.stringify({
      contractNumber: request.contractNumber,
      password: request.password,
      outputFormat: request.outputFormat,
      letter: request.letter
    })
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw failure("COLISSIMO_API_ERROR", "Colissimo a refusé l'étiquette (HTTP " + response.status + ").", 502, { providerStatus: response.status });
  }
  const parsed = parseMultipartLabel(bytes, response.headers.get("content-type"));
  const labelPath = saveLabelPdf(input.orderId, parsed.pdf);
  return {
    parcelNumber: parsed.parcelNumber,
    trackingNumber: parsed.trackingNumber,
    trackingUrl: parsed.trackingUrl,
    labelPath,
    status: "READY_TO_SEND"
  };
}
