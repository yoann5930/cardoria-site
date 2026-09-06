import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const analyticsSource = fs.readFileSync(path.join(__dirname, "../routes/analytics.js"), "utf8");
const stockSource = fs.readFileSync(path.join(__dirname, "../lib/boutique/stock.js"), "utf8");
const attributionSource = fs.readFileSync(path.join(__dirname, "../public/js/attribution.js"), "utf8");

test("analytics starts without seeded fake visitors and deduplicates visitorId per day", () => {
  assert.match(analyticsSource, /sources:\s*\{\s*google:\s*0,\s*facebook:\s*0,\s*instagram:\s*0,\s*direct:\s*0,\s*witnot:\s*0\s*\}/);
  assert.match(analyticsSource, /devices:\s*\{\s*mobile:\s*0,\s*desktop:\s*0,\s*tablet:\s*0\s*\}/);
  assert.match(analyticsSource, /const key = visitorKey\(visitorId\);/);
  assert.match(analyticsSource, /if \(!keys\.includes\(key\)\) \{/);
  assert.match(analyticsSource, /day\.visitors = Number\(day\.visitors \|\| 0\) \+ 1;/);
  assert.doesNotMatch(analyticsSource, /day\.visitors = Number\(day\.visitors \|\| 0\) \+ 1;\s*\n\s*const ref/);
});

test("browser sends a stable visitorId to the analytics endpoint", () => {
  assert.match(attributionSource, /var VISITOR_KEY = "cardoria_vid";/);
  assert.match(attributionSource, /visitorId: getVisitorId\(\)/);
  assert.match(attributionSource, /\/api\/analytics\/track/);
});

test("explicit zero stock is never converted to one during stock aggregation", () => {
  assert.match(stockSource, /function normalizeStockQuantity\(value, fallback = 1\)/);
  assert.match(stockSource, /return Math\.max\(0, Math\.trunc\(parsed\)\);/);
  assert.match(stockSource, /const qty = normalizeStockQuantity\(item\.stock, 1\);\s*\n\s*if \(qty <= 0\) return;/);
  assert.match(stockSource, /const qty = normalizeStockQuantity\(purchase\.quantity, 1\);\s*\n\s*if \(qty <= 0\) continue;/);
  assert.doesNotMatch(stockSource, /const qty = Math\.max\(1, Math\.trunc\(Number\(purchase\.quantity\) \|\| 1\)\);/);
});

test("normal order quantities keep their existing minimum-one protection", () => {
  assert.match(stockSource, /Math\.max\(1, Math\.trunc\(Number\(item\.qty\) \|\| 1\)\)/);
});
