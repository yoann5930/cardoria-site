import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const backup = fs.readFileSync("oracle/backup.sh", "utf8");
const ops = fs.readFileSync("oracle/cardoria-ops.sh", "utf8");

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
