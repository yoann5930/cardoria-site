import nodemailer from "nodemailer";

export const ALERT_EMAIL = process.env.MAIL_TO || "Cardoria59330@gmail.com";
export const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD || 95);

function envTrim(name) {
  return String(process.env[name] || "").trim();
}

export function isBrevoConfigured() {
  return Boolean(envTrim("BREVO_API_KEY") && envTrim("BREVO_SENDER_EMAIL"));
}

/** SMTP utilisable sur les hebergements qui autorisent les ports sortants 465/587. */
export function isSmtpConfigured() {
  return Boolean(envTrim("SMTP_HOST") && envTrim("SMTP_USER") && envTrim("SMTP_PASS"));
}

export function isEmailConfigured() {
  return isBrevoConfigured() || isSmtpConfigured();
}

export function smtpMissingReason() {
  if (!envTrim("SMTP_HOST")) return "SMTP_HOST manquant";
  if (!envTrim("SMTP_USER")) return "SMTP_USER manquant";
  if (!envTrim("SMTP_PASS")) return "SMTP_PASS manquant";
  return "";
}

function createSmtpTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  return nodemailer.createTransport({
    host: envTrim("SMTP_HOST"),
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: {
      user: envTrim("SMTP_USER"),
      pass: envTrim("SMTP_PASS")
    }
  });
}

function normalizeRecipients(to) {
  const values = Array.isArray(to) ? to : [to || ALERT_EMAIL];
  return values
    .map((value) => typeof value === "string" ? value.trim() : String(value?.email || "").trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

function normalizeBrevoAttachments(attachments) {
  return (attachments || []).map((attachment) => {
    if (!attachment?.filename || attachment?.content == null) return null;
    const content = Buffer.isBuffer(attachment.content)
      ? attachment.content.toString("base64")
      : Buffer.from(String(attachment.content)).toString("base64");
    return { name: attachment.filename, content };
  }).filter(Boolean);
}

async function sendWithBrevo({ subject, text, html, attachments, to }) {
  const senderEmail = envTrim("BREVO_SENDER_EMAIL");
  const senderName = envTrim("BREVO_SENDER_NAME") || "Cardoria";
  const recipients = normalizeRecipients(to);
  if (!recipients.length) throw new Error("Aucun destinataire e-mail valide");

  const body = {
    sender: { email: senderEmail, name: senderName },
    to: recipients,
    subject: String(subject || "Cardoria")
  };
  if (html) body.htmlContent = String(html);
  else body.textContent = String(text || "");

  const normalizedAttachments = normalizeBrevoAttachments(attachments);
  if (normalizedAttachments.length) body.attachment = normalizedAttachments;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": envTrim("BREVO_API_KEY")
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.message) detail += ` - ${String(payload.message).slice(0, 240)}`;
    } catch {}
    throw new Error(detail);
  }
  return true;
}

async function sendWithSmtp({ subject, text, html, attachments, to }) {
  const transporter = createSmtpTransport();
  await transporter.sendMail({
    from: envTrim("MAIL_FROM") || envTrim("SMTP_USER"),
    to: to || ALERT_EMAIL,
    subject,
    text,
    html,
    attachments
  });
  return true;
}

export async function sendEmail({ subject, text, html, attachments, to }) {
  try {
    if (isBrevoConfigured()) {
      return await sendWithBrevo({ subject, text, html, attachments, to });
    }

    if (isSmtpConfigured()) {
      return await sendWithSmtp({ subject, text, html, attachments, to });
    }

    console.warn("E-mail non configuré — envoi ignoré :", subject, "(BREVO_API_KEY/BREVO_SENDER_EMAIL ou SMTP requis)");
    return false;
  } catch (error) {
    const smtpPass = envTrim("SMTP_PASS");
    const brevoKey = envTrim("BREVO_API_KEY");
    let detail = String(error?.code || error?.message || "erreur e-mail");
    if (smtpPass) detail = detail.split(smtpPass).join("[redacted]");
    if (brevoKey) detail = detail.split(brevoKey).join("[redacted]");
    console.warn("Envoi e-mail impossible :", subject, detail);
    return false;
  }
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
