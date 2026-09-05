import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const auth = read("../backend/routes/auth.js");
const migration = read("../backend/lib/auth/migrate.js");
const users = read("../backend/lib/auth/users.js");
const passwordReset = read("../backend/lib/auth/passwordReset.js");
const validation = read("../backend/lib/security/validate.js");
const loginPages = [read("../admin-login.html"), read("../backend/public/admin-login.html")];
const resetPages = [read("../admin-reset-password.html"), read("../backend/public/admin-reset-password.html")];
const resetScripts = [read("../js/admin/admin-password-reset.js"), read("../backend/public/js/admin/admin-password-reset.js")];

test("admin login creates a normal session when production 2FA is disabled", () => {
  assert.match(auth, /const REQUIRE_ADMIN_2FA = [^;]+ADMIN_REQUIRE_2FA/);
  assert.match(auth, /if \(ADMIN_ROLES\.includes\(user\.role\) && REQUIRE_ADMIN_2FA\)/);
  assert.match(auth, /res\.json\(completeSession\(user, req\)\)/);
});

test("a reset password is not overwritten by the deployment secret", () => {
  assert.doesNotMatch(migration, /UPDATE auth_users SET password_hash/);
  assert.doesNotMatch(users, /configuredAdminPassword|renderAdminPasswordValid/);
});

test("password reset email targets the requested user and fails explicitly on SMTP failure", () => {
  assert.match(passwordReset, /to: user\.email/);
  assert.match(passwordReset, /if \(!sent\)/);
  assert.match(passwordReset, /Service d'envoi d'e-mail indisponible/);
  assert.match(passwordReset, /newPassword\.length < 10/);
  assert.match(validation, /passwordResetConfirm:[\s\S]*?minLength: 10/);
});

test("login pages replace the magic link with password reset", () => {
  for (const page of loginPages) {
    assert.match(page, /href="\/admin-reset-password\.html"/);
    assert.match(page, /Réinitialiser mon mot de passe/);
    assert.doesNotMatch(page, /<form[^>]+id="adminEmailLoginForm"|Recevoir un lien par e-mail/);
  }
});

test("password reset uses an external same-origin script", () => {
  for (const page of resetPages) {
    assert.match(page, /src="\/js\/admin\/admin-password-reset\.js\?v=20260905-password-reset-2"/);
    assert.doesNotMatch(page, /BACKEND|fetch\(/);
  }
  for (const script of resetScripts) {
    assert.match(script, /postJson\("\/api\/auth\/password\/request"/);
    assert.match(script, /postJson\("\/api\/auth\/password\/confirm"/);
    assert.doesNotMatch(script, /CARDORIA_SEO|CARDORIA_BACKEND|https:\/\//);
  }
  assert.equal(resetScripts[0], resetScripts[1]);
});
