/**
 * Mode maintenance — hors ligne public, admin exempté.
 */
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../storage.js";
import { logAudit } from "../audit.js";

const FLAG = path.join(DATA_DIR, ".maintenance");

export function isMaintenanceMode() {
  return fs.existsSync(FLAG);
}

export function getMaintenanceInfo() {
  if (!isMaintenanceMode()) return { active: false, message: "" };
  try {
    return JSON.parse(fs.readFileSync(FLAG, "utf8"));
  } catch {
    return { active: true, message: "Maintenance en cours" };
  }
}

export function setMaintenanceMode(active, { message = "", by = "admin" } = {}) {
  if (active) {
    const payload = { active: true, message, since: new Date().toISOString(), by };
    fs.writeFileSync(FLAG, JSON.stringify(payload, null, 2), "utf8");
    logAudit({ type: "system", action: "maintenance_on", user: by, detail: message });
  } else if (fs.existsSync(FLAG)) {
    fs.unlinkSync(FLAG);
    logAudit({ type: "system", action: "maintenance_off", user: by, detail: "Mode normal" });
  }
  return getMaintenanceInfo();
}

export function maintenanceMiddleware(req, res, next) {
  if (!isMaintenanceMode()) return next();
  const p = req.path || "";
  if (p.startsWith("/api/admin") || p.startsWith("/api/auth") || p.startsWith("/api/health") || p === "/api/system/status") {
    return next();
  }
  if (p.startsWith("/api/")) {
    const info = getMaintenanceInfo();
    return res.status(503).json({
      ok: false,
      maintenance: true,
      message: info.message || "Cardoria est en maintenance. Réessayez dans quelques minutes."
    });
  }
  next();
}
