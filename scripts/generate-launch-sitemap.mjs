#!/usr/bin/env node
/**
 * Génère sitemap-index.xml — fusion sitemaps statique + dynamiques.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = process.env.SITE_URL || "https://cardoria.vercel.app";
const BACKEND = process.env.BACKEND_URL || "https://cardoria-backend.onrender.com";
const today = new Date().toISOString().slice(0, 10);

const sitemaps = [
  `${SITE.replace(/\/$/, "")}/sitemap.xml`,
  `${BACKEND.replace(/\/$/, "")}/api/seo/sitemap.xml`,
  `${BACKEND.replace(/\/$/, "")}/api/marketplace/v1/sitemap.xml`
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.map((loc) => `  <sitemap><loc>${loc}</loc><lastmod>${today}</lastmod></sitemap>`).join("\n")}
</sitemapindex>
`;

fs.writeFileSync(path.join(ROOT, "sitemap-index.xml"), xml, "utf8");
console.log("Écrit sitemap-index.xml avec", sitemaps.length, "sitemaps");
