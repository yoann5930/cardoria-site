import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateAuth } from "../lib/auth/migrate.js";
import { createUser, authenticateUser } from "../lib/auth/users.js";
import { confirmPasswordReset, requestPasswordReset } from "../lib/auth/passwordReset.js";

function readOutbox(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("password reset sends a canonical HTTPS mail, confirms once, then rejects the used token", async () => {
  process.env.NODE_ENV = "test";
  const outbox = path.join(os.tmpdir(), `cardoria-reset-${Date.now()}.json`);
  process.env.CARDORIA_TEST_EMAIL_OUTBOX = outbox;
  migrateAuth();
  const email = `reset-${Date.now()}@cardoria.invalid`;
  createUser({ email, password: "Ancien-MotDePasse-123", role: "client", name: "Reset Test" });

  const unknown = await requestPasswordReset("inconnu@cardoria.invalid");
  assert.equal(unknown.ok, true);
  assert.equal(fs.existsSync(outbox), false);

  const requested = await requestPasswordReset(email);
  assert.equal(requested.ok, true);
  const mail = readOutbox(outbox);
  assert.equal(mail.kind, "password_reset");
  assert.match(mail.actionUrl, /^https:\/\/www\.cardoriashop\.fr\/reset-password\.html\?token=/);
  assert.doesNotMatch(JSON.stringify(mail), /localhost|127\.0\.0\.1|onrender|vercel/);
  const token = new URL(mail.actionUrl).searchParams.get("token");
  assert.match(token, /^[a-f0-9]{64}$/);

  const confirmed = confirmPasswordReset(token, "Nouveau-MotDePasse-456");
  assert.equal(confirmed.ok, true);
  assert.equal(authenticateUser(email, "Nouveau-MotDePasse-456")?.email, email);
  assert.equal(authenticateUser(email, "Ancien-MotDePasse-123"), null);

  assert.throws(() => confirmPasswordReset(token, "Autre-MotDePasse-789"), (error) => error.status === 400);
  fs.rmSync(outbox, { force: true });
  delete process.env.CARDORIA_TEST_EMAIL_OUTBOX;
});
