import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Mondial Relay OVH credentials use a fixed stdin-only secure bridge", () => {
  const dispatch = read(".github/workflows/ovh-ops.yml");
  const run = read(".github/workflows/ovh-ops-run.yml");
  const deploy = read("oracle/deploy.sh");
  const script = read("oracle/mondial-relay-configure.sh");
  const wrapper = read("oracle/cardoria-ops-ssh-wrapper.sh");
  const sudoers = read("oracle/sudoers-cardoria-ops");
  const example = read("oracle/cardoria.env.example");

  assert.match(dispatch, /- mondial-relay-configure/);
  assert.match(run, /mondial-relay-configure\) ;;/);
  assert.match(run, /MR_ENSEIGNE: \$\{\{ secrets\.OVH_MONDIAL_RELAY_ENSEIGNE \}\}/);
  assert.match(run, /MR_PRIVATE_KEY: \$\{\{ secrets\.OVH_MONDIAL_RELAY_PRIVATE_KEY \}\}/);
  assert.match(run, /MR_API_V2_LOGIN: \$\{\{ secrets\.OVH_MONDIAL_RELAY_API_V2_LOGIN \}\}/);
  assert.match(run, /MR_API_V2_PASSWORD: \$\{\{ secrets\.OVH_MONDIAL_RELAY_API_V2_PASSWORD \}\}/);
  assert.match(run, /MR_API_V2_CUSTOMER_ID: \$\{\{ secrets\.OVH_MONDIAL_RELAY_API_V2_CUSTOMER_ID \}\}/);
  assert.match(run, /printf '%s\\n%s\\n%s\\n%s\\n%s\\n'/);
  assert.match(run, /test -n "\$\{MR_ENSEIGNE:-\}"/);
  assert.match(run, /test -n "\$\{MR_PRIVATE_KEY:-\}"/);
  assert.doesNotMatch(run, /test -n "\$\{MR_API_V2_LOGIN:-\}"/);
  assert.doesNotMatch(run, /remote_cmd=.*MR_/);

  assert.match(script, /IFS= read -r enseigne/);
  assert.match(script, /IFS= read -r private_key/);
  assert.match(script, /MONDIAL_RELAY_API_V2_ENV=sandbox/);
  assert.match(script, /MONDIAL_RELAY_LIVE_LABELS_ENABLED=false/);
  assert.match(script, /install -m 0600 -o root -g root/);
  assert.match(script, /servicePointSearchConfigured/);
  assert.match(script, /shipmentApiConfigured/);
  assert.match(script, /labelPurchasesEnabled/);
  assert.match(script, /mondial_relay_shipment_api: skipped/);
  assert.match(script, /mondial_relay_configure: rollback/);
  assert.doesNotMatch(script, /echo.*\$enseigne/);
  assert.doesNotMatch(script, /echo.*\$private_key/);
  assert.doesNotMatch(script, /echo.*\$api_password/);

  assert.match(deploy, /mondial-relay-configure\.sh.*\/usr\/local\/bin\/cardoria-mondial-relay-configure/);
  assert.match(wrapper, /mondial-relay-configure\)/);
  assert.match(wrapper, /sudo -n \/usr\/local\/bin\/cardoria-mondial-relay-configure/);
  assert.match(sudoers, /\/usr\/local\/bin\/cardoria-mondial-relay-configure/);

  assert.match(example, /MONDIAL_RELAY_API_V2_ENV=sandbox/);
  assert.match(example, /MONDIAL_RELAY_LIVE_LABELS_ENABLED=false/);
});
