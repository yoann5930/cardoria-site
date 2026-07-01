#!/usr/bin/env node
/**
 * Build production — minification CSS/JS vers build/
 * Usage : node scripts/build-production.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "build");

function minifyJs(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}();,:=+\-*\/<>])\s*/g, "$1")
    .trim();
}

function minifyCss(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{}:;,])\s*/g, "$1").trim();
}

function copyMin(src, dest, minFn) {
  const code = fs.readFileSync(src, "utf8");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, minFn(code), "utf8");
  console.log("→", path.relative(ROOT, dest));
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

["style.css", "css/marketplace.css", "css/engine.css", "css/launch-perf.css"].forEach((f) => {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) copyMin(src, path.join(OUT, f), minifyCss);
});

["js/marketplace-client.js", "js/launch-perf.js", "js/layout.js"].forEach((f) => {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) copyMin(src, path.join(OUT, f), minifyJs);
});

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  version: "1.0.0",
  note: "Fichiers minifiés — déployer build/ en complément ou remplacer en CI"
}, null, 2));

console.log("\nBuild production terminé :", OUT);
