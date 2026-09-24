const SITE = "https://www.cardoriashop.fr";

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeLastmod(value) {
  const day = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const parsed = new Date(day + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : "";
}

export function generateMarketplaceSitemapXml(entries = [], siteUrl = SITE) {
  const base = String(siteUrl || SITE).replace(/\/$/, "");
  const urls = (Array.isArray(entries) ? entries : [])
    .filter((entry) => String(entry?.url || "").startsWith("/annonces/"))
    .map((entry) => {
      const loc = xmlEscape(base + entry.url);
      const lastmod = safeLastmod(entry.lastmod);
      return `  <url>\n    <loc>${loc}</loc>\n${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ""}    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}${urls ? "\n" : ""}</urlset>`;
}
