/**
 * Authentification Cardoria — sessions serveur uniquement.
 */
import { validateSession } from "./auth/session.js";
import { roleCan, ADMIN_ROLES } from "./auth/users.js";
import { logAudit } from "./audit.js";

export { roleCan, ADMIN_ROLES } from "./auth/users.js";

function extractToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return req.headers["x-session-token"] || req.body?.sessionToken || null;
}

export function requireAuth(options = {}) {
  const { roles = ADMIN_ROLES, action = "read" } = options;

  return (req, res, next) => {
    const token = extractToken(req);
    const user = validateSession(token);

    if (!user) {
      logAudit({ type: "auth", action: "access_denied", user: req.ip || "unknown", detail: req.path });
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ ok: false, error: "Permissions insuffisantes." });
    }
    if (!roleCan(user.role, action)) {
      return res.status(403).json({ ok: false, error: "Action non autorisée pour ce rôle." });
    }
    req.authUser = user;
    return next();
  };
}

export function requireAdmin(req, res, next) {
  return requireAuth({ roles: ADMIN_ROLES, action: "read" })(req, res, next);
}

export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  const user = validateSession(token);
  if (user) req.authUser = user;
  next();
}
