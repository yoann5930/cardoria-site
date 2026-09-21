import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, "../lib/auth/passwordReset.js"), "utf8");
const magic = fs.readFileSync(path.join(__dirname, "../lib/auth/magicLink.js"), "utf8");
const cors = fs.readFileSync(path.join(__dirname, "../lib/security/index.js"), "utf8");
const client = fs.readFileSync(path.join(__dirname, "../../js/client-password-reset.js"), "utf8");

test("password reset email always uses the canonical public HTTPS origin", () => {
  assert.match(source, /const RESET_PUBLIC_ORIGIN = "https:\/\/www\.cardoriashop\.fr";/);
  assert.match(source, /publicSiteOrigin\(\)/);
  assert.match(source, /admin-reset-password\.html/);
  assert.match(source, /reset-password\.html/);
  assert.match(source, /encodeURIComponent\(token\)/);
  assert.doesNotMatch(source, /const siteUrl = String\(process\.env\.SITE_URL/);
});

test("magic login links use the same public HTTPS origin helper", () => {
  assert.match(magic, /publicSiteOrigin\(\)/);
  assert.doesNotMatch(magic, /process\.env\.SITE_URL/);
});

test("production CORS always allows the Cardoria HTTPS origins", () => {
  assert.match(cors, /https:\/\/www\.cardoriashop\.fr/);
  assert.match(cors, /https:\/\/cardoriashop\.fr/);
  assert.doesNotMatch(cors, /else if \(!origin && allowedOrigins\[0\]\)/);
});

test("client reset maps network failures instead of showing Failed to fetch", () => {
  assert.match(client, /AbortController/);
  assert.match(client, /Connexion au serveur Cardoria impossible/);
  assert.doesNotMatch(client, /CARDORIA_BACKEND/);
  assert.match(client, /\/api\/auth\/password\/request/);
  assert.match(client, /\/api\/auth\/password\/confirm/);
});
