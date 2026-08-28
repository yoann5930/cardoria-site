import crypto from "crypto";
import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { getDb } from "../lib/engine/database.js";
import { logAudit } from "../lib/audit.js";
import {
  createUser,
  getUserById,
  listUsers,
  setTotpSecret,
  updateUserAdmin
} from "../lib/auth/users.js";
import { revokeAllUserSessions } from "../lib/auth/session.js";
import { revokeUser2faChallenges } from "../lib/auth/2faChallenge.js";

const router = Router();
const USER_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "users" });
const SECURITY_ADMIN = requireAuth({ roles: ["super_admin"], action: "security" });
const VALID_ROLES = new Set(["client", "employee", "admin", "super_admin"]);

function validEmail(value) {
  return /^\S+@\S+\.\S+$/.test(String(value || "").trim().toLowerCase());
}

function cleanName(value) {
  return String(value || "").trim().slice(0, 120);
}

function getSessionCounts() {
  const rows = getDb().prepare(`
    SELECT user_id, COUNT(*) AS n
    FROM auth_sessions
    WHERE expires_at > ?
    GROUP BY user_id
  `).all(new Date().toISOString());
  return new Map(rows.map((row) => [String(row.user_id), Number(row.n || 0)]));
}

function userExistsByEmail(email) {
  return !!getDb().prepare("SELECT id FROM auth_users WHERE email = ? LIMIT 1").get(String(email || "").trim().toLowerCase());
}

function actorCanManageTarget(actor, target, { nextRole = target.role, nextActive = target.active } = {}) {
  if (!actor || !target) throw Object.assign(new Error("Contexte utilisateur invalide."), { status: 400 });
  if (!VALID_ROLES.has(nextRole)) throw Object.assign(new Error("Rôle invalide."), { status: 400 });

  const roleChanged = nextRole !== target.role;
  const activeChanged = !!nextActive !== !!target.active;

  if (actor.id === target.id && (roleChanged || activeChanged)) {
    throw Object.assign(new Error("Pour éviter un verrouillage accidentel, vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte depuis cette page."), { status: 409 });
  }

  if (actor.role !== "super_admin") {
    if (["admin", "super_admin"].includes(target.role)) {
      throw Object.assign(new Error("Seul un super administrateur peut gérer un administrateur."), { status: 403 });
    }
    if (["admin", "super_admin"].includes(nextRole)) {
      throw Object.assign(new Error("Seul un super administrateur peut attribuer un rôle administrateur."), { status: 403 });
    }
  }
}

function revokeUserSecurityState(userId) {
  revokeAllUserSessions(userId);
  revokeUser2faChallenges(userId);
}

router.use(requireAdmin);

router.get("/users", USER_ADMIN, (req, res) => {
  const counts = getSessionCounts();
  const users = listUsers().map((user) => ({
    ...user,
    sessionCount: counts.get(String(user.id)) || 0,
    isSelf: user.id === req.authUser?.id
  }));
  const activeSuperAdmins = users.filter((user) => user.role === "super_admin" && user.active).length;
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    users,
    actor: {
      id: req.authUser?.id,
      email: req.authUser?.email,
      role: req.authUser?.role
    },
    summary: {
      total: users.length,
      active: users.filter((user) => user.active).length,
      inactive: users.filter((user) => !user.active).length,
      twoFactorEnabled: users.filter((user) => user.totpEnabled).length,
      activeSessions: users.reduce((sum, user) => sum + Number(user.sessionCount || 0), 0),
      activeSuperAdmins
    }
  });
});

router.post("/users", USER_ADMIN, (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "employee");
    const name = cleanName(req.body?.name);

    if (!validEmail(email)) return res.status(400).json({ ok: false, error: "Email invalide." });
    if (!["employee", "admin"].includes(role)) {
      return res.status(400).json({ ok: false, error: "Créez ici uniquement un employé ou un administrateur. Les clients s'inscrivent sur le site." });
    }
    if (role === "admin" && req.authUser?.role !== "super_admin") {
      return res.status(403).json({ ok: false, error: "Seul un super administrateur peut créer un administrateur." });
    }
    if (userExistsByEmail(email)) {
      return res.status(409).json({ ok: false, error: "Un compte actif ou inactif existe déjà pour cet email." });
    }

    const password = crypto.randomBytes(48).toString("base64url") + "1A";
    const user = createUser({ email, password, role, name });
    logAudit({
      type: "users",
      action: "user_create",
      user: req.authUser?.email || "admin",
      detail: `${user.id} — ${user.email} — ${user.role}`
    });
    res.status(201).json({ ok: true, user, loginMethod: "magic_link", requires2fa: true });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.put("/users/:id", USER_ADMIN, (req, res) => {
  try {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ ok: false, error: "Utilisateur introuvable." });

    const nextRole = req.body?.role == null ? target.role : String(req.body.role);
    const nextActive = req.body?.active == null ? target.active : !!req.body.active;
    actorCanManageTarget(req.authUser, target, { nextRole, nextActive });

    const patch = {};
    if (req.body?.name !== undefined) patch.name = cleanName(req.body.name);
    if (req.body?.role !== undefined) patch.role = nextRole;
    if (req.body?.active !== undefined) patch.active = nextActive;

    const roleChanged = nextRole !== target.role;
    const activeChanged = nextActive !== target.active;
    const user = updateUserAdmin(target.id, patch, req.authUser?.role || "admin");

    if (roleChanged || activeChanged) revokeUserSecurityState(target.id);

    logAudit({
      type: "users",
      action: "user_update",
      user: req.authUser?.email || "admin",
      detail: `${target.id} — ${target.email} — role:${target.role}->${user.role} — active:${target.active}->${user.active}${roleChanged || activeChanged ? " — sessions_revoquees" : ""}`
    });

    res.json({ ok: true, user, sessionsRevoked: roleChanged || activeChanged });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.post("/users/:id/revoke-sessions", USER_ADMIN, (req, res) => {
  try {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ ok: false, error: "Utilisateur introuvable." });
    actorCanManageTarget(req.authUser, target, { nextRole: target.role, nextActive: target.active });

    if (req.authUser?.role !== "super_admin" && ["admin", "super_admin"].includes(target.role)) {
      return res.status(403).json({ ok: false, error: "Seul un super administrateur peut révoquer les sessions d'un administrateur." });
    }

    revokeUserSecurityState(target.id);
    logAudit({
      type: "users",
      action: "sessions_revoke_all",
      user: req.authUser?.email || "admin",
      detail: `${target.id} — ${target.email}`
    });
    res.json({ ok: true, userId: target.id, sessionsRevoked: true, selfRevoked: target.id === req.authUser?.id });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.post("/users/:id/reset-2fa", SECURITY_ADMIN, (req, res) => {
  try {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ ok: false, error: "Utilisateur introuvable." });

    setTotpSecret(target.id, "", false);
    revokeUserSecurityState(target.id);
    logAudit({
      type: "users",
      action: "two_factor_reset",
      user: req.authUser?.email || "super_admin",
      detail: `${target.id} — ${target.email}`
    });

    res.json({
      ok: true,
      userId: target.id,
      twoFactorReset: true,
      requiresSetup: ["super_admin", "admin", "employee"].includes(target.role),
      selfRevoked: target.id === req.authUser?.id
    });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

export default router;
