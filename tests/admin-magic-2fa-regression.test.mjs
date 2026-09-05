import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const authRoute = fs.readFileSync(new URL("../backend/routes/auth.js", import.meta.url), "utf8");
const loginPage = fs.readFileSync(new URL("../admin-email-login.html", import.meta.url), "utf8");
const publicLoginPage = fs.readFileSync(new URL("../backend/public/admin-email-login.html", import.meta.url), "utf8");

test("magic-link confirmation follows the explicit 2FA configuration", () => {
  assert.match(
    authRoute,
    /router\.post\("\/email\/confirm"[\s\S]*?if \(REQUIRE_ADMIN_2FA\) return res\.json\(beginAdmin2fa\(user, req, "magic_link"\)\)/,
  );
  assert.match(
    authRoute,
    /router\.post\("\/email\/confirm"[\s\S]*?res\.json\(completeSession\(user, req\)\)/,
  );
});

test("both deployed magic-login pages use the cache-busted recovery script", () => {
  for (const page of [loginPage, publicLoginPage]) {
    assert.match(page, /admin-email-login\.js\?v=20260904-magic-2fa-2/);
    assert.match(page, /style\.css\?v=20260904-magic-2fa-2/);
  }
});
