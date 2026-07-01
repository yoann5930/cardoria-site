/**
 * Schéma auth — utilisateurs, sessions, reset tokens, consentements RGPD.
 */
import { getDb } from "../engine/database.js";
import crypto from "crypto";
import { hashPassword } from "./password.js";

export const ROLES = ["super_admin", "admin", "employee", "client"];
export const ADMIN_ROLES = ["super_admin", "admin", "employee"];

export function migrateAuth() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client',
      name TEXT DEFAULT '',
      totp_secret TEXT DEFAULT '',
      totp_enabled INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES auth_users(id)
    );

    CREATE TABLE IF NOT EXISTS auth_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES auth_users(id)
    );

    CREATE TABLE IF NOT EXISTS gdpr_consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT DEFAULT '',
      email TEXT DEFAULT '',
      analytics INTEGER DEFAULT 0,
      marketing INTEGER DEFAULT 0,
      preferences_json TEXT DEFAULT '{}',
      ip TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_exp ON auth_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON auth_reset_tokens(token_hash);
  `);

  seedDefaultAdmin(db);
}

function seedDefaultAdmin(db) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM auth_users").get()?.c ?? 0;
  if (count > 0) return;

  const email = process.env.ADMIN_EMAIL || "Cardoria59330@gmail.com";
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) return;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO auth_users (id, email, password_hash, role, name, created_at, updated_at)
    VALUES (?, ?, ?, 'super_admin', 'Admin Cardoria', ?, ?)
  `).run("usr_admin_1", email.toLowerCase(), hashPassword(password), now, now);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function makeId(prefix) {
  return prefix + "_" + crypto.randomBytes(12).toString("hex");
}
