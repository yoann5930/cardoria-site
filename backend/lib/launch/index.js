/**
 * Module lancement Cardoria V1.0 — sans modifier les modules métier existants.
 */
import { rotateBackups } from "./backup-rotation.js";
import { logConnection, logPayment, logEstimation } from "./journals.js";
import { maintenanceMiddleware } from "./maintenance.js";
import { startAlertScheduler } from "./alerts.js";

export { runServerAudit } from "./audit.js";
export { getSystemReport, getVersionInfo } from "./system-health.js";
export { setMaintenanceMode, getMaintenanceInfo, isMaintenanceMode, maintenanceMiddleware } from "./maintenance.js";
export { rotateBackups } from "./backup-rotation.js";
export { readJournal, getJournalStats, logPayment, logEstimation } from "./journals.js";
export { checkAndAlert } from "./alerts.js";

export function connectionJournalMiddleware() {
  return (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (!req.path?.startsWith("/api/")) return;
      logConnection({
        method: req.method,
        path: req.path,
        ip: req.ip || req.headers["x-forwarded-for"] || "",
        status: res.statusCode,
        ms: Date.now() - start,
        userAgent: req.headers["user-agent"]
      });
      if (req.path.includes("/payments") || req.path.includes("/checkout")) {
        logPayment({
          orderId: req.body?.orderId || "",
          checkoutId: req.params?.checkoutId || "",
          amount: req.body?.amount || 0,
          status: res.statusCode < 400 ? "request" : "error",
          meta: { path: req.path, method: req.method }
        });
      }
      if (req.path.includes("estimation")) {
        logEstimation({
          email: req.body?.email,
          license: req.body?.license || req.body?.licence,
          confidence: null,
          source: req.path,
          ms: Date.now() - start
        });
      }
    });
    next();
  };
}

export function initLaunch() {
  rotateBackups();
  startAlertScheduler();
  console.log("[Launch] Cardoria V1.0 Ready — journaux, rotation backups, alertes actifs");
}
