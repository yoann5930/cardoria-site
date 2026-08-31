/**
 * Gestion utilisateurs et rôles Cardoria.
 */
import crypto from "crypto";
import { getDb } from "../engine/database.js";
import { hashPassword, verifyPassword } from "./password.js";
import { makeId, ADMIN_ROLES, ROLES } from "./migrate.js";
import { recordFailedLogin, clearFailedLogin, getBruteForceLock } from "../security/rateLimit.js";

export { ROLES, ADMIN_ROLES };

export function getUserByEmail(email) {
  const row = getDb().prepare("SELECT * FROM auth_users WHERE email = ? AND active = 1").get(String(email).toLowerCase());
  return row ? mapUser(row) : null;
}

export function getUserById(id) {
  const row = getDb().prepare("SELECT * FROM auth_users WHERE id = ?").get(id);
  return row ? mapUser(row) : null;
}

export function createUser({ email, password, role = "client", name = "" }) {
  if (!ROLES.includes(role)) throw new Error("Rôle invalide");
  const db = getDb();
  const now = new Date().toISOString();
  const id = makeId("usr");
  db.prepare(`
    INSERT INTO auth_users (id, email, password_hash, role, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase(), hashPassword(password), role, name, now, now);
  return getUserById(id);
}

function safeSecretEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function authenticateUser(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const lock = getBruteForceLock(normalizedEmail);
  if (lock) throw Object.assign(new Error(`Compte temporairement verrouillé (${lock}s).`), { status: 429 });

  const db = getDb();
  const row = db.prepare("SELECT * FROM auth_users WHERE email = ? AND active = 1").get(normalizedEmail);
  const databasePasswordValid = Boolean(row && verifyPassword(password, row.password_hash));

  // PostgreSQL restaure le snapshot runtime après la migration d'authentification.
  // Si ce snapshot contient encore l'ancien hash admin, le secret Render doit rester
  // la source d'autorité pour le compte ADMIN_EMAIL uniquement.
  const configuredAdminEmail = String(process.env.ADMIN_EMAIL || "Cardoria59330@gmail.com").trim().toLowerCase();
  const configuredAdminPassword = String(process.env.ADMIN_LOGIN_PASSWORD || "");
  const renderAdminPasswordValid = Boolean(
    row &&
    ADMIN_ROLES.includes(row.role) &&
    normalizedEmail === configuredAdminEmail &&
    configuredAdminPassword &&
    safeSecretEqual(password, configuredAdminPassword)
  );

  if (!row || (!databasePasswordValid && !renderAdminPasswordValid)) {
    recordFailedLogin(normalizedEmail);
    return null;
  }

  if (renderAdminPasswordValid && !databasePasswordValid) {
    db.prepare("UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .run(hashPassword(configuredAdminPassword), new Date().toISOString(), row.id);
    row.password_hash = db.prepare("SELECT password_hash FROM auth_users WHERE id = ?").get(row.id)?.password_hash || row.password_hash;
  }

  clearFailedLogin(normalizedEmail);
  return mapUser(row, true);
}

export function updatePassword(userId, newPassword) {
  const now = new Date().toISOString();
  getDb().prepare("UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(hashPassword(newPassword), now, userId);
}

export function setTotpSecret(userId, secret, enabled = false) {
  getDb().prepare("UPDATE auth_users SET totp_secret = ?, totp_enabled = ?, updated_at = ? WHERE id = ?")
    .run(secret || "", enabled ? 1 : 0, new Date().toISOString(), userId);
}

export function getTotpSecret(userId) {
  const row = getDb().prepare("SELECT totp_secret, totp_enabled FROM auth_users WHERE id = ?").get(userId);
  return row ? { secret: row.totp_secret, enabled: !!row.totp_enabled } : null;
}

export function listUsers() {
  return getDb().prepare("SELECT id, email, role, name, active, totp_enabled, created_at, last_login_at FROM auth_users ORDER BY created_at DESC")
    .all()
    .map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      name: r.name,
      active: !!r.active,
      status: r.active ? "active" : "inactive",
      totpEnabled: !!r.totp_enabled,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at
    }));
}

export function updateUserAdmin(userId, patch = {}, actorRole = "admin") {
  const db = getDb();
  const current = getUserById(userId);
  if (!current) throw Object.assign(new Error("Utilisateur introuvable"), { status: 404 });

  const nextRole = patch.role == null ? current.role : String(patch.role);
  if (!ROLES.includes(nextRole)) throw Object.assign(new Error("Rôle invalide"), { status: 400 });
  if ((current.role === "super_admin" || nextRole === "super_admin") && actorRole !== "super_admin") {
    throw Object.assign(new Error("Seul un super administrateur peut modifier ce rôle."), { status: 403 });
  }

  const nextActive = patch.active == null ? current.active : !!patch.active;
  if (current.role === "super_admin" && (!nextActive || nextRole !== "super_admin")) {
    const activeSuperAdmins = db.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE role='super_admin' AND active=1").get()?.n || 0;
    if (activeSuperAdmins <= 1) throw Object.assign(new Error("Impossible de désactiver ou rétrograder le dernier super administrateur."), { status: 409 });
  }

  const name = patch.name == null ? current.name : String(patch.name || "").trim().slice(0, 120);
  db.prepare("UPDATE auth_users SET name=?, role=?, active=?, updated_at=? WHERE id=?")
    .run(name, nextRole, nextActive ? 1 : 0, new Date().toISOString(), userId);
  return getUserById(userId);
}

export function roleCan(role, action) {
  const matrix = {
    super_admin: ["read", "write", "delete", "export", "backup", "restore", "users", "security", "health", "finance"],
    admin: ["read", "write", "delete", "export", "backup", "users", "health", "finance"],
    employee: ["read", "write", "export"],
    client: ["read"]
  };
  return (matrix[role] || []).includes(action);
}

function mapUser(row, includeHash = false) {
  const u = {
    id: row.id,
    email: row.email,
    role: row.role,
    name: row.name,
    active: !!row.active,
    totpEnabled: !!row.totp_enabled,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
  if (includeHash) u.passwordHash = row.password_hash;
  return u;
}