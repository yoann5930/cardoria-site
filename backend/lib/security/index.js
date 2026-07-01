/**
 * Middleware sécurité global — headers, CORS, sanitisation, request ID.
 */
import { sanitizeObject } from "./sanitize.js";
import { logError } from "../monitoring/errors.js";

export function applySecurityMiddleware(app) {
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    req.requestId = "req_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  const allowedOrigins = (process.env.CORS_ORIGINS || process.env.SITE_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin || allowedOrigins[0] || "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-cardoria-admin-code, x-csrf-token, x-session-token");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use((req, res, next) => {
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      const skipSanitize = req.path.includes("/estimation") || req.path.includes("/ai/analyze") || req.path.includes("/ai/analyses");
      if (!skipSanitize) req.body = sanitizeObject(req.body);
    }
    next();
  });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === "production";

  logError({
    message: err.message,
    stack: err.stack,
    route: req.method + " " + req.path,
    user: req.authUser?.email || "anonymous",
    severity: status >= 500 ? "critical" : "error"
  });

  res.status(status).json({
    ok: false,
    error: isProd && status >= 500 ? "Erreur serveur Cardoria." : (err.message || "Erreur serveur"),
    requestId: req.requestId
  });
}
