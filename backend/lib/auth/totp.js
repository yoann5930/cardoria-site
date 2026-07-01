/**
 * 2FA TOTP — optionnel pour administrateurs (RFC 6238, sans dépendance externe).
 */
import crypto from "crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input) {
  const str = String(input).toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const c of str) {
    const val = BASE32.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const key = base32Decode(secret);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(code).padStart(6, "0");
}

export function generateTotpSecret() {
  return crypto.randomBytes(20).toString("base64").replace(/[+/=]/g, "").slice(0, 32).toUpperCase();
}

export function verifyTotp(secret, token, window = 1) {
  if (!secret || !token) return false;
  const clean = String(token).replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (generateTotp(secret, counter + w) === clean) return true;
  }
  return false;
}

export function getTotpUri(secret, email) {
  const label = encodeURIComponent("Cardoria:" + email);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Cardoria&digits=6&period=30`;
}
