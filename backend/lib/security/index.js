/** Middleware securite global — headers, CORS, sanitisation, request ID. */
import { sanitizeObject } from "./sanitize.js";
import { logError } from "../monitoring/errors.js";

const PUBLIC_RELEASE = "cardoria-seo-20260902-1";

function isPrivateIndexPath(pathname = "") {
  const path = String(pathname || "").toLowerCase();
  if (path === "/robots.txt" || path === "/sitemap.xml" || path === "/sitemap-index.xml" || /^\/api\/seo\/.+\.xml$/.test(path)) {
    return false;
  }
  return path.startsWith("/admin") ||
    path.startsWith("/mes-commandes") ||
    path.startsWith("/favoris") ||
    path.startsWith("/souhaits") ||
    path.startsWith("/document-commande") ||
    path.startsWith("/api/");
}

export function applySecurityMiddleware(app) {
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    req.requestId = "req_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("X-Cardoria-Release", PUBLIC_RELEASE);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");

    const publicPath = String(req.path || "");
    const host = String(req.hostname || req.headers.host || "").split(":")[0].toLowerCase();
    const technicalHost = host.endsWith(".onrender.com") || host === "cardoria.vercel.app";

    // Une seule version publique doit être indexée : www.cardoriashop.fr.
    if (technicalHost || isPrivateIndexPath(publicPath)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    } else {
      res.setHeader("X-Robots-Tag", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1");
    }

    // Cache court pour le HTML afin de conserver des pages fraîches tout en évitant
    // un re-téléchargement complet à chaque navigation/crawl.
    if (req.method === "GET" || req.method === "HEAD") {
      if (publicPath === "/" || publicPath.endsWith(".html") || publicPath.endsWith("/")) {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      } else if (publicPath.endsWith(".css") || publicPath.endsWith(".js")) {
        res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      } else if (/\.(png|jpe?g|webp|svg|ico|woff2?|ttf)$/i.test(publicPath)) {
        res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=2592000");
      }
    }

    // Le site historique contient encore quelques scripts/styles inline. CSP reste
    // donc compatible tout en bloquant objets, iframes, base-uri et origines inconnues.
    res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https:; form-action 'self' https://www.paypal.com https://www.sandbox.paypal.com; upgrade-insecure-requests");
    if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  const allowedOrigins = (process.env.CORS_ORIGINS || process.env.SITE_URL || "").split(",").map((s) => s.trim()).filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin || allowedOrigins[0] || "*");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
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
  logError({ message: err.message, stack: err.stack, route: req.method + " " + req.path, user: req.authUser?.email || "anonymous", severity: status >= 500 ? "critical" : "error" });
  res.status(status).json({ ok: false, error: isProd && status >= 500 ? "Erreur serveur Cardoria." : (err.message || "Erreur serveur"), requestId: req.requestId });
}
