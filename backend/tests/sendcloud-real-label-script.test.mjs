import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/sendcloud-real-label-test.mjs");

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SENDCLOUD_PUBLIC_KEY: "fake-test-public",
      SENDCLOUD_SECRET_KEY: "fake-test-secret",
      SENDCLOUD_TEST_MOBILE: "0600000000",
      SENDCLOUD_LIVE_LABELS_ENABLED: "false",
      ...extraEnv
    }
  });
}

function parseReport(stdout) {
  const text = String(stdout || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, "script did not print a JSON report");
  return JSON.parse(text.slice(start, end + 1));
}

test("real Mondial Relay label script refuses to run without the explicit allow flag", () => {
  const result = run();
  assert.notEqual(result.status, 0);
  const body = parseReport(result.stdout);
  assert.equal(body.status, "blocked");
  assert.equal(body.reason, "SENDCLOUD_ALLOW_REAL_TEST_LABEL_REQUIRED");
  assert.equal(body.realLabelCreated, false);
  assert.doesNotMatch(result.stdout + result.stderr, /READY_TO_CREATE_ONE_REAL_TEST_LABEL/);
});

test("production live-label flag does not bypass the isolated allow flag", () => {
  const result = run({ SENDCLOUD_LIVE_LABELS_ENABLED: "true" });
  const body = parseReport(result.stdout);
  assert.equal(body.reason, "SENDCLOUD_ALLOW_REAL_TEST_LABEL_REQUIRED");
  assert.equal(body.productionLabelsFlag, true);
  assert.equal(body.realLabelCreated, false);
});
