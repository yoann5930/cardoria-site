import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("SumUp OVH remains an allowlisted stdin-only secret operation", () => {
  const dispatch = read(".github/workflows/ovh-ops.yml");
  const run = read(".github/workflows/ovh-ops-run.yml");
  const deploy = read("oracle/deploy.sh");
  const script = read("oracle/sumup-configure.sh");
  const wrapper = read("oracle/cardoria-ops-ssh-wrapper.sh");
  const sudoers = read("oracle/sudoers-cardoria-ops");

  assert.match(dispatch, /- sumup-configure/);
  assert.match(run, /sumup-configure\) ;;/);
  assert.match(run, /SUMUP_API_KEY: \$\{\{ secrets\.OVH_SUMUP_API_KEY \}\}/);
  assert.match(run, /SUMUP_MERCHANT_CODE: \$\{\{ secrets\.OVH_SUMUP_MERCHANT_CODE \}\}/);
  assert.match(run, /SUMUP_WEBHOOK_SECRET: \$\{\{ secrets\.OVH_SUMUP_WEBHOOK_SECRET \}\}/);
  assert.match(run, /printf '%s\\n%s\\n%s\\n' "\$SUMUP_API_KEY" "\$SUMUP_MERCHANT_CODE" "\$SUMUP_WEBHOOK_SECRET" \| ssh/);
  assert.doesNotMatch(run, /remote_cmd=.*SUMUP_/);

  assert.match(script, /IFS= read -r api_key/);
  assert.match(script, /IFS= read -r merchant_code/);
  assert.match(script, /IFS= read -r webhook_secret/);
  assert.match(script, /api\.sumup\.com\/v1\/merchants\/\$\{merchant_code\}/);
  assert.match(script, /install -m 0600 -o root -g root/);
  assert.match(script, /SUMUP_API_KEY/);
  assert.match(script, /SUMUP_MERCHANT_CODE/);
  assert.match(script, /SUMUP_WEBHOOK_SECRET/);
  assert.match(script, /configured!==true/);
  assert.match(script, /webhookConfigured!==true/);
  assert.match(script, /sumup_configure: rollback/);

  assert.match(deploy, /install -m 0755 -o root -g root .*sumup-configure\.sh.*\/usr\/local\/bin\/cardoria-sumup-configure/);
  assert.match(wrapper, /sumup-configure\)/);
  assert.match(wrapper, /sudo -n \/usr\/local\/bin\/cardoria-sumup-configure/);
  assert.match(sudoers, /\/usr\/local\/bin\/cardoria-sumup-configure/);
});
