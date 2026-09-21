import test from "node:test";
import assert from "node:assert/strict";
import { publicSiteOrigin } from "../lib/email.js";
import { renderCardoriaEmail } from "../lib/email-templates.js";
import fs from "node:fs";

test("public site origin never leaks localhost, Render or Vercel into customer mail", () => {
  const previous = {
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
    SITE_URL: process.env.SITE_URL,
    FRONTEND_URL: process.env.FRONTEND_URL
  };
  try {
    process.env.SITE_URL = "http://127.0.0.1:10000";
    process.env.FRONTEND_URL = "https://cardoria-site-2.onrender.com";
    process.env.PUBLIC_SITE_URL = "";
    assert.equal(publicSiteOrigin(), "https://www.cardoriashop.fr");
    process.env.SITE_URL = "https://cardoriashop.fr";
    assert.equal(publicSiteOrigin(), "https://www.cardoriashop.fr");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Cardoria email template is branded and has a visible action plus fallback URL", () => {
  const rendered = renderCardoriaEmail({
    title: "Réinitialisez votre mot de passe Cardoria",
    bodyText: "Un lien sécurisé vous a été envoyé.",
    actionUrl: "https://www.cardoriashop.fr/reset-password.html?token=abc",
    actionLabel: "Choisir un nouveau mot de passe",
    details: [{ label: "Commande", value: "CMD-1" }]
  });
  assert.match(rendered.html, /CARDORIA/);
  assert.match(rendered.html, /Choisir un nouveau mot de passe/);
  assert.match(rendered.html, /Si le bouton ne fonctionne pas/);
  assert.match(rendered.html, /www\.cardoriashop\.fr\/reset-password\.html\?token=abc/);
  assert.doesNotMatch(rendered.html + rendered.text, /localhost|127\.0\.0\.1|onrender\.com|vercel\.app/);
});

test("SMTP helper never writes secrets into source logs", () => {
  const source = fs.readFileSync(new URL("../lib/email.js", import.meta.url), "utf8");
  assert.match(source, /connectionTimeout: 8000/);
  assert.match(source, /\[redacted\]/);
  assert.match(source, /from: status\.fromName \? \{ name: status\.fromName, address: fromAddress \}/);
  assert.match(source, /replyTo: status\.replyTo \|\| undefined/);
});
