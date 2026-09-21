/**
 * Réinitialisation mot de passe par e-mail.
 */
import crypto from "crypto";
import { getDb } from "../engine/database.js";
import { hashToken, makeId, ADMIN_ROLES } from "./migrate.js";
import { getUserByEmail, getUserById, updatePassword } from "./users.js";
import { revokeAllUserSessions } from "./session.js";
import { notifySafely, publicSiteOrigin, sendEmail } from "../email.js";

const RESET_HOURS = Number(process.env.RESET_TOKEN_HOURS || 2);
const RESET_PUBLIC_ORIGIN = "https://www.cardoriashop.fr";

export async function requestPasswordReset(email) {
  const user = getUserByEmail(email);
  if (!user) return { ok: true, message: "Si le compte existe, un e-mail a été envoyé." };

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_HOURS * 3600000).toISOString();
  const db = getDb();

  db.prepare("DELETE FROM auth_reset_tokens WHERE user_id = ? AND used = 0").run(user.id);
  db.prepare(`
    INSERT INTO auth_reset_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(makeId("rst"), user.id, tokenHash, expiresAt, now.toISOString());

  const origin = publicSiteOrigin() || RESET_PUBLIC_ORIGIN;
  const resetPage = ADMIN_ROLES.includes(user.role) ? "admin-reset-password.html" : "reset-password.html";
  const link = `${origin}/${resetPage}?token=${encodeURIComponent(token)}`;

  const sent = await sendEmail({
    kind: "password_reset",
    to: user.email,
    subject: "Réinitialisez votre mot de passe Cardoria",
    text: `Bonjour,\n\nUne demande de réinitialisation de mot de passe a été faite pour votre compte Cardoria.\nCe lien est valable ${RESET_HOURS} h et ne peut être utilisé qu'une fois.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    actionUrl: link,
    actionLabel: "Choisir un nouveau mot de passe"
  });

  if (!sent) {
    db.prepare("DELETE FROM auth_reset_tokens WHERE token_hash = ?").run(tokenHash);
    return { ok: true, message: "Si le compte existe, un e-mail a été envoyé." };
  }

  return { ok: true, message: "Si le compte existe, un e-mail a été envoyé." };
}

export function confirmPasswordReset(token, newPassword) {
  if (!token || !newPassword || newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    throw Object.assign(new Error("Token ou mot de passe invalide."), { status: 400 });
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM auth_reset_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?
  `).get(hashToken(token), new Date().toISOString());

  if (!row) throw Object.assign(new Error("Lien expiré ou invalide."), { status: 400 });

  const consumed = db.prepare("UPDATE auth_reset_tokens SET used = 1 WHERE id = ? AND used = 0").run(row.id);
  if (consumed.changes !== 1) throw Object.assign(new Error("Lien expiré ou invalide."), { status: 400 });

  updatePassword(row.user_id, newPassword);
  revokeAllUserSessions(row.user_id);

  const user = getUserById(row.user_id);
  if (user?.email) {
    notifySafely(sendEmail({
      kind: "password_changed",
      to: user.email,
      subject: "Votre mot de passe Cardoria a été modifié",
      text: "Bonjour,\n\nLe mot de passe de votre compte Cardoria vient d'être modifié.\nSi vous n'êtes pas à l'origine de ce changement, contactez-nous immédiatement.",
      actionUrl: `${RESET_PUBLIC_ORIGIN}/client-login.html`,
      actionLabel: "Se connecter"
    }), "password_changed");
  }

  return { ok: true };
}
