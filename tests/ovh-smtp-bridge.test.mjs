import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("SMTP OVH remains a fixed allowlisted stdin-only operation", () => {
  const dispatch = read(".github/workflows/ovh-ops.yml");
  const run = read(".github/workflows/ovh-ops-run.yml");
  const ops = read("oracle/cardoria-ops.sh");
  const wrapper = read("oracle/cardoria-ops-ssh-wrapper.sh");
  const sudoers = read("oracle/sudoers-cardoria-ops");

  assert.match(run, /(?:^|\|)smtp-configure(?:\||\) ;;)/m);
  assert.match(run, /SMTP_PASS: \$\{\{ secrets\.OVH_SMTP_PASS \}\}/);
  assert.match(run, /printf '%s' "\$SMTP_PASS" \| ssh/);
  assert.doesNotMatch(run, /remote_cmd=.*SMTP_PASS/);
  assert.match(ops, /SMTP_HOST=smtp\.gmail\.com/);
  assert.match(ops, /SMTP_USER=Cardoria59330@gmail\.com/);
  assert.match(ops, /install -m 0600 -o root -g root/);
  assert.match(wrapper, /cardoria-ops smtp-configure/);
  assert.match(sudoers, /\/usr\/local\/bin\/cardoria-ops smtp-configure/);
  assert.match(dispatch, /uses: \.\/\.github\/workflows\/ovh-ops-run\.yml/);
});


test("admin password reset uses a fixed owner-only OVH operation", () => {
  const run = read(".github/workflows/ovh-ops-run.yml");
  const dispatch = read(".github/workflows/ovh-ops.yml");
  const issue = read(".github/workflows/ovh-admin-password-reset-issue.yml");
  const ops = read("oracle/cardoria-ops.sh");
  const wrapper = read("oracle/cardoria-ops-ssh-wrapper.sh");
  const sudoers = read("oracle/sudoers-cardoria-ops");

  assert.match(run, /admin-password-reset-request/);
  assert.match(dispatch, /admin-password-reset-request/);
  assert.match(issue, /github\.event\.issue\.user\.login == github\.repository_owner/);
  assert.match(issue, /startsWith\(github\.event\.issue\.title, 'ovh-admin-reset:'\)/);
  assert.match(issue, /action: admin-password-reset-request/);
  assert.match(ops, /requestPasswordReset\(email\)/);
  assert.match(ops, /process\.env\.ADMIN_EMAIL/);
  assert.doesNotMatch(issue, /inputs:/);
  assert.match(wrapper, /cardoria-ops admin-password-reset-request/);
  assert.match(sudoers, /cardoria-ops admin-password-reset-request/);
});
