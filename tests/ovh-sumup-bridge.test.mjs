import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("SumUp OVH uses API key + merchant code and validates the running process without leaking secrets", () => {
  const dispatch = read(".github/workflows/ovh-ops.yml");
  const run = read(".github/workflows/ovh-ops-run.yml");
  const deploy = read("oracle/deploy.sh");
  const script = read("oracle/sumup-configure.sh");
  const wrapper = read("oracle/cardoria-ops-ssh-wrapper.sh");
  const sudoers = read("oracle/sudoers-cardoria-ops");
  const payments = read("backend/routes/payments.js");
  const sumup = read("backend/lib/payments/sumup.js");

  assert.match(dispatch, /- sumup-configure/);
  assert.match(run, /sumup-configure\) ;;/);
  assert.match(run, /SUMUP_API_KEY: \$\{\{ secrets\.OVH_SUMUP_API_KEY \}\}/);
  assert.match(run, /SUMUP_MERCHANT_CODE: \$\{\{ secrets\.OVH_SUMUP_MERCHANT_CODE \}\}/);
  assert.doesNotMatch(run, /OVH_SUMUP_WEBHOOK_SECRET/);
  assert.match(run, /printf '%s\\n%s\\n' "\$SUMUP_API_KEY" "\$SUMUP_MERCHANT_CODE" \| ssh/);
  assert.doesNotMatch(run, /remote_cmd=.*SUMUP_/);

  assert.match(script, /IFS= read -r api_key/);
  assert.match(script, /IFS= read -r merchant_code/);
  assert.doesNotMatch(script, /read -r webhook_secret/);
  assert.match(script, /api\.sumup\.com\/v1\/merchants\/\$\{merchant_code\}/);
  assert.match(script, /install -m 0600 -o root -g root/);
  assert.match(script, /systemctl show cardoria --property=MainPID --value/);
  assert.match(script, /\/proc\/\$\{main_pid\}\/environ/);
  assert.match(script, /grep -q '\^SUMUP_API_KEY=\.'/);
  assert.match(script, /grep -q '\^SUMUP_MERCHANT_CODE=\.'/);
  assert.match(script, /isSumUpConfigured/);
  assert.match(script, /sumup_process_env: ok/);
  assert.match(script, /sumup_env_module_validation: ok/);
  assert.match(script, /sumup_configure: rollback/);
  assert.doesNotMatch(script, /echo.*\$api_key/);
  assert.doesNotMatch(script, /echo.*\$merchant_code/);
  assert.doesNotMatch(script, /\/api\/payments\/status/);

  assert.match(payments, /webhookMode: "api-verification"/);
  assert.doesNotMatch(payments, /X-SumUp-Signature/);
  assert.match(sumup, /syncPaymentFromCheckout\(checkoutId\)/);
  assert.match(sumup, /verifiedViaApi:true/);
  assert.doesNotMatch(sumup, /SUMUP_WEBHOOK_SECRET obligatoire/);

  assert.match(deploy, /install -m 0755 -o root -g root .*sumup-configure\.sh.*\/usr\/local\/bin\/cardoria-sumup-configure/);
  assert.match(wrapper, /sumup-configure\)/);
  assert.match(wrapper, /sudo -n \/usr\/local\/bin\/cardoria-sumup-configure/);
  assert.match(sudoers, /\/usr\/local\/bin\/cardoria-sumup-configure/);
});
