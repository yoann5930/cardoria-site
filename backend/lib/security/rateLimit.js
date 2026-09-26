/**
 * Rate limiting en mémoire — adapté Render single-instance.
 * Pour multi-instance : migrer vers Redis.
 */
const buckets = new Map();

function getBucket(key) {
  if (!buckets.has(key)) buckets.set(key, { count: 0, resetAt: Date.now() });
  return buckets.get(key);
}

export function rateLimit({ windowMs = 60000, max = 100, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const bucket = getBucket(key);

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, error: "Trop de requêtes — réessayez plus tard." });
    }
    next();
  };
}

export const apiRateLimit = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_API || 120),
  keyFn: (req) => req.ip || req.headers["x-forwarded-for"] || "unknown"
});

export const liveRealtimeRateLimit = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_LIVE_REALTIME || 360),
  keyFn: (req) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const operation = String(req.path || req.originalUrl || "unknown")
      .replace(/\?.*$/, "")
      .replace(/[^a-z0-9/_-]+/gi, "")
      .slice(0, 96) || "unknown";
    const viewerId = String(body.viewerId || "").trim();
    if (viewerId) return `live-viewer:${viewerId}:${operation}`;
    const publisherKey = String(body.publisherKey || "").trim();
    if (publisherKey) {
      const sourceId = String(body.sourceId || "primary").trim() || "primary";
      return `live-publisher:${publisherKey}:${sourceId}:${operation}`;
    }
    return `live-realtime-ip:${req.ip || req.headers["x-forwarded-for"] || "unknown"}:${operation}`;
  }
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.RATE_LIMIT_AUTH || 10),
  keyFn: (req) => `auth:${req.ip || "unknown"}`
});

export const passwordResetRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.RATE_LIMIT_PASSWORD_RESET || 8),
  keyFn: (req) => `auth-reset:${req.ip || "unknown"}`
});

export const passwordResetConfirmRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.RATE_LIMIT_PASSWORD_RESET_CONFIRM || 12),
  keyFn: (req) => `auth-reset-confirm:${req.ip || "unknown"}`
});

export const aiRateLimit = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_AI || 8),
  keyFn: (req) => `ai:${req.ip || "unknown"}`
});

export function getBruteForceLock(email) {
  const key = `bf:${email}`;
  const b = buckets.get(key);
  if (!b || Date.now() > b.resetAt) return null;
  if (b.count >= Number(process.env.BRUTE_FORCE_MAX || 5)) {
    return Math.ceil((b.resetAt - Date.now()) / 1000);
  }
  return null;
}

export function recordFailedLogin(email) {
  const key = `bf:${email || "unknown"}`;
  const windowMs = 30 * 60_000;
  const bucket = getBucket(key);
  if (Date.now() > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = Date.now() + windowMs;
  }
  bucket.count += 1;
}

export function clearFailedLogin(email) {
  buckets.delete(`bf:${email}`);
}
