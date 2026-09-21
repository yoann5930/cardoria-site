const PUBLIC_ORIGIN = "https://www.cardoriashop.fr";
const LOGO_URL = `${PUBLIC_ORIGIN}/assets/logo/cardoria-premium.png`;
const CONTACT = "Cardoria59330@gmail.com";

export function escapeEmailHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function paragraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1a1a1a;">${escapeEmailHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function renderCardoriaEmail({
  preheader = "",
  title,
  bodyText,
  actionUrl = "",
  actionLabel = "",
  details = []
} = {}) {
  const safeTitle = escapeEmailHtml(title || "Cardoria");
  const safeActionUrl = String(actionUrl || "").trim();
  const button = safeActionUrl && actionLabel
    ? `<p style="margin:28px 0 8px;text-align:center;">
        <a href="${escapeEmailHtml(safeActionUrl)}" style="display:inline-block;background:#c9a227;color:#111;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;">${escapeEmailHtml(actionLabel)}</a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5c5c5c;word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien :<br>${escapeEmailHtml(safeActionUrl)}</p>`
    : "";
  const detailRows = (details || []).filter((row) => row && row.label).map((row) => (
    `<tr>
      <td style="padding:8px 0;font-size:14px;color:#5c5c5c;width:42%;">${escapeEmailHtml(row.label)}</td>
      <td style="padding:8px 0;font-size:14px;color:#111;font-weight:600;">${escapeEmailHtml(row.value || "—")}</td>
    </tr>`
  )).join("");
  const detailsTable = detailRows
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;border-top:1px solid #eee;border-bottom:1px solid #eee;">${detailRows}</table>`
    : "";

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#111111;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeEmailHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111111;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:#030303;padding:22px 28px;text-align:center;">
              <img src="${LOGO_URL}" alt="Cardoria" width="56" height="56" style="display:block;margin:0 auto 10px;border:0;">
              <p style="margin:0;font-family:Georgia,serif;letter-spacing:.18em;color:#c9a227;font-size:13px;">CARDORIA</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 12px;font-family:Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#111;">${safeTitle}</h1>
              ${paragraphs(bodyText)}
              ${detailsTable}
              ${button}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b6b6b;">
              Cardoria · Boutique de cartes à collectionner<br>
              <a href="${PUBLIC_ORIGIN}" style="color:#8a6d1f;text-decoration:none;">www.cardoriashop.fr</a>
              · ${escapeEmailHtml(CONTACT)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts = [
    title,
    "",
    bodyText,
    ...(details || []).filter((row) => row?.label).map((row) => `${row.label} : ${row.value || "—"}`),
    safeActionUrl ? `\n${actionLabel || "Lien"} : ${safeActionUrl}` : "",
    "",
    "Cardoria — https://www.cardoriashop.fr"
  ];

  return { html, text: textParts.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}
