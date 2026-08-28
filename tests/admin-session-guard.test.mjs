import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/admin/admin-core.js", import.meta.url), "utf8");

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    has(key) { return map.has(key); }
  };
}

function makeResponse(status, body) {
  const text = JSON.stringify(body || {});
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => JSON.parse(text),
    text: async () => text
  };
}

function boot({ storage = {}, fetchImpl } = {}) {
  const sessionStorage = makeStorage(storage);
  const redirects = [];
  const documentElement = { style: { visibility: "" } };
  const context = {
    console,
    Date,
    Promise,
    JSON,
    Math,
    Number,
    Object,
    String,
    Array,
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    AbortController: undefined,
    FormData: undefined,
    sessionStorage,
    location: {
      pathname: "/admin-stock.html",
      replace(url) { redirects.push(url); }
    },
    document: {
      documentElement,
      body: { className: "", innerHTML: "" },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    fetch: fetchImpl || (async () => makeResponse(200, { ok: true, user: { role: "admin", email: "admin@example.com", expiresAt: new Date(Date.now() + 3600000).toISOString() } }))
  };
  context.window = { CARDORIA_SEO: { backendUrl: "https://example.invalid" } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "admin-core.js" });
  return { api: context.window.CardoriaAdmin, sessionStorage, redirects, documentElement, context };
}

function validStorage(role = "admin") {
  return {
    cardoria_session_token: "opaque-token",
    cardoria_admin_role: role,
    cardoria_session_expires_at: new Date(Date.now() + 3600000).toISOString(),
    cardoria_admin_connected: "yes"
  };
}

test("expired admin session is rejected before admin UI is revealed", () => {
  const env = boot({ storage: { ...validStorage(), cardoria_session_expires_at: new Date(Date.now() - 1000).toISOString() } });
  assert.equal(env.api.protectAdmin(), false);
  assert.deepEqual(env.redirects, ["admin-login.html"]);
  assert.equal(env.sessionStorage.has("cardoria_session_token"), false);
});

test("client role cannot pass the admin guard", () => {
  const env = boot({ storage: validStorage("client") });
  assert.equal(env.api.protectAdmin(), false);
  assert.deepEqual(env.redirects, ["admin-login.html"]);
});

test("verified admin role and server expiry reveal the admin UI", async () => {
  const expiresAt = new Date(Date.now() + 7200000).toISOString();
  const env = boot({
    storage: validStorage("admin"),
    fetchImpl: async () => makeResponse(200, { ok: true, user: { role: "admin", email: "admin@example.com", expiresAt } })
  });
  assert.equal(env.api.protectAdmin(), true);
  assert.equal(await env.api.validateAdminSession(), true);
  assert.equal(env.documentElement.style.visibility, "");
  assert.equal(env.sessionStorage.getItem("cardoria_admin_role"), "admin");
  assert.equal(env.sessionStorage.getItem("cardoria_session_expires_at"), expiresAt);
});

test("403 keeps a valid admin session", async () => {
  const env = boot({ storage: validStorage(), fetchImpl: async () => makeResponse(403, { ok: false, error: "Droits insuffisants." }) });
  const result = await env.api.adminFetch("/api/admin/restricted");
  assert.equal(result.status, 403);
  assert.equal(env.sessionStorage.has("cardoria_session_token"), true);
  assert.deepEqual(env.redirects, []);
});

test("401 clears admin session and redirects to login", async () => {
  const env = boot({ storage: validStorage(), fetchImpl: async () => makeResponse(401, { ok: false, error: "Session expirée." }) });
  const result = await env.api.adminFetch("/api/admin/anything");
  assert.equal(result.status, 401);
  assert.equal(env.sessionStorage.has("cardoria_session_token"), false);
  assert.deepEqual(env.redirects, ["admin-login.html"]);
});
