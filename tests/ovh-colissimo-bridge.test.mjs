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
  const backendExample = read("backend/.env.example");
  const boutique = read("js/boutique.js");
  const checkout = read("backend/lib/boutique/checkout.js");
  const sumup = read("backend/lib/payments/sumup.js");

  assert.match(dispatch, /- colissimo-configure/);
  assert.match(run, /colissimo-configure\) ;;/);
  assert.match(run, /COLISSIMO_CONTRACT: \$\{\{ secrets\.OVH_COLISSIMO_CONTRACT_NUMBER \}\}/);
  assert.match(run, /COLISSIMO_PASSWORD: \$\{\{ secrets\.OVH_COLISSIMO_PASSWORD \}\}/);
  assert.match(run, /printf '%s\\n%s\\n'/);
  assert.match(run, /test -n "\$\{COLISSIMO_CONTRACT:-\}"/);
  assert.match(run, /test -n "\$\{COLISSIMO_PASSWORD:-\}"/);
  assert.doesNotMatch(run, /remote_cmd=.*COLISSIMO_/);

  assert.match(script, /IFS= read -r contract_number/);
  assert.match(script, /IFS= read -r password/);
  assert.match(script, /COLISSIMO_LABELS_ENABLED=false/);
  assert.match(script, /install -m 0600 -o root -g root/);
  assert.match(script, /labelPurchasesEnabled/);
  assert.match(script, /colissimo_configure: rollback/);
  assert.doesNotMatch(script, /echo.*\$contract_number/);
  assert.doesNotMatch(script, /echo.*\$password/);

  assert.match(deploy, /colissimo-configure\.sh.*\/usr\/local\/bin\/cardoria-colissimo-configure/);
  assert.match(wrapper, /colissimo-configure\)/);
  assert.match(wrapper, /sudo -n \/usr\/local\/bin\/cardoria-colissimo-configure/);
  assert.match(sudoers, /\/usr\/local\/bin\/cardoria-colissimo-configure/);
  assert.match(example, /COLISSIMO_LABELS_ENABLED=false/);
  assert.match(backendExample, /COLISSIMO_LABELS_ENABLED=false/);
  assert.match(backendExample, /COLISSIMO_CONTRACT_NUMBER=/);
  assert.doesNotMatch(boutique, /\/api\/sendcloud/);
  assert.match(boutique, /shopCarrier/);
  assert.match(checkout, /selectedCarrier/);
  assert.match(sumup, /attachColissimoLabelAfterPayment/);
});
