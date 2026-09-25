import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Sendcloud OVH configuration is owner-only and never creates a shipment", () => {
  const workflow = readFileSync(".github/workflows/sendcloud-secure-configure.yml", "utf8");
  const opsRun = readFileSync(".github/workflows/ovh-ops-run.yml", "utf8");
  const ops = readFileSync("oracle/cardoria-ops.sh", "utf8");

  assert.match(workflow, /github\.event\.issue\.user\.login == github\.repository_owner/);
  assert.match(workflow, /sendcloud-configure:/);
  assert.match(opsRun, /SENDCLOUD_PUBLIC_KEY/);
  assert.match(opsRun, /SENDCLOUD_SECRET_KEY/);
  assert.match(opsRun, /action: sendcloud-configure|sendcloud-configure/);
  assert.match(ops, /cmd_sendcloud_configure/);
  assert.match(ops, /searchMondialRelayServicePoints/);
  assert.match(ops, /sendcloud_api_test: success/);
  assert.doesNotMatch(ops, /createSendcloudShipment/);
  assert.doesNotMatch(ops, /shipments\/announce/);
});
