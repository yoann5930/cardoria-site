#!/usr/bin/env node
/**
 * Audit lancement Cardoria V1.0 — liens, JS, CSS, sécurité, SEO.
 * Usage : node scripts/audit-launch.mjs [--fix]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIX = process.argv.includes("--fix");

const report = {
  timestamp: new Date().toISOString(),
  brokenLinks: [],
  missingScripts: [],
  jsErrors: [],
  cssIssues: [],
  seoIssues: [],
  securityWarnings: [],
  duplicates: [],
  passed: [],
  score: 100
};

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !["node_modules", ".git", "data", "backups", "build"].includes(e.name)) {
      walk(p, ext, out);
    } else if (e.isFile() && (!ext || p.endsWith(ext))) out.push(p);
  }
  return out;
}

function deduct(n, reason, arr) {
  report.score = Math.max(0, report.score - n);
  arr.push(reason);
}

// HTML link check
const htmlFiles = [...walk(ROOT, ".html"), ...walk(path.join(ROOT, "pages"), ".html")];
const linkRe = /(?:href|src)=["']([^"'#?][^"']*)["']/gi;

htmlFiles.forEach((file) => {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, "utf8");
  let m;
  while ((m = linkRe.exec(content))) {
    let target = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(target)) continue;
    if (target.startsWith("/")) target = target.slice(1);
    const resolved = path.resolve(path.dirname(file), target.split("?")[0]);
    if (!fs.existsSync(resolved) && !target.startsWith("api/")) {
      deduct(1, `${rel} → ${m[1]}`, report.brokenLinks);
    }
  }
  if (!content.includes('meta name="viewport"')) deduct(2, `${rel} : viewport manquant`, report.seoIssues);
  if (!content.includes("lang=")) deduct(1, `${rel} : attribut lang manquant`, report.seoIssues);
  if (!rel.startsWith("admin") && !content.includes('meta name="description"') && !content.includes("seo.js")) {
    deduct(1, `${rel} : meta description absente`, report.seoIssues);
  }
});

// JS syntax
walk(path.join(ROOT, "js"), ".js").forEach((f) => {
  try {
    execSync(`node --check "${f}"`, { stdio: "pipe" });
  } catch {
    deduct(5, path.relative(ROOT, f), report.jsErrors);
  }
});

// CSS empty or huge
walk(path.join(ROOT, "css"), ".css").forEach((f) => {
  const stat = fs.statSync(f);
  if (stat.size === 0) deduct(3, path.relative(ROOT, f) + " vide", report.cssIssues);
});

// Security checks
if (fs.existsSync(path.join(ROOT, "backend", ".env"))) {
  deduct(10, ".env présent à la racine backend — ne pas committer", report.securityWarnings);
}
const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
if (!robots.includes("Sitemap:")) deduct(5, "robots.txt sans Sitemap", report.seoIssues);
else report.passed.push("robots.txt avec Sitemap");

if (fs.existsSync(path.join(ROOT, "sitemap-index.xml"))) report.passed.push("sitemap-index.xml présent");
else deduct(3, "sitemap-index.xml manquant", report.seoIssues);

// Duplicate HTML titles (sample)
const titles = {};
htmlFiles.forEach((f) => {
  const m = fs.readFileSync(f, "utf8").match(/<title>([^<]+)<\/title>/i);
  if (m) {
    const t = m[1].trim();
    if (titles[t]) report.duplicates.push(`${path.relative(ROOT, f)} ↔ ${titles[t]} : "${t}"`);
    else titles[t] = path.relative(ROOT, f);
  }
});
report.duplicates.forEach((d) => deduct(2, d, report.duplicates));

report.score = Math.max(0, report.score - report.brokenLinks.length * 0.5);

const outPath = path.join(ROOT, "docs", "AUDIT_LAUNCH_REPORT.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log("\n=== Cardoria Launch Audit ===");
console.log("Score:", report.score, "/ 100");
console.log("Liens cassés:", report.brokenLinks.length);
console.log("Erreurs JS:", report.jsErrors.length);
console.log("Issues SEO:", report.seoIssues.length);
console.log("Rapport:", outPath);
process.exit(report.score >= 70 ? 0 : 1);
