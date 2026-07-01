/**
 * Validation des entrées utilisateur — schémas légers sans dépendance lourde.
 */
import { sanitizeEmail, sanitizeString } from "./sanitize.js";

export function validateBody(schema, body = {}) {
  const errors = [];
  const data = {};

  for (const [key, rules] of Object.entries(schema)) {
    let val = body[key];
    const required = rules.required === true;

    if (val == null || val === "") {
      if (required) errors.push(`${key} requis`);
      else if (rules.default != null) data[key] = rules.default;
      continue;
    }

    if (rules.type === "email") {
      val = sanitizeEmail(val);
      if (!val) errors.push(`${key} : email invalide`);
      else data[key] = val;
      continue;
    }

    if (rules.type === "number") {
      val = Number(val);
      if (Number.isNaN(val)) errors.push(`${key} : nombre invalide`);
      else if (rules.min != null && val < rules.min) errors.push(`${key} trop petit`);
      else if (rules.max != null && val > rules.max) errors.push(`${key} trop grand`);
      else data[key] = val;
      continue;
    }

    if (rules.type === "enum") {
      val = sanitizeString(val, { maxLength: 64, allowNewlines: false });
      if (!rules.values.includes(val)) errors.push(`${key} : valeur non autorisée`);
      else data[key] = val;
      continue;
    }

    if (rules.type === "boolean") {
      data[key] = val === true || val === "true" || val === 1 || val === "1";
      continue;
    }

    if (rules.type === "array") {
      if (!Array.isArray(val)) errors.push(`${key} : tableau attendu`);
      else data[key] = val.slice(0, rules.maxItems || 100);
      continue;
    }

    val = sanitizeString(val, { maxLength: rules.maxLength || 500, allowNewlines: rules.allowNewlines !== false });
    if (rules.minLength && val.length < rules.minLength) errors.push(`${key} trop court`);
    else data[key] = val;
  }

  return { ok: errors.length === 0, errors, data };
}

export const SCHEMAS = {
  login: {
    email: { type: "email", required: true },
    password: { type: "string", required: true, minLength: 8, maxLength: 128, allowNewlines: false }
  },
  legacyAdminLogin: {
    code: { type: "string", required: true, minLength: 4, maxLength: 64, allowNewlines: false }
  },
  passwordResetRequest: {
    email: { type: "email", required: true }
  },
  passwordResetConfirm: {
    token: { type: "string", required: true, minLength: 20, maxLength: 128, allowNewlines: false },
    password: { type: "string", required: true, minLength: 8, maxLength: 128, allowNewlines: false }
  },
  gdprExport: {
    email: { type: "email", required: true }
  },
  gdprDelete: {
    email: { type: "email", required: true },
    confirm: { type: "string", required: true, minLength: 6, maxLength: 32, allowNewlines: false }
  }
};
