import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, "../lib/auth/passwordReset.js"), "utf8");

test("password reset email always uses the canonical public HTTPS origin", () => {
  assert.match(source, /const RESET_PUBLIC_ORIGIN = "https:\/\/www\.cardoriashop\.fr";/);
  assert.match(source, /const link = `\$\{RESET_PUBLIC_ORIGIN\}\/admin-reset-password\.html\?token=\$\{token\}`;/);
  assert.doesNotMatch(source, /const siteUrl = String\(process\.env\.SITE_URL/);
});
