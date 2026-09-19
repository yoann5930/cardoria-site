import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pairs = [
  "client-login.html", "css/live-studio-clean.css", "js/client-auth.js",
  "js/cardoria-live-actions.js", "js/cardoria-live-viewer.js", "js/live-energy-spots.js",
  "js/live-shipping-address.js", "js/live-studio-actions-ui.js", "js/live-studio-sales-controls.js",
  "js/marketplace-seller-dashboard.js", "js/carte.js", "js/seo.js"
];

test("Live and upstream SEO source files match the served backend mirrors byte for byte", () => {
  for (const relative of pairs) {
    const source = fs.readFileSync(path.join(root, relative));
    const runtime = fs.readFileSync(path.join(root, "backend/public", relative));
    assert.ok(source.equals(runtime), "Runtime drift: " + relative);
  }
});

test("the committed runtime fingerprint matches the same deterministic CI calculation", () => {
  // Fixed command, no user-provided paths or interpolation. Matches the existing
  // Linux frontend-sync workflow and does not write to the repository.
  const calculated = execFileSync("bash", ["-lc", "set -euo pipefail; find backend/public -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum"], { cwd: root, encoding: "utf8" }).trim().split(/\s+/)[0];
  const stored = fs.readFileSync(path.join(root, "backend/.frontend-runtime-sha"), "utf8").trim();
  assert.equal(stored, "frontend-runtime-sha256=" + calculated);
});
