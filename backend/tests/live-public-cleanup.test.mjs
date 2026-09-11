import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../routes/live.js", import.meta.url), "utf8");
const viewer = fs.readFileSync(new URL("../../js/cardoria-live-viewer.js", import.meta.url), "utf8");
const mirror = fs.readFileSync(new URL("../../backend/public/js/cardoria-live-viewer.js", import.meta.url), "utf8");

test("public Live session listing is hard-filtered to active live sessions", () => {
  assert.match(route, /listLiveSessions\(\{ status: "live" \}\)/);
  assert.doesNotMatch(route, /status === "all" \? undefined/);
});

test("public sales UI cannot expose cancelled sessions even if it asks for all", () => {
  assert.match(viewer, /\/api\/live\/sessions\?status=all/);
  assert.equal(viewer, mirror, "runtime viewer mirror must stay synchronized");
});
