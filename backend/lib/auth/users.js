/**
 * Gestion utilisateurs et rôles Cardoria.
 */
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

export function createUser({ email, password, role = "client", name = "", firstName = "", lastName = "", phone = "", address = "", address2 = "", postalCode = "", city = "", country = "France", shippingPreference = "mondial_relay", relay = {} }) {
  if (!ROLES.includes(role)) throw new Error("Rôle invalide");
  const db = getDb();
  const now = new Date().toISOString();
  const id = makeId("usr");
  db.prepare(`
    INSERT INTO auth_users (
      id, email, password_hash, role, name, first_name, last_name, phone,
      address_line1, address_line2, postal_code, city, country, shipping_preference,
      relay_id, relay_name, relay_address, relay_postal_code, relay_city, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, email.toLowerCase(), hashPassword(password), role, name,
    firstName, lastName, phone, address, address2, postalCode, city, country || "France",
    shippingPreference || "mondial_relay",
    relay.id || "", relay.name || "", relay.address || "", relay.postalCode || "", relay.city || "",
    now, now
  );
  return getUserById(id);
}

export function authenticateUser(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const lock = getBruteForceLock(normalizedEmail);
  if (lock) throw Object.assign(new Error(`Compte temporairement verrouillé (${lock}s).`), { status: 429 });

  const db = getDb();
  const row = db.prepare("SELECT * FROM auth_users WHERE email = ? AND active = 1").get(normalizedEmail);
  const databasePasswordValid = Boolean(row && verifyPassword(password, row.password_hash));

  if (!row || !databasePasswordValid) {
    recordFailedLogin(normalizedEmail);
    return null;
  }

  clearFailedLogin(normalizedEmail);
  return mapUser(row, true);
}

export function updateClientProfile(userId, patch = {}) {
  const db = getDb();
  const current = getUserById(userId);
  if (!current) throw Object.assign(new Error("Utilisateur introuvable"), { status: 404 });
  const firstName = String(patch.firstName ?? current.firstName ?? "").trim().slice(0, 80);
  const lastName = String(patch.lastName ?? current.lastName ?? "").trim().slice(0, 80);
  const phone = String(patch.phone ?? current.phone ?? "").trim().slice(0, 40);
  const address = String(patch.address ?? current.address ?? "").trim().slice(0, 300);
  const address2 = String(patch.address2 ?? current.address2 ?? "").trim().slice(0, 300);
  const postalCode = String(patch.postalCode ?? current.postalCode ?? "").trim().slice(0, 20);
  const city = String(patch.city ?? current.city ?? "").trim().slice(0, 120);
  const country = String(patch.country ?? current.country ?? "France").trim().slice(0, 80) || "France";
  const shippingPreference = patch.shippingPreference === "home" ? "home" : "mondial_relay";
  const relay = patch.relay || current.relay || {};
  db.prepare(`
    UPDATE auth_users SET name=?, first_name=?, last_name=?, phone=?, address_line1=?, address_line2=?,
      postal_code=?, city=?, country=?, shipping_preference=?, relay_id=?, relay_name=?, relay_address=?,
      relay_postal_code=?, relay_city=?, updated_at=? WHERE id=?
  `).run(
    [firstName, lastName].filter(Boolean).join(" ") || current.name || "",
    firstName, lastName, phone, address, address2, postalCode, city, country, shippingPreference,
    relay.id || "", relay.name || "", relay.address || "", relay.postalCode || "", relay.city || "",
    new Date().toISOString(), userId
  );
  return getUserById(userId);
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
    lastLoginAt: row.last_login_at,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    phone: row.phone || "",
    address: row.address_line1 || "",
    address2: row.address_line2 || "",
    postalCode: row.postal_code || "",
    city: row.city || "",
    country: row.country || "France",
    shippingPreference: row.shipping_preference || "mondial_relay",
    relay: {
      id: row.relay_id || "",
      name: row.relay_name || "",
      address: row.relay_address || "",
      postalCode: row.relay_postal_code || "",
      city: row.relay_city || ""
    }
  };
  if (includeHash) u.passwordHash = row.password_hash;
  return u;
}
