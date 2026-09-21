import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("email sender supports a stable authenticated Cardoria domain identity", async () => {
  const previous = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    MAIL_FROM: process.env.MAIL_FROM,
    MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
    MAIL_REPLY_TO: process.env.MAIL_REPLY_TO,
    MAIL_DKIM_SELECTOR: process.env.MAIL_DKIM_SELECTOR
  };
  Object.assign(process.env, {
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "commandes@cardoriashop.fr",
    SMTP_PASS: "test-secret-not-real",
    MAIL_FROM: "commandes@cardoriashop.fr",
    MAIL_FROM_NAME: "Cardoria",
    MAIL_REPLY_TO: "commandes@cardoriashop.fr",
    MAIL_DKIM_SELECTOR: "selector1"
  });
  try {
    const { getEmailPublicStatus } = await import("../backend/lib/email.js");
    const status = getEmailPublicStatus();
    assert.equal(status.configured, true);
    assert.equal(status.from, "commandes@cardoriashop.fr");
    assert.equal(status.fromName, "Cardoria");
    assert.equal(status.replyTo, "commandes@cardoriashop.fr");
    assert.equal(status.fromDomain, "cardoriashop.fr");
    assert.equal(status.dkimSelector, "selector1");
    assert.equal(JSON.stringify(status).includes("test-secret-not-real"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("sendEmail uses display name and reply-to without exposing credentials", () => {
  const email = read("backend/lib/email.js");
  assert.match(email, /MAIL_FROM_NAME/);
  assert.match(email, /MAIL_REPLY_TO/);
  assert.match(email, /from: status\.fromName \? \{ name: status\.fromName, address: fromAddress \}/);
  assert.match(email, /replyTo: status\.replyTo \|\| undefined/);
  assert.doesNotMatch(email, /SMTP_PASS.*res\.json/s);
});

test("admin email status is protected and contains only public transport metadata", () => {
  const route = read("backend/routes/email-admin.js");
  assert.match(route, /router\.use\(requireAdmin\)/);
  assert.match(route, /router\.get\("\/status"/);
  assert.match(route, /getEmailPublicStatus\(\)/);
});

test("domain SMTP configuration is an allowlisted stdin-only OVH operation", () => {
  const dispatch = read(".github/workflows/ovh-ops.yml");
  const run = read(".github/workflows/ovh-ops-run.yml");
  const ops = read("oracle/cardoria-ops.sh");
  const wrapper = read("oracle/cardoria-ops-ssh-wrapper.sh");
  const sudoers = read("oracle/sudoers-cardoria-ops");

  assert.match(dispatch, /smtp-domain-configure/);
  assert.match(dispatch, /mail-dns-check/);
  assert.match(run, /OVH_CARDORIA_SMTP_PASS/);
  assert.match(run, /DOMAIN_SMTP_PASS/);
  assert.match(run, /\| ssh "\$\{ssh_args\[@\]\}"/);
  assert.doesNotMatch(run, /remote_cmd=.*DOMAIN_SMTP_PASS/);

  assert.match(ops, /cmd_smtp_domain_configure\(\)/);
  assert.match(ops, /mail_from: must use @cardoriashop\.fr/);
  assert.match(ops, /SMTP_DOMAIN_CONFIGURE|SMTP DOMAIN CONFIGURE/);
  assert.match(ops, /MAIL_FROM_NAME/);
  assert.match(ops, /MAIL_REPLY_TO/);
  assert.match(ops, /MAIL_DKIM_SELECTOR/);
  assert.match(ops, /cp "\$backup" "\$ENV_FILE"/);

  assert.match(wrapper, /cardoria-ops smtp-domain-configure/);
  assert.match(wrapper, /cardoria-ops mail-dns-check/);
  assert.match(sudoers, /cardoria-ops smtp-domain-configure/);
  assert.match(sudoers, /cardoria-ops mail-dns-check/);
});

test("mail DNS check requires MX SPF DMARC and DKIM", () => {
  const ops = read("oracle/cardoria-ops.sh");
  assert.match(ops, /node:dns\/promises/);
  assert.match(ops, /resolveMx/);
  assert.match(ops, /v=spf1/);
  assert.match(ops, /v=DMARC1/);
  assert.match(ops, /_domainkey/);
  assert.match(ops, /MAIL DNS CHECK OK/);
  assert.match(ops, /Boolean\(selector\) && dkim/);
});

test("production env examples document authenticated-domain mail variables without secrets", () => {
  const backendEnv = read("backend/.env.example");
  const oracleEnv = read("oracle/cardoria.env.example");
  for (const content of [backendEnv, oracleEnv]) {
    assert.match(content, /MAIL_FROM_NAME=Cardoria/);
    assert.match(content, /MAIL_REPLY_TO=/);
    assert.match(content, /MAIL_DKIM_SELECTOR=/);
  }
  const secretKey = "SMTP_" + "PASS=";
  assert.equal(backendEnv.split(/\r?\n/).find((line) => line.startsWith(secretKey)), secretKey);
  assert.equal(oracleEnv.split(/\r?\n/).find((line) => line.startsWith(secretKey)), secretKey);
});
