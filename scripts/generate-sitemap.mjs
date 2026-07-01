/**
 * Génère sitemap.xml depuis l'API Cardoria ou liste statique de secours.
 * Usage : node scripts/generate-sitemap.mjs
 */
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");
const BACKEND = process.env.CARDORIA_BACKEND || "https://cardoria-backend.onrender.com";
const SITE = process.env.SITE_URL || "https://cardoria.vercel.app";

async function main() {
  let xml;
  try {
    const res = await fetch(BACKEND + "/api/seo/sitemap.xml");
    if (!res.ok) throw new Error("API " + res.status);
    xml = await res.text();
    console.log("Sitemap généré depuis l'API backend (" + xml.length + " octets)");
  } catch (e) {
    console.warn("Fallback statique :", e.message);
    const today = new Date().toISOString().slice(0, 10);
    const paths = [
      "/", "/boutique.html", "/estimation.html", "/marketplace.html", "/rachat-cartes.html",
      "/tendances.html", "/contact.html", "/pages/faq/", "/pages/a-propos/", "/pages/contact/",
      "/pages/mentions-legales/", "/pages/confidentialite/", "/pages/cgv/", "/pages/blog/",
      "/pages/licences/", "/pages/licences/pokemon/", "/pages/licences/yugioh/",
      "/pages/licences/onepiece/", "/pages/licences/lorcana/", "/pages/licences/magic/",
      "/pages/licences/dragonball/", "/pages/licences/sports/"
    ];
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      paths.map(function (p) {
        return "  <url><loc>" + SITE + p + "</loc><lastmod>" + today + "</lastmod></url>";
      }).join("\n") + "\n</urlset>";
  }
  writeFileSync(join(root, "sitemap.xml"), xml, "utf8");
  console.log("Écrit : sitemap.xml");
}

main();
