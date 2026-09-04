import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("SMTP OVH remains a fixed allowlisted stdin-only operation", () => {
  const issue = read(".github/workflows/ovh-ops-issue.yml");
  const run = read(".github/workflows/ovh-ops-run.yml");
  const ops = read("oracle/cardoria-ops.sh");
  const wrapper = read("oracle/cardoria-ops-ssh-wrapper.sh");
  const sudoers = read("oracle/sudoers-cardoria-ops");

  assert.match(issue, /'ovh-ops:smtp-configure': 'smtp-configure'/);
  assert.match(run, /SMTP_PASS: \$\{\{ secrets\.OVH_SMTP_PASS \}\}/);
  assert.match(run, /printf '%s' "\$SMTP_PASS" \| ssh/);
  assert.doesNotMatch(run, /remote_cmd=.*SMTP_PASS/);
  assert.match(ops, /SMTP_HOST=smtp\.gmail\.com/);
  assert.match(ops, /SMTP_USER=Cardoria59330@gmail\.com/);
  assert.match(ops, /install -m 0600 -o root -g root/);
  assert.match(wrapper, /cardoria-ops smtp-configure/);
  assert.match(sudoers, /\/usr\/local\/bin\/cardoria-ops smtp-configure/);
});
