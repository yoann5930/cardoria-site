import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const backup = fs.readFileSync("oracle/backup.sh", "utf8");
const ops = fs.readFileSync("oracle/cardoria-ops.sh", "utf8");
const wrapper = fs.readFileSync("oracle/cardoria-ops-ssh-wrapper.sh", "utf8");
const sudoers = fs.readFileSync("oracle/sudoers-cardoria-ops", "utf8");
const opsRun = fs.readFileSync(".github/workflows/ovh-ops-run.yml", "utf8");
const pruneWorkflow = fs.readFileSync(".github/workflows/ovh-backup-prune-issue.yml", "utf8");

test("backup artifacts are validated in staging before publication", () => {
  assert.match(backup, /POSTGRES_STAGE="\$STAGING_DIR\/cardoria-postgres-\$STAMP\.dump"/);
  assert.match(backup, /DATA_STAGE="\$STAGING_DIR\/cardoria-data-\$STAMP\.tar\.gz"/);
  assert.match(backup, /pg_restore -l "\$POSTGRES_STAGE"/);
  assert.match(backup, /tar -tzf "\$DATA_STAGE"/);
  const validatePg = backup.indexOf('pg_restore -l "$POSTGRES_STAGE"');
  const publishPg = backup.indexOf('mv "$POSTGRES_STAGE" "$POSTGRES_FINAL"');
  const validateTar = backup.indexOf('tar -tzf "$DATA_STAGE"');
  const publishTar = backup.indexOf('mv "$DATA_STAGE" "$DATA_FINAL"');
  assert.ok(validatePg >= 0 && publishPg > validatePg);
  assert.ok(validateTar >= 0 && publishTar > validateTar);
});

test("OVH backup wrapper propagates backup script failures", () => {
  assert.match(ops, /if \[ "\$rc" -ne 0 \]; then/);
  assert.match(ops, /BACKUP SCRIPT FAILED/);
  assert.match(ops, /return "\$rc"/);
  assert.match(ops, /pg_restore -l "\$dump"/);
  assert.match(ops, /tar -tzf "\$tarfile"/);
});

test("external data archive excludes nested local backup history", () => {
  assert.match(backup, /dirs\[:\] = \[name for name in dirs if name != 'backups'\]/);
  assert.match(ops, /du -sh "\$APP_DIR\/backend\/data\/backups"/);
  assert.match(ops, /du -sh "\$BACKUP_DIR"/);
});

test("backup pruning is exposed only through the forced-command allowlist", () => {
  assert.match(ops, /backup-prune/);
  assert.match(ops, /python3 "\$APP_DIR\/oracle\/prune-backups\.py" "\$BACKUP_DIR"/);
  assert.match(wrapper, /backup-prune\)\s+exec sudo -n \/usr\/local\/bin\/cardoria-ops backup-prune/s);
  assert.match(sudoers, /NOPASSWD: \/usr\/local\/bin\/cardoria-ops backup-prune/);
  assert.match(opsRun, /backup\|backup-prune\|nginx-test/);
});

test("backup prune issue never opens an arbitrary SSH command path", () => {
  assert.match(pruneWorkflow, /action: backup-prune/);
  assert.match(pruneWorkflow, /uses: \.\/\.github\/workflows\/ovh-ops-run\.yml/);
  assert.doesNotMatch(pruneWorkflow, /sudo python3 -/);
  assert.doesNotMatch(pruneWorkflow, /ssh -i/);
});
