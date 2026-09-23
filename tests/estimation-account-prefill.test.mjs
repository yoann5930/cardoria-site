// Estimation account prefill regression: logged-in clients get name + email automatically.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const rootHtml = fs.readFileSync(new URL("../estimation.html", import.meta.url), "utf8");
const mirrorHtml = fs.readFileSync(new URL("../backend/public/estimation.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../js/estimation-account-prefill.js", import.meta.url), "utf8");
const mirrorScript = fs.readFileSync(new URL("../backend/public/js/estimation-account-prefill.js", import.meta.url), "utf8");

test("estimation page loads client account prefill runtime", () => {
  assert.equal(rootHtml, mirrorHtml);
  assert.equal(script, mirrorScript);
  assert.match(rootHtml, /id="customerName"[^>]*autocomplete="name"/);
  assert.match(rootHtml, /id="customerEmail"[^>]*type="email"[^>]*autocomplete="email"/);
  assert.match(rootHtml, /estimation-account-prefill\.js\?v=1/);
});

test("logged-in client identity is read from the canonical session and auth endpoint", () => {
  assert.match(script, /cardoria_session_token/);
  assert.match(script, /cardoria_client_session/);
  assert.match(script, /cardoria_account/);
  assert.match(script, /\/api\/auth\/me/);
  assert.match(script, /Authorization: "Bearer " \+ token/);
  assert.match(script, /account\.role === "client"/);
});

test("profile first and last name take priority and fields stay editable", () => {
  assert.match(script, /\[account\.firstName, account\.lastName\]/);
  assert.match(script, /fullName \|\| String\(account\.name/);
  assert.match(script, /input\.dataset\.cardoriaPrefilled/);
  assert.match(script, /if \(input\.value && input\.dataset\.cardoriaPrefilled !== "true"\) return/);
  assert.doesNotMatch(rootHtml, /id="customerName"[^>]*readonly/);
  assert.doesNotMatch(rootHtml, /id="customerEmail"[^>]*readonly/);
});

test("expired client session clears stale cached identity", () => {
  assert.match(script, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(script, /clearExpiredSession\(\)/);
  assert.match(script, /clearPrefilledFields\(\)/);
});
