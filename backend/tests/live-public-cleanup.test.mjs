import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../routes/live.js", import.meta.url), "utf8");
const ranking = fs.readFileSync(new URL("../lib/live/public-directory.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../../live.html", import.meta.url), "utf8");
const viewer = fs.readFileSync(new URL("../../js/cardoria-live-viewer.js", import.meta.url), "utf8");
const mirror = fs.readFileSync(new URL("../../backend/public/js/cardoria-live-viewer.js", import.meta.url), "utf8");

test("public Live session listing is hard-filtered to live and scheduled sessions", () => {
  assert.match(route, /listLiveSessions\(\{status:"live"\}\)/);
  assert.match(route, /listLiveSessions\(\{status:"scheduled"\}\)/);
  assert.match(route, /hostName: publicHostName\(session\)/);
  assert.match(route, /planId: plan.planId/);
  assert.match(route, /requestedLiveCategory/);
  assert.match(ranking, /planId === "elite"/);
  assert.match(ranking, /viewerCount/);
  assert.match(page, /cardoriaLiveCategoryFilter/);
  assert.match(page, /data-live-directory-only/);
  assert.match(page, /data-live-room-only/);
  assert.match(viewer, /location\.assign\(`\/live\.html\?session=/);
  assert.doesNotMatch(route, /status === "all" \? undefined/);
});

test("public sales UI cannot expose cancelled sessions even if it asks for all", () => {
  assert.match(viewer, /\/api\/live\/sessions\?status=all/);
  assert.match(viewer, /renderScheduledDirectory/);
  assert.match(viewer, /cardoriaLiveCategoryFilter/);
  assert.match(viewer, /is-featured/);
  assert.match(viewer, /const roomMode = Boolean\(focusLiveId\)/);
  assert.equal(viewer, mirror, "runtime viewer mirror must stay synchronized");
});
