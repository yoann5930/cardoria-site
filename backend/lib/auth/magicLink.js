/**
 * Connexion admin sans mot de passe : lien magique a usage unique envoye par e-mail.
 */
import crypto from "crypto";
import { getDb } from "../engine/database.js";
import { hashToken, makeId, ADMIN_ROLES } from "./migrate.js";
import { getUserByEmail, getUserById } from "./users.js";
import { publicSiteOrigin, sendEmail } from "../email.js";

const MAGIC_LINK_MINUTES = Math.max(5, Math.min(60, Number(process.env.MAGIC_LINK_MINUTES || 15)));

export async function requestMagicLogin(email) {
  const user = getUserByEmail(email);

  // Reponse neutre pour ne pas reveler l'existence d'un compte.
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    return { ok: true, message: "Si cette adresse est autorisee, un lien de connexion a ete envoye." };
  }

  const db = getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_MINUTES * 60_000).toISOString();

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM auth_magic_tokens WHERE user_id = ? OR expires_at <= ?")
      .run(user.id, now.toISOString());
    db.prepare(`
      INSERT INTO auth_magic_tokens (id, user_id, token_hash, expires_at, used, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(makeId("magic"), user.id, tokenHash, expiresAt, now.toISOString());
  });
  tx();

  const link = `${publicSiteOrigin()}/admin-email-login.html?token=${encodeURIComponent(token)}`;

  let sent = false;
  try {
    sent = await sendEmail({
      kind: "magic_login",
      to: user.email,
      subject: "Connexion administrateur Cardoria",
      text: `Bonjour,\n\nVoici votre lien de connexion sécurisé au back-office Cardoria.\nIl est valable ${MAGIC_LINK_MINUTES} minutes et ne peut être utilisé qu'une fois.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
      actionUrl: link,
      actionLabel: "Ouvrir le back-office"
    });
  } catch {
    sent = false;
  }

  if (!sent) {
    db.prepare("DELETE FROM auth_magic_tokens WHERE token_hash = ?").run(tokenHash);
    return { ok: true, message: "Si cette adresse est autorisee, un lien de connexion a ete envoye." };
  }

  return { ok: true, message: "Lien de connexion envoye. Consultez votre boite e-mail." };
}

export function consumeMagicLogin(token) {
  if (!token || typeof token !== "string" || token.length < 20 || token.length > 256) {
    throw Object.assign(new Error("Lien de connexion invalide."), { status: 400 });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const row = db.prepare(`
    SELECT id, user_id
    FROM auth_magic_tokens
    WHERE token_hash = ? AND used = 0 AND expires_at > ?
  `).get(hashToken(token), now);

  if (!row) {
    throw Object.assign(new Error("Lien de connexion expire ou deja utilise."), { status: 400 });
  }

  const user = getUserById(row.user_id);
  if (!user || !user.active || !ADMIN_ROLES.includes(user.role)) {
    throw Object.assign(new Error("Compte administrateur indisponible."), { status: 403 });
  }

  const result = db.prepare("UPDATE auth_magic_tokens SET used = 1 WHERE id = ? AND used = 0").run(row.id);
  if (result.changes !== 1) {
    throw Object.assign(new Error("Lien de connexion deja utilise."), { status: 400 });
  }

  return user;
}
