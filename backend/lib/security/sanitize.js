/**
 * Sanitisation XSS — chaînes et objets récursifs.
 */
const HTML_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] || c);
}

export function stripHtml(str) {
  return String(str ?? "").replace(/<[^>]*>/g, "").trim();
}

export function sanitizeString(str, { maxLength = 5000, allowNewlines = true } = {}) {
  if (str == null) return "";
  let s = stripHtml(String(str)).trim();
  if (!allowNewlines) s = s.replace(/[\r\n]+/g, " ");
  return s.slice(0, maxLength);
}

export function sanitizeEmail(email) {
  const s = sanitizeString(email, { maxLength: 254, allowNewlines: false }).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

export function sanitizeObject(obj, depth = 0) {
  if (depth > 6 || obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitizeObject(v, depth + 1));
  if (typeof obj !== "object") {
    return typeof obj === "string" ? sanitizeString(obj) : obj;
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[sanitizeString(k, { maxLength: 120, allowNewlines: false })] = sanitizeObject(v, depth + 1);
  }
  return out;
}
