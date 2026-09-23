import { chromium } from "playwright";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { migrateAuth } from "../backend/lib/auth/migrate.js";
import { createUser } from "../backend/lib/auth/users.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(root, "backend");
const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const adminEmail = `live-journey-admin-${suffix}@cardoria.invalid`;
const adminPassword = "Live-Journey-Admin-2026!";
const clientName = "Camille Live";
const clientEmail = `live-journey-client-${suffix}@cardoria.invalid`;
const clientPassword = "LiveClient2026";
const liveTitle = `Live public journey ${suffix}`;
const scheduledTitle = `Live programmé journey ${suffix}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitReady(base, log) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(base + "/api/health/startup");
      const body = await response.json();
      if (body?.ready) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Backend Live journey not ready.\n" + log());
}

async function json(base, pathname, { method = "GET", body, token } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function collectPageSignals(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const unexpectedNetwork = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const loc = msg.location()?.url || "";
    consoleErrors.push(`${msg.text()} ${loc}`.trim());
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    const method = response.request().method();
    const allowed = (
      (status === 401 && /\/api\/live\/actions\/.+\/chat$/.test(url) && method === "POST") ||
      (status === 401 && url.includes("/admin-access")) ||
      (status === 404 && /favicon|apple-touch-icon|\.map($|\?)/i.test(url)) ||
      (status === 404 && /\/api\/live\/actions\/.+\/(state|chat)$/.test(url))
    );
    if (!allowed) unexpectedNetwork.push(`${status} ${method} ${url}`);
  });
  return { pageErrors, consoleErrors, unexpectedNetwork };
}

function assertCleanBrowser(signals, label) {
  const ignoredConsole = signals.consoleErrors.filter((text) => !/favicon|apple-touch-icon|\.map|Failed to load resource|net::ERR_FAILED|ice|webrtc|ICE/i.test(text));
  assert.equal(signals.pageErrors.length, 0, `${label} pageerror: ${signals.pageErrors.join(" | ")}`);
  assert.equal(ignoredConsole.length, 0, `${label} console: ${ignoredConsole.join(" | ")}`);
  assert.equal(signals.unexpectedNetwork.length, 0, `${label} network: ${signals.unexpectedNetwork.join(" | ")}`);
}

migrateAuth();
createUser({ email: adminEmail, password: adminPassword, role: "admin", name: "Live Journey Admin" });

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
let serverOutput = "";
const child = spawn(process.execPath, ["server.js"], {
  cwd: backendDir,
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    CORS_ORIGINS: base,
    ALERT_EMAIL: "false",
    MARKETPLACE_DEMO_MODE: "false",
    ADMIN_REQUIRE_2FA: "false",
    LEGACY_ADMIN_CODE: "false",
    ADMIN_AUTH_DISABLED: "false"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
});

try {
  await waitReady(base, () => serverOutput);
  const served = await fetch(base + "/live.html");
  const servedHtml = await served.text();
  assert.equal(served.status, 200);
  assert.match(served.headers.get("cache-control") || "", /no-store/i);
  assert.doesNotMatch(servedHtml, /cardoria-live-admin-studio\.js/);
  assert.doesNotMatch(servedHtml, /cardoria_admin_handoff_token/);
  assert.match(servedHtml, /Live en cours — en attente de diffusion/);
  const viewerHeaders = await fetch(base + "/js/cardoria-live-viewer.js", { method: "HEAD" });
  assert.match(viewerHeaders.headers.get("cache-control") || "", /no-store/i);
  const loginHeaders = await fetch(base + "/client-login.html", { method: "HEAD" });
  assert.match(loginHeaders.headers.get("x-frame-options") || "", /SAMEORIGIN/i);
  assert.match(loginHeaders.headers.get("content-security-policy") || "", /frame-ancestors 'self'/);

  const adminContext = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    permissions: ["camera", "microphone"]
  });
  const adminPage = await adminContext.newPage();
  adminPage.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  const adminSignals = collectPageSignals(adminPage);
  await adminPage.goto(base + "/admin-login.html", { waitUntil: "domcontentloaded" });
  await adminPage.fill("#adminEmail", adminEmail);
  await adminPage.fill("#adminPassword", adminPassword);
  await Promise.all([
    adminPage.waitForURL(/\/admin\.html/, { timeout: 20000 }),
    adminPage.click("#adminPasswordLoginForm button[type='submit']")
  ]);
  await adminPage.goto(base + "/admin-live.html", { waitUntil: "domcontentloaded" });
  await adminPage.waitForSelector("#liveCreate", { state: "attached", timeout: 20000 });
  await adminPage.locator("details.live-studio-prepare").evaluate((el) => { el.open = true; });
  await adminPage.waitForSelector("#liveCreate", { state: "visible", timeout: 10000 });
  await adminPage.fill("#liveTitle", liveTitle);
  await adminPage.click("#liveCreate");
  await adminPage.waitForFunction((title) => document.body.innerText.includes(title), liveTitle, { timeout: 20000 });
  await adminPage.click("#liveGoStart");
  await adminPage.waitForFunction(() => /salle\s+live/i.test(document.querySelector("#liveStudioStatus")?.textContent || ""), null, { timeout: 20000 });

  const listed = await json(base, "/api/admin/live/sessions", {
    token: await adminPage.evaluate(() => sessionStorage.getItem("cardoria_session_token") || "")
  });
  const created = (listed.data.sessions || []).find((session) => session.title === liveTitle);
  assert.ok(created?.id, "Admin Live was not created");
  const liveId = created.id;
  const adminToken = await adminPage.evaluate(() => sessionStorage.getItem("cardoria_session_token") || "");
  if (created.status !== "live") {
    const started = await json(base, `/api/admin/live/sessions/${encodeURIComponent(liveId)}/start`, {
      method: "POST",
      body: {},
      token: adminToken
    });
    assert.equal(started.status, 200, "Admin could not start the Live");
  }
  const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
  const scheduledCreate = await json(base, "/api/admin/live/sessions", {
    method: "POST",
    body: { title: scheduledTitle, ownerRole: "admin", scheduledAt, products: [] },
    token: adminToken
  });
  assert.equal(scheduledCreate.status, 200, "Admin could not create a scheduled Live");
  const scheduledId = scheduledCreate.data.session?.id;
  assert.ok(scheduledId, "Scheduled Live id missing");
  const publicDetail = await json(base, `/api/live/sessions/${encodeURIComponent(liveId)}`);
  assert.equal(publicDetail.status, 200);
  assert.equal(publicDetail.data.session?.status, "live");
  const directory = await json(base, "/api/live/sessions?status=all");
  assert.ok((directory.data.sessions || []).some((session) => session.id === liveId && session.status === "live"), "Started Live missing from public directory");
  assert.ok((directory.data.sessions || []).some((session) => session.id === scheduledId && session.status === "scheduled"), "Scheduled Live missing from public directory");
  assert.equal((directory.data.sessions || []).find((session) => session.id === liveId)?.hostName, "Cardoria");

  const popupPromise = adminPage.waitForEvent("popup");
  await adminPage.click("#liveGoWatch");
  const spectatorFromAdmin = await popupPromise;
  await spectatorFromAdmin.waitForLoadState("domcontentloaded");
  assert.match(spectatorFromAdmin.url(), new RegExp(`[?&]session=${liveId}`));
  await spectatorFromAdmin.waitForSelector("#claChatDock", { timeout: 15000 });
  assert.equal(await spectatorFromAdmin.locator("#claChatDock").evaluate((el) => el.classList.contains("is-collapsed")), false, "Chat should open automatically on desktop");
  await spectatorFromAdmin.waitForSelector("#cardoriaLiveScheduledDirectory", { timeout: 15000 });
  await spectatorFromAdmin.waitForFunction((id) => {
    const selected = document.querySelector('[data-session-id][data-selected="true"]');
    return selected?.dataset.sessionId === id;
  }, liveId, { timeout: 20000 });
  const adminSpectatorHtml = await spectatorFromAdmin.content();
  assert.doesNotMatch(adminSpectatorHtml, /Mode Admin \/ Cardoria/);
  assert.equal(await spectatorFromAdmin.locator("#cardoriaLiveAdminBar").count(), 0);
  assert.equal(await spectatorFromAdmin.locator("#claName").count(), 0);
  assert.equal(await spectatorFromAdmin.locator('input[placeholder="Votre nom"]').count(), 0);
  const spectatorState = await spectatorFromAdmin.locator("#cardoriaLiveState").textContent();
  assert.doesNotMatch(spectatorState || "", /Aucune caméra disponible/);
  assert.match(
    `${await spectatorFromAdmin.locator("#cardoriaLiveStage").getAttribute("data-live")} ${spectatorState} ${await spectatorFromAdmin.locator(".live-offline").innerText()}`,
    /waiting|attente de diffusion|LIVE EN COURS/i
  );
  await spectatorFromAdmin.close();
  assertCleanBrowser(adminSignals, "admin");

  const anonContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const anonPage = await anonContext.newPage();
  const anonSignals = collectPageSignals(anonPage);
  await anonPage.goto(`${base}/live.html?session=${encodeURIComponent(liveId)}`, { waitUntil: "domcontentloaded" });
  await anonPage.waitForSelector("#claChatDock");
  assert.equal(await anonPage.locator("#claChatDock").evaluate((el) => el.classList.contains("is-collapsed")), false, "Chat should be visible immediately with ?session=");
  await anonPage.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"][data-selected="true"]`), liveId, { timeout: 20000 });
  await anonPage.waitForFunction((title) => (document.querySelector("#cardoriaLiveScheduledDirectory")?.innerText || "").includes(title), scheduledTitle, { timeout: 20000 });
  assert.match(await anonPage.locator("#cardoriaLiveNowWrap").innerText(), /Lives en cours/i);
  assert.match(await anonPage.locator("#cardoriaLiveScheduledWrap").innerText(), /Lives programmés/i);
  assert.match(await anonPage.locator(`[data-session-id="${liveId}"]`).innerText(), /Cardoria/);
  await anonPage.locator(`[data-session-id="${scheduledId}"]`).click();
  await anonPage.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"]`)?.dataset.selected === "true", scheduledId, { timeout: 10000 });
  await anonPage.locator(`[data-session-id="${liveId}"][data-live-open="true"]`).click();
  await anonPage.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"][data-live-open="true"][data-selected="true"]`), liveId, { timeout: 20000 });
  assert.equal(await anonPage.locator("#cardoriaLiveAdminBar").count(), 0);
  assert.equal(await anonPage.locator("#claName").count(), 0);
  assert.equal(await anonPage.evaluate(() => document.querySelector('script[src*="cardoria-live-admin-studio"]')), null);
  const waitingCopy = await anonPage.locator("#cardoriaLiveStage").innerText();
  const liveState = await anonPage.locator("#cardoriaLiveState").textContent();
  assert.doesNotMatch(`${waitingCopy} ${liveState}`, /Aucune caméra disponible|Impossible de rejoindre/);
  await anonPage.locator("#claSend").click({ force: true });
  await anonPage.waitForSelector("#claClientAuthModal iframe", { timeout: 10000 });
  const frame = anonPage.frameLocator("#claClientAuthModal iframe");
  await frame.locator("#clientRegisterName").waitFor({ timeout: 15000 });
  await frame.locator("#clientRegisterName").fill(clientName);
  await frame.locator("#clientRegisterEmail").fill(clientEmail);
  await frame.locator("#clientRegisterPassword").fill(clientPassword);
  await frame.locator("#clientRegisterForm button[type='submit']").click();
  await anonPage.waitForFunction((name) => (document.querySelector("#claChatIdentity")?.textContent || "").includes(name), clientName, { timeout: 20000 });
  await anonPage.fill("#claMessage", "Message depuis le compte Cardoria");
  await anonPage.press("#claMessage", "Enter");
  await anonPage.waitForFunction(() => document.querySelector("#claChat")?.innerText.includes("Message depuis le compte Cardoria"), null, { timeout: 15000 });
  const chatText = await anonPage.locator("#claChat").innerText();
  assert.match(chatText, new RegExp(clientName));
  assert.doesNotMatch(chatText, /Forged nickname/);

  const token = await anonPage.evaluate(() => localStorage.getItem("cardoria_session_token") || "");
  assert.ok(token, "Client session token missing after register");
  const forged = await json(base, `/api/live/actions/${encodeURIComponent(liveId)}/chat`, {
    method: "POST",
    token,
    body: { name: "Forged nickname", message: "Pseudo forge ignore" }
  });
  assert.equal(forged.status, 200);
  assert.equal(forged.data.message?.name, clientName);
  await anonPage.waitForFunction(() => document.querySelector("#claChat")?.innerText.includes("Pseudo forge ignore"), null, { timeout: 10000 });
  assert.doesNotMatch(await anonPage.locator("#claChat").innerText(), /Forged nickname/);

  const chatBox = await anonPage.locator("#claChatDock").boundingBox();
  const videoBox = await anonPage.locator("#cardoriaLiveStage").boundingBox();
  assert.ok(chatBox && chatBox.height > 80, "Desktop chat is not visible");
  assert.ok(videoBox && videoBox.height > 120, "Desktop video stage is missing");
  assert.ok(chatBox.x + 40 > videoBox.x + videoBox.width / 2, "Desktop chat should sit beside the Live");

  await anonPage.setViewportSize({ width: 390, height: 844 });
  const mobileChat = await anonPage.locator("#claChatDock").boundingBox();
  const mobileVideo = await anonPage.locator("#cardoriaLiveStage").boundingBox();
  assert.ok(mobileChat && mobileChat.width > 200 && mobileChat.height > 80, "Mobile chat is unusable");
  assert.ok(mobileVideo && mobileVideo.height > 80, "Mobile video stage collapsed");
  assert.ok(await anonPage.locator("#claMessage").isVisible(), "Mobile chat composer hidden");
  assertCleanBrowser(anonSignals, "anonymous/client");
  await anonContext.close();

  const landingContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const landingPage = await landingContext.newPage();
  const landingSignals = collectPageSignals(landingPage);
  await landingPage.goto(base + "/live.html", { waitUntil: "domcontentloaded" });
  await landingPage.waitForSelector("#claChatDock");
  await landingPage.waitForFunction(() => document.querySelector("#claChatDock")?.classList.contains("is-collapsed"), null, { timeout: 10000 });
  assert.ok(await landingPage.locator("#claChatOpen").isVisible(), "Mobile chat launcher hidden on arrival");
  await landingPage.locator("#claChatOpen").click();
  assert.ok(await landingPage.locator("#claMessage").isVisible(), "Mobile chat did not open from the launcher");
  await landingPage.waitForFunction((title) => (document.querySelector("#cardoriaLiveScheduledDirectory")?.innerText || "").includes(title), scheduledTitle, { timeout: 20000 });
  assertCleanBrowser(landingSignals, "mobile landing");
  await landingContext.close();
  await adminContext.close();
  console.log("LIVE_PUBLIC_JOURNEY_BROWSER_PASS " + liveId);
} finally {
  await browser.close().catch(() => {});
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!child.killed) child.kill("SIGKILL");
}
