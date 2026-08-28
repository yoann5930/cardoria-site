import crypto from "crypto";
import { createSession, validateSession } from "../lib/auth/session.js";
import { getUserByEmail, getUserById, setTotpSecret, updateUserAdmin } from "../lib/auth/users.js";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:10000";
const email = String(process.env.ADMIN_EMAIL || "ci-admin@cardoria.invalid").trim().toLowerCase();
const password = String(process.env.ADMIN_LOGIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD || "");
const managedEmail = `managed-${Date.now()}@cardoria.invalid`;

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

async function admin(path, token, options = {}) {
  options.headers = { ...(options.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return json(path, options);
}

async function loginSuperAdmin() {
  const first = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert(first.response.status === 200 && first.body.ok && first.body.requires2fa, "Super admin login must require 2FA");
  let secret = first.body.setup?.secret || "";
  if (!secret) {
    const actor = getUserByEmail(email);
    assert(actor?.totpEnabled, "Existing super admin 2FA must be enabled");
    throw new Error("E2E requires a clean auth database so the seeded super admin enters setup mode");
  }
  const verified = await json("/api/auth/2fa/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken: first.body.challengeToken, totpCode: totp(secret) })
  });
  assert(verified.response.status === 200 && verified.body.token, "Super admin 2FA verification failed");
  return { token: verified.body.token, actor: verified.body.user };
}

assert(password, "ADMIN password missing for users E2E");
const { token, actor } = await loginSuperAdmin();
assert(actor?.role === "super_admin", "Seeded actor must be super_admin");

const initial = await admin("/api/admin/users", token);
assert(initial.response.status === 200 && initial.body.ok, "Users list unavailable");
assert(initial.body.actor?.role === "super_admin", "Users endpoint actor metadata missing");
assert(initial.body.summary?.activeSuperAdmins >= 1, "Super admin summary missing");

const created = await admin("/api/admin/users", token, {
  method: "POST",
  body: JSON.stringify({ name: "Managed User", email: managedEmail, role: "employee" })
});
assert(created.response.status === 201 && created.body.user?.role === "employee", "Employee creation failed");
const managedId = created.body.user.id;

const duplicate = await admin("/api/admin/users", token, {
  method: "POST",
  body: JSON.stringify({ name: "Duplicate", email: managedEmail, role: "employee" })
});
assert(duplicate.response.status === 409, "Duplicate active/inactive email must be rejected");

const renamed = await admin(`/api/admin/users/${managedId}`, token, {
  method: "PUT",
  body: JSON.stringify({ name: "Managed User Updated" })
});
assert(renamed.response.status === 200 && renamed.body.user?.name === "Managed User Updated", "Name update failed");
assert(renamed.body.sessionsRevoked === false, "Name-only update must not revoke sessions");

setTotpSecret(managedId, "JBSWY3DPEHPK3PXP", true);
const sessionOne = createSession(managedId, { ip: "127.0.0.1", userAgent: "users-e2e" });
assert(validateSession(sessionOne.token)?.id === managedId, "Managed user session setup failed");

const promoted = await admin(`/api/admin/users/${managedId}`, token, {
  method: "PUT",
  body: JSON.stringify({ role: "admin" })
});
assert(promoted.response.status === 200 && promoted.body.user?.role === "admin", "Role promotion failed");
assert(promoted.body.sessionsRevoked === true, "Role change must revoke sessions");
assert(validateSession(sessionOne.token) === null, "Old session survived role change");

setTotpSecret(managedId, "JBSWY3DPEHPK3PXP", true);
const sessionTwo = createSession(managedId, { ip: "127.0.0.1", userAgent: "users-e2e" });
assert(validateSession(sessionTwo.token)?.role === "admin", "Admin session setup failed");

const revoked = await admin(`/api/admin/users/${managedId}/revoke-sessions`, token, { method: "POST", body: "{}" });
assert(revoked.response.status === 200 && revoked.body.sessionsRevoked === true, "Explicit session revocation failed");
assert(validateSession(sessionTwo.token) === null, "Explicit session revocation did not invalidate token");

setTotpSecret(managedId, "JBSWY3DPEHPK3PXP", true);
const sessionThree = createSession(managedId, { ip: "127.0.0.1", userAgent: "users-e2e" });
const reset = await admin(`/api/admin/users/${managedId}/reset-2fa`, token, { method: "POST", body: "{}" });
assert(reset.response.status === 200 && reset.body.twoFactorReset === true, "2FA reset failed");
assert(validateSession(sessionThree.token) === null, "2FA reset did not revoke active session");
assert(getUserById(managedId)?.totpEnabled === false, "2FA secret still enabled after reset");

const disabled = await admin(`/api/admin/users/${managedId}`, token, {
  method: "PUT",
  body: JSON.stringify({ active: false })
});
assert(disabled.response.status === 200 && disabled.body.user?.active === false, "Account disable failed");

const inactiveList = await admin("/api/admin/users", token);
assert(inactiveList.body.users?.some((u) => u.id === managedId && u.active === false), "Inactive account disappeared from admin list");

const reactivated = await admin(`/api/admin/users/${managedId}`, token, {
  method: "PUT",
  body: JSON.stringify({ active: true })
});
assert(reactivated.response.status === 200 && reactivated.body.user?.active === true, "Account reactivation failed");

const selfDemote = await admin(`/api/admin/users/${actor.id}`, token, {
  method: "PUT",
  body: JSON.stringify({ role: "admin" })
});
assert(selfDemote.response.status === 409, "Current super admin must not be able to demote itself from admin UI");

let directLastSuperAdminBlocked = false;
try {
  updateUserAdmin(actor.id, { role: "admin" }, "super_admin");
} catch (error) {
  directLastSuperAdminBlocked = error?.status === 409;
}
assert(directLastSuperAdminBlocked, "Last super admin protection failed in authoritative user model");

await json("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
console.log("USERS_ADMIN_E2E_PASS");
