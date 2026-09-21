import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Colissimo OVH credentials use a fixed stdin-only secure bridge", () => {
  const dispatch = read(".github/workflows/ovh-ops.yml");
  const run = read(".github/workflows/ovh-ops-run.yml");
  const deploy = read("oracle/deploy.sh");
  const script = read("oracle/colissimo-configure.sh");
  const wrapper = read("oracle/cardoria-ops-ssh-wrapper.sh");
  const sudoers = read("oracle/sudoers-cardoria-ops");
  const example = read("oracle/cardoria.env.example");
  const lib = read("backend/lib/colissimo.js");

  assert.match(dispatch, /- colissimo-configure/);
  assert.match(run, /colissimo-configure\|mondial-relay-configure\) ;;/);
  assert.match(run, /COLISSIMO_API_KEY: \$\{\{ secrets\.OVH_COLISSIMO_API_KEY \}\}/);
  assert.match(run, /printf '%s' "\$COLISSIMO_API_KEY" \| ssh/);
  assert.match(run, /test -n "\$\{COLISSIMO_API_KEY:-\}"/);
  assert.doesNotMatch(run, /remote_cmd=.*COLISSIMO_API_KEY/);

  assert.match(script, /IFS= read -r api_key/);
  assert.match(script, /COLISSIMO_LIVE_LABELS_ENABLED=false/);
  assert.match(script, /install -m 0600 -o root -g root/);
  assert.match(script, /\/api\/colissimo\/status/);
  assert.match(script, /labelPurchasesEnabled !== false/);
  assert.match(script, /colissimo_configure: rollback/);
  assert.doesNotMatch(script, /generateLabel/);
  assert.doesNotMatch(script, /echo.*\$api_key/);

  assert.match(deploy, /colissimo-configure\.sh.*\/usr\/local\/bin\/cardoria-colissimo-configure/);
  assert.match(wrapper, /colissimo-configure\)/);
  assert.match(wrapper, /sudo -n \/usr\/local\/bin\/cardoria-colissimo-configure/);
  assert.match(sudoers, /\/usr\/local\/bin\/cardoria-colissimo-configure/);

  assert.match(example, /COLISSIMO_LIVE_LABELS_ENABLED=false/);
  assert.match(lib, /colissimoLabelPurchasesEnabled/);
  assert.match(lib, /COLISSIMO_LABELS_NOT_ACTIVATED/);
});

test("Colissimo label creation stays gated and does not replace Mondial Relay", () => {
  const live = read("backend/lib/live/shipments.js");
  const admin = read("backend/routes/payments-admin.js");
  assert.match(live, /mondialRelayLabelPurchasesEnabled/);
  assert.match(live, /MONDIAL_RELAY_LABELS_NOT_ACTIVATED/);
  assert.match(admin, /Mondial Relay/);
  assert.match(admin, /createColissimoLabel/);
  assert.doesNotMatch(live, /createColissimoLabel/);
});
