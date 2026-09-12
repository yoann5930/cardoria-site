import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const login = readFileSync(new URL("../js/admin/admin-login-secure.js", import.meta.url), "utf8");
const adminLive = readFileSync(new URL("../admin-live.html", import.meta.url), "utf8");
const publicLive = readFileSync(new URL("../live.html", import.meta.url), "utf8");
const adminStudio = readFileSync(new URL("../js/cardoria-live-admin-studio.js", import.meta.url), "utf8");

test("admin login creates a short-lived handoff for Live Studio navigation", () => {
  assert.match(login, /HANDOFF_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.match(login, /cardoria_admin_handoff_token/);
  assert.match(login, /cardoria_admin_handoff_expires/);
  assert.match(login, /saveAdminHandoff\(data, fallbackEmail\)/);
});

test("admin Live restores the handoff before admin-core protects the page", () => {
  const restoreIndex = adminLive.indexOf("cardoria_admin_handoff_token");
  const adminCoreIndex = adminLive.indexOf("/js/admin/admin-core.js");
  assert.ok(restoreIndex >= 0, "handoff restoration script missing");
  assert.ok(adminCoreIndex > restoreIndex, "handoff must be restored before admin-core boots");
  assert.match(adminLive, /sessionStorage\.setItem\("cardoria_admin_connected", "yes"\)/);
  assert.match(adminLive, /sessionStorage\.setItem\("cardoria_session_token", token\)/);
});

test("public Live keeps an authenticated Cardoria admin in the admin Studio path", () => {
  assert.match(publicLive, /id="cardoriaLiveEntry"/);
  assert.match(publicLive, /entry\.href="\/admin-live\.html"/);
  assert.match(publicLive, /Ouvrir le Studio Live Admin/);
  assert.match(publicLive, /cardoria_admin_handoff_token/);
});

test("embedded admin Studio still accepts session or admin grant access", () => {
  assert.match(adminStudio, /cardoria_session_token/);
  assert.match(adminStudio, /cardoriaAdminGrant/);
  assert.match(adminStudio, /x-live-admin-grant/);
});
