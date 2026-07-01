/**
 * Sessions sécurisées — tokens opaques stockés hashés en base.
 */
import crypto from "crypto";
import { getDb } from "../engine/database.js";
import { hashToken, makeId } from "./migrate.js";

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);

export function createSession(userId, { ip = "", userAgent = "" } = {}) {
  const db = getDb();
  const token = crypto.randomBytes(48).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600000).toISOString();
  const id = makeId("sess");

  db.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, ip, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, tokenHash, expiresAt, ip, userAgent.slice(0, 255), now.toISOString());

  db.prepare("UPDATE auth_users SET last_login_at = ? WHERE id = ?").run(now.toISOString(), userId);

  return { token, expiresAt, sessionId: id };
}

export function validateSession(token) {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT s.id AS sessionId, s.expires_at, u.id, u.email, u.role, u.name, u.totp_enabled, u.active
    FROM auth_sessions s
    JOIN auth_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(hashToken(token), new Date().toISOString());

  if (!row || !row.active) return null;

  return {
    sessionId: row.sessionId,
    id: row.id,
    email: row.email,
    role: row.role,
    name: row.name,
    totpEnabled: !!row.totp_enabled
  };
}

export function revokeSession(token) {
  if (!token) return;
  getDb().prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashToken(token));
}

export function revokeAllUserSessions(userId) {
  getDb().prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
}

export function cleanExpiredSessions() {
  const r = getDb().prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  return r.changes;
}
