import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Sendcloud OVH configuration is owner-only and never creates a shipment", () => {
  const workflow = readFileSync(".github/workflows/sendcloud-secure-configure.yml", "utf8");
  const opsRun = readFileSync(".github/workflows/ovh-ops-run.yml", "utf8");
  const ops = readFileSync("oracle/cardoria-ops.sh", "utf8");
  const wrapper = readFileSync("oracle/cardoria-ops-ssh-wrapper.sh", "utf8");
  const sudoers = readFileSync("oracle/sudoers-cardoria-ops", "utf8");

  assert.match(workflow, /github\.event\.issue\.user\.login == github\.repository_owner/);
  assert.match(workflow, /sendcloud-configure:/);
  assert.match(opsRun, /SENDCLOUD_PUBLIC_KEY/);
  assert.match(opsRun, /SENDCLOUD_SECRET_KEY/);
  assert.match(opsRun, /action: sendcloud-configure|sendcloud-configure/);
  assert.match(ops, /cmd_sendcloud_configure/);
  assert.match(ops, /searchMondialRelayServicePoints/);
  assert.match(ops, /sendcloud_api_test: success/);
  assert.match(ops, /CARDORIA_SENDER_NAME/);
  assert.match(ops, /CARDORIA_SENDER_ADDRESS_LINE1/);
  assert.match(ops, /CARDORIA_SENDER_POSTAL_CODE/);
  assert.match(ops, /CARDORIA_SENDER_CITY/);
  assert.match(ops, /CARDORIA_SENDER_PHONE/);
  assert.match(ops, /CARDORIA_SENDER_EMAIL/);
  assert.match(ops, /cardoria_sender: configured/);
  assert.match(ops, /CARDORIA_SENDER_ADDRESS_LINE1'[ ,]*'17 avenue Marcel Aime'|CARDORIA_SENDER_ADDRESS_LINE1.*17 avenue Marcel Aime/);
  assert.match(wrapper, /sendcloud-configure\)[\s\S]*cardoria-ops sendcloud-configure/);
  assert.match(sudoers, /cardoria-ops sendcloud-configure/);
  assert.doesNotMatch(ops, /createSendcloudShipment/);
  assert.doesNotMatch(ops, /shipments\/announce/);
});
