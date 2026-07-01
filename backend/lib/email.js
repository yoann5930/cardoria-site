import nodemailer from "nodemailer";

export const ALERT_EMAIL = process.env.MAIL_TO || "Cardoria59330@gmail.com";
export const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD || 95);

export async function sendEmail({ subject, text, html, attachments, to }) {
  if (!process.env.SMTP_HOST) {
    console.warn("SMTP non configuré — e-mail non envoyé :", subject);
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: to || ALERT_EMAIL,
    subject,
    text,
    html,
    attachments
  });
  return true;
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
