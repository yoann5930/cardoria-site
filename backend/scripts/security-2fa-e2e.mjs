import crypto from "crypto";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const email = String(process.env.ADMIN_EMAIL || "ci-admin@cardoria.invalid").trim().toLowerCase();
const password = String(process.env.ADMIN_LOGIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD || "");

function assert(condition, message) { if (!condition) throw new Error(message); }
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = String(input || "").toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const c of str) { const val = alphabet.indexOf(c); if (val < 0) throw new Error("Invalid base32 secret"); bits += val.toString(2).padStart(5, "0"); }
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30); const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest(); const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function json(path, options = {}) { const response = await fetch(BASE + path, options); let body = {}; try { body = await response.json(); } catch {} return { response, body }; }
async function login() { return json("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); }
async function verify(challengeToken, code) { return json("/api/auth/2fa/login/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken, totpCode: code }) }); }
async function assertLegacyBypassesBlocked() {
  const legacyEndpoint = await fetch(BASE + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "legacy-test" }) });
  assert([401, 404].includes(legacyEndpoint.status), `Legacy /api/admin/login unexpectedly usable (${legacyEndpoint.status})`);
  let legacyBody = {}; try { legacyBody = await legacyEndpoint.json(); } catch {}
  assert(!legacyBody.token && legacyBody.legacy !== true, "Legacy endpoint returned authentication material");
  const legacyHeader = await fetch(BASE + "/api/admin/dashboard", { headers: { "x-cardoria-admin-code": "legacy-test" } });
  assert(legacyHeader.status === 401, `Legacy admin header bypass still accepted (${legacyHeader.status})`);
}

assert(password, "ADMIN password missing for E2E test");
const first = await login();
assert(first.response.status === 200 && first.body.ok, `Initial login failed: ${first.response.status}`);

// Cardoria supports direct admin login when 2FA is not enabled, while retaining the
// challenge flow for accounts that use 2FA. Both modes must remain secure.
if (first.body.token && first.body.requires2fa !== true) {
  const me = await json("/api/auth/me", { headers: { Authorization: `Bearer ${first.body.token}` } });
  assert(me.response.status === 200 && me.body.user?.role === "super_admin", "Direct admin session is not valid");
  await assertLegacyBypassesBlocked();
  await json("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${first.body.token}` } });
  console.log("SECURITY_AUTH_E2E_PASS_DIRECT");
  process.exit(0);
}

assert(first.body.requires2fa === true, "Login returned neither a session nor a 2FA challenge");
assert(!first.body.token, "2FA challenge must not create a session before verification");
assert(first.body.mode === "setup" || first.body.mode === "login", `Unexpected 2FA mode: ${first.body.mode}`);

let secret = first.body.setup?.secret || "";
if (first.body.mode === "setup") {
  assert(secret && /^[A-Z2-7]+$/.test(secret), "TOTP setup secret missing or invalid");
  const validFirstCode = totp(secret);
  const deliberatelyWrong = validFirstCode === "000000" ? "000001" : "000000";
  const wrong = await verify(first.body.challengeToken, deliberatelyWrong);
  assert(wrong.response.status === 401 && !wrong.body.token, "Wrong TOTP must be rejected");
  const enrolled = await verify(first.body.challengeToken, totp(secret));
  assert(enrolled.response.status === 200 && enrolled.body.token, "2FA setup verification failed");
  await json("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${enrolled.body.token}` } });
  const second = await login();
  assert(second.body.requires2fa === true && second.body.mode === "login" && !second.body.token, "Enabled 2FA must challenge subsequent logins");
  const verified = await verify(second.body.challengeToken, totp(secret));
  assert(verified.response.status === 200 && verified.body.token, "Existing TOTP login did not create a session");
  await assertLegacyBypassesBlocked();
  await json("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${verified.body.token}` } });
} else {
  // Existing 2FA account: the challenge itself and absence of a pre-verification token
  // are verified here; no secret is available to CI by design.
  assert(first.body.challengeToken, "2FA challenge token missing");
  await assertLegacyBypassesBlocked();
}
console.log("SECURITY_AUTH_E2E_PASS_2FA");
