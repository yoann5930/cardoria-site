import crypto from "crypto";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const email = String(process.env.ADMIN_EMAIL || "ci-admin@cardoria.invalid").trim().toLowerCase();
const password = String(process.env.ADMIN_LOGIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD || "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = String(input || "").toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const c of str) {
    const val = alphabet.indexOf(c);
    if (val < 0) throw new Error("Invalid base32 secret");
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(code).padStart(6, "0");
}

async function json(path, options = {}) {
  const response = await fetch(BASE + path, options);
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

async function login() {
  return json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
}

async function verify(challengeToken, code) {
  return json("/api/auth/2fa/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken, totpCode: code })
  });
}

assert(password, "ADMIN password missing for E2E test");

const first = await login();
assert(first.response.status === 200 && first.body.ok, `Initial login failed: ${first.response.status}`);
assert(first.body.requires2fa === true, "Admin login must require 2FA");
assert(!first.body.token, "Admin login must not create a session before 2FA");
assert(first.body.mode === "setup", `Expected setup mode, got ${first.body.mode}`);
assert(first.body.setup?.secret, "Setup secret missing");
assert(/^[A-Z2-7]+$/.test(first.body.setup.secret), "TOTP secret is not RFC Base32");
const secret = first.body.setup.secret;

const validFirstCode = totp(secret);
const deliberatelyWrong = validFirstCode === "000000" ? "000001" : "000000";
const wrong = await verify(first.body.challengeToken, deliberatelyWrong);
assert(wrong.response.status === 401, "Wrong TOTP must be rejected");
assert(!wrong.body.token, "Wrong TOTP must never return a session token");

const enrolled = await verify(first.body.challengeToken, totp(secret));
assert(enrolled.response.status === 200 && enrolled.body.ok, `2FA setup verification failed: ${enrolled.response.status}`);
assert(enrolled.body.token, "Session token missing after valid 2FA");
assert(enrolled.body.user?.totpEnabled === true, "2FA must be enabled after setup verification");
const firstSession = enrolled.body.token;

const me = await json("/api/auth/me", { headers: { Authorization: `Bearer ${firstSession}` } });
assert(me.response.status === 200 && me.body.user?.totpEnabled === true, "2FA-authenticated session is not valid");

await json("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${firstSession}` } });

const second = await login();
assert(second.response.status === 200 && second.body.ok, "Second admin login failed");
assert(second.body.requires2fa === true, "Every admin login must require 2FA");
assert(second.body.mode === "login", `Expected login challenge mode, got ${second.body.mode}`);
assert(!second.body.setup, "Enabled 2FA must not expose setup secret again");
assert(!second.body.token, "Second admin login must not create a session before TOTP");

const verified = await verify(second.body.challengeToken, totp(secret));
assert(verified.response.status === 200 && verified.body.token, "Existing TOTP login did not create a session");

const legacyEndpoint = await fetch(BASE + "/api/admin/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: "legacy-test" })
});
assert([401, 404].includes(legacyEndpoint.status), `Legacy /api/admin/login unexpectedly usable (${legacyEndpoint.status})`);
let legacyBody = {};
try { legacyBody = await legacyEndpoint.json(); } catch {}
assert(!legacyBody.token && legacyBody.legacy !== true, "Legacy endpoint returned authentication material");

const legacyHeader = await fetch(BASE + "/api/admin/dashboard", {
  headers: { "x-cardoria-admin-code": "legacy-test" }
});
assert(legacyHeader.status === 401, `Legacy admin header bypass still accepted (${legacyHeader.status})`);

await json("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${verified.body.token}` } });
console.log("SECURITY_2FA_E2E_PASS");
