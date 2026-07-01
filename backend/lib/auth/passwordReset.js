/**
 * Réinitialisation mot de passe par e-mail.
 */
import crypto from "crypto";
import { getDb } from "../engine/database.js";
import { hashToken, makeId } from "./migrate.js";
import { getUserByEmail, updatePassword } from "./users.js";
import { revokeAllUserSessions } from "./session.js";
import { sendEmail } from "../email.js";

const RESET_HOURS = Number(process.env.RESET_TOKEN_HOURS || 2);

export async function requestPasswordReset(email) {
  const user = getUserByEmail(email);
  if (!user) return { ok: true, message: "Si le compte existe, un e-mail a été envoyé." };

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_HOURS * 3600000).toISOString();

  getDb().prepare(`
    INSERT INTO auth_reset_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(makeId("rst"), user.id, tokenHash, expiresAt, now.toISOString());

  const siteUrl = process.env.SITE_URL || "https://cardoria.fr";
  const link = `${siteUrl}/admin-reset-password.html?token=${token}`;

  await sendEmail({
    subject: "Cardoria — Réinitialisation de mot de passe",
    text: `Bonjour,\n\nCliquez sur le lien suivant pour réinitialiser votre mot de passe (valide ${RESET_HOURS}h) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nCardoria`
  });

  return { ok: true, message: "Si le compte existe, un e-mail a été envoyé." };
}

export function confirmPasswordReset(token, newPassword) {
  if (!token || !newPassword || newPassword.length < 8) {
    throw Object.assign(new Error("Token ou mot de passe invalide."), { status: 400 });
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM auth_reset_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?
  `).get(hashToken(token), new Date().toISOString());

  if (!row) throw Object.assign(new Error("Lien expiré ou invalide."), { status: 400 });

  updatePassword(row.user_id, newPassword);
  db.prepare("UPDATE auth_reset_tokens SET used = 1 WHERE id = ?").run(row.id);
  revokeAllUserSessions(row.user_id);

  return { ok: true };
}
