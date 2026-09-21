import fs from "node:fs";
import nodemailer from "nodemailer";
import { renderCardoriaEmail } from "./email-templates.js";

export const ALERT_EMAIL = process.env.MAIL_TO || "Cardoria59330@gmail.com";
export const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD || 95);
export const PUBLIC_SITE_ORIGIN = "https://www.cardoriashop.fr";

function envTrim(name) {
  return String(process.env[name] || "").trim();
}

/** SMTP utilisable : hôte + compte + mot de passe. Ne lit jamais le secret pour le journaliser. */
export function isSmtpConfigured() {
  return Boolean(envTrim("SMTP_HOST") && envTrim("SMTP_USER") && envTrim("SMTP_PASS"));
}

export function smtpMissingReason() {
  if (!envTrim("SMTP_HOST")) return "SMTP_HOST manquant";
  if (!envTrim("SMTP_USER")) return "SMTP_USER manquant";
  if (!envTrim("SMTP_PASS")) return "SMTP_PASS manquant";
  return "";
}

function mailbox(value) {
  const email = String(value || "").trim();
  return /^\S+@\S+\.\S+$/.test(email) ? email : "";
}

export function getEmailPublicStatus() {
  const smtpUser = mailbox(envTrim("SMTP_USER"));
  const from = mailbox(envTrim("MAIL_FROM")) || smtpUser;
  const replyTo = mailbox(envTrim("MAIL_REPLY_TO")) || from;
  const host = envTrim("SMTP_HOST");
  return {
    configured: isSmtpConfigured(),
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || Number(process.env.SMTP_PORT || 587) === 465,
    smtpUser,
    from,
    fromName: envTrim("MAIL_FROM_NAME") || "Cardoria",
    replyTo,
    fromDomain: from.includes("@") ? from.split("@").pop().toLowerCase() : "",
    dkimSelector: envTrim("MAIL_DKIM_SELECTOR"),
    missingReason: smtpMissingReason()
  };
}

export function publicSiteOrigin() {
  const candidates = [envTrim("PUBLIC_SITE_URL"), envTrim("SITE_URL"), envTrim("FRONTEND_URL"), PUBLIC_SITE_ORIGIN];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:") continue;
      if (host === "localhost" || host === "127.0.0.1") continue;
      if (host.endsWith(".onrender.com") || host.endsWith(".vercel.app") || host === "cardoria.vercel.app") continue;
      if (host === "cardoriashop.fr" || host === "www.cardoriashop.fr") return PUBLIC_SITE_ORIGIN;
    } catch {
      continue;
    }
  }
  return PUBLIC_SITE_ORIGIN;
}

function redactSecret(detail) {
  let out = String(detail || "erreur SMTP");
  const pass = envTrim("SMTP_PASS");
  if (pass) out = out.split(pass).join("[redacted]");
  return out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]");
}

function logEmail(kind, result, extra = "") {
  const provider = envTrim("SMTP_HOST") || "smtp.unconfigured";
  const suffix = extra ? ` ${extra}` : "";
  const line = `[email] kind=${kind || "transactional"} provider=${provider} result=${result}${suffix}`;
  if (result === "sent" || result === "queued-test") console.log(line);
  else console.warn(line);
}

function createSmtpTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  return nodemailer.createTransport({
    host: envTrim("SMTP_HOST"),
    port,
    secure,
    requireTLS: !secure && port === 587,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
    tls: { minVersion: "TLSv1.2" },
    auth: {
      user: envTrim("SMTP_USER"),
      pass: envTrim("SMTP_PASS")
    }
  });
}

function writeTestOutbox(message) {
  const outbox = envTrim("CARDORIA_TEST_EMAIL_OUTBOX");
  if (process.env.NODE_ENV !== "test" || !outbox) return false;
  fs.writeFileSync(outbox, JSON.stringify(message), "utf8");
  return true;
}

export async function sendEmail({ subject, text, html, attachments, to, kind, actionUrl, actionLabel, details, preheader } = {}) {
  let payloadText = text;
  let payloadHtml = html;
  if (!payloadHtml) {
    const rendered = renderCardoriaEmail({
      preheader: preheader || subject,
      title: subject,
      bodyText: text,
      actionUrl,
      actionLabel,
      details
    });
    payloadText = rendered.text;
    payloadHtml = rendered.html;
  }
  if (writeTestOutbox({ kind: kind || "transactional", to: to || ALERT_EMAIL, subject, text: payloadText, html: payloadHtml, actionUrl: actionUrl || "" })) {
    logEmail(kind, "queued-test");
    return true;
  }
  if (!isSmtpConfigured()) {
    logEmail(kind, "skipped", smtpMissingReason());
    return false;
  }
  try {
    const transporter = createSmtpTransport();
    const status = getEmailPublicStatus();
    const fromAddress = status.from || envTrim("SMTP_USER");
    await transporter.sendMail({
      from: status.fromName ? { name: status.fromName, address: fromAddress } : fromAddress,
      replyTo: status.replyTo || undefined,
      to: to || ALERT_EMAIL,
      subject,
      text: payloadText,
      html: payloadHtml,
      attachments
    });
    logEmail(kind, "sent");
    return true;
  } catch (error) {
    logEmail(kind, "fail", redactSecret(error?.code || error?.message));
    return false;
  }
}

export function notifySafely(promise, kind) {
  Promise.resolve(promise).catch((error) => {
    logEmail(kind, "fail", redactSecret(error?.message));
  });
}

export function buildAttachments(imagesBase64) {
  return (imagesBase64 || []).slice(0, 6).map((img, i) => {
    if (typeof img !== "string" || !img.startsWith("data:image")) return null;
    const [, meta, data] = img.match(/^data:(image\/[^;]+);base64,(.+)$/) || [];
    if (!data) return null;
    const ext = (meta || "image/jpeg").split("/")[1] || "jpg";
    return {
      filename: `carte-photo-${i + 1}.${ext.replace("jpeg", "jpg")}`,
      content: Buffer.from(data, "base64"),
      contentType: meta || "image/jpeg"
    };
  }).filter(Boolean);
}

export function extractSuspicionReasons(text) {
  const reasons = [];
  const lower = String(text || "").toLowerCase();
  const patterns = [
    { key: "impression", label: "Qualité d'impression suspecte" },
    { key: "font", label: "Typographie ou police incohérente" },
    { key: "bord", label: "Bords ou coupes anormaux" },
    { key: "holo", label: "Holographie ou reflets atypiques" },
    { key: "couleur", label: "Couleurs ou saturation anormales" },
    { key: "contref", label: "Indices de contrefaçon mentionnés" },
    { key: "authentic", label: "Doute sur l'authenticité" },
    { key: "faux", label: "Suspicion de carte fausse" },
    { key: "repro", label: "Suspicion de reproduction" }
  ];
  patterns.forEach((p) => {
    if (lower.includes(p.key)) reasons.push(p.label);
  });
  if (!reasons.length) reasons.push("Analyse visuelle : confiance inférieure au seuil Cardoria (95 %)");
  return [...new Set(reasons)];
}

export async function sendCounterfeitAlert(request, rawResult, confidenceScore, imagesBase64) {
  const reasons = extractSuspicionReasons(rawResult);
  const text = [
    "ALERTE CARDORIA — Suspicion de contrefaçon",
    "",
    `ID : ${request.id}`,
    `Score de confiance : ${confidenceScore}% (seuil : ${CONFIDENCE_THRESHOLD}%)`,
    "",
    "Raisons de la suspicion :",
    ...reasons.map((r) => `- ${r}`),
    "",
    "Client :",
    `- Nom : ${request.customerName || "Non renseigné"}`,
    `- Email : ${request.customerEmail || "Non renseigné"}`,
    `- Jeu / Licence : ${request.cardGame || request.detection?.license || "Non renseigné"}`,
    `- Carte : ${request.cardName || request.detection?.name || "Non renseigné"}`,
    `- Extension : ${request.detection?.extension || "—"}`,
    `- Numéro : ${request.detection?.number || "—"}`,
    `- Rareté : ${request.detection?.rarity || "—"}`,
    `- Langue : ${request.detection?.language || "—"}`,
    `- Version : ${request.detection?.version || "—"}`,
    `- État analysé : ${request.condition || "—"}`,
    `- Notes client : ${request.cardNotes || "Aucune"}`,
    "",
    "Résultat complet de l'analyse :",
    rawResult,
    "",
    `Photos jointes : ${(imagesBase64 || []).length}`
  ].join("\n");

  await sendEmail({
    subject: `[Cardoria] Alerte contrefaçon — ${request.id} (${confidenceScore}%)`,
    text,
    attachments: buildAttachments(imagesBase64)
  });
}
