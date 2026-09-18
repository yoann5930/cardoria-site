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

function cleanProfile(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

export function updateClientProfile(userId, patch = {}) {
  const current = getUserById(userId);
  if (!current) throw Object.assign(new Error("Utilisateur introuvable"), { status: 404 });
  if (current.role !== "client") throw Object.assign(new Error("Compte client requis."), { status: 403 });

  const firstName = patch.firstName == null ? current.firstName : cleanProfile(patch.firstName, 80);
  const lastName = patch.lastName == null ? current.lastName : cleanProfile(patch.lastName, 80);
  const phone = patch.phone == null ? current.phone : cleanProfile(patch.phone, 32);
  const addressLine1 = patch.addressLine1 == null ? current.addressLine1 : cleanProfile(patch.addressLine1, 160);
  const addressLine2 = patch.addressLine2 == null ? current.addressLine2 : cleanProfile(patch.addressLine2, 160);
  const postalCode = patch.postalCode == null ? current.postalCode : cleanProfile(patch.postalCode, 24).toUpperCase();
  const city = patch.city == null ? current.city : cleanProfile(patch.city, 120);
  const country = patch.country == null ? current.country : cleanProfile(patch.country || "FR", 2).toUpperCase();
  const shippingPreference = patch.shippingPreference == null ? current.shippingPreference : cleanProfile(patch.shippingPreference || "mondial_relay", 40);
  const relay = patch.relay && typeof patch.relay === "object" ? patch.relay : null;
  const relayId = relay ? cleanProfile(relay.id, 64) : current.relay?.id || "";
  const relayName = relay ? cleanProfile(relay.name, 160) : current.relay?.name || "";
  const relayAddress = relay ? cleanProfile(relay.address, 200) : current.relay?.address || "";
  const relayPostalCode = relay ? cleanProfile(relay.postalCode, 24).toUpperCase() : current.relay?.postalCode || "";
  const relayCity = relay ? cleanProfile(relay.city, 120) : current.relay?.city || "";
  const relayCountry = relay ? cleanProfile(relay.countryCode || "FR", 2).toUpperCase() : current.relay?.countryCode || "FR";
  const relayCarrierCode = relay ? cleanProfile(relay.carrierCode || "mondial_relay", 80) : current.relay?.carrierCode || "mondial_relay";
  const relayCarrierServicePointId = relay ? cleanProfile(relay.carrierServicePointId, 120) : current.relay?.carrierServicePointId || "";

  if (country && !/^[A-Z]{2}$/.test(country)) throw Object.assign(new Error("Code pays invalide."), { status: 400 });
  if (relayCountry && !/^[A-Z]{2}$/.test(relayCountry)) throw Object.assign(new Error("Code pays du Point Relais invalide."), { status: 400 });

  const name = cleanProfile(patch.name == null ? current.name : patch.name, 120) || [firstName, lastName].filter(Boolean).join(" ").trim();
  getDb().prepare(`
    UPDATE auth_users SET
      name=?, first_name=?, last_name=?, phone=?, address_line1=?, address_line2=?,
      postal_code=?, city=?, country=?, shipping_preference=?,
      relay_id=?, relay_name=?, relay_address=?, relay_postal_code=?, relay_city=?,
      relay_country=?, relay_carrier_code=?, relay_carrier_service_point_id=?, updated_at=?
    WHERE id=?
  `).run(
    name, firstName, lastName, phone, addressLine1, addressLine2,
    postalCode, city, country || "FR", shippingPreference || "mondial_relay",
    relayId, relayName, relayAddress, relayPostalCode, relayCity,
    relayCountry || "FR", relayCarrierCode || "mondial_relay", relayCarrierServicePointId,
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
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    phone: row.phone || "",
    addressLine1: row.address_line1 || "",
    addressLine2: row.address_line2 || "",
    postalCode: row.postal_code || "",
    city: row.city || "",
    country: row.country || "FR",
    shippingPreference: row.shipping_preference || "mondial_relay",
    relay: {
      id: row.relay_id || "",
      name: row.relay_name || "",
      address: row.relay_address || "",
      postalCode: row.relay_postal_code || "",
      city: row.relay_city || "",
      countryCode: row.relay_country || "FR",
      carrierCode: row.relay_carrier_code || "mondial_relay",
      carrierServicePointId: row.relay_carrier_service_point_id || ""
    },
    profileReady: !!(row.address_line1 && row.postal_code && row.city),
    relayReady: !!(row.relay_id && row.relay_name && row.relay_postal_code && row.relay_city),
    active: !!row.active,
    totpEnabled: !!row.totp_enabled,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
  if (includeHash) u.passwordHash = row.password_hash;
  return u;
}
