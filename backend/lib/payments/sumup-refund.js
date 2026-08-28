import { logAudit } from "../audit.js";

const SUMUP_API = process.env.SUMUP_API_BASE || "https://api.sumup.com";

export async function refundSumUpTransaction(transactionId, { amount = null, orderId = "", user = "admin" } = {}) {
  const id = String(transactionId || "").trim();
  if (!id) throw Object.assign(new Error("Transaction SumUp introuvable."), { status: 409 });
  if (!process.env.SUMUP_API_KEY) throw Object.assign(new Error("SUMUP_API_KEY non configurée."), { status: 503 });

  const body = amount == null ? undefined : JSON.stringify({ amount: Math.round(Number(amount) * 100) / 100 });
  const response = await fetch(`${SUMUP_API}/v0.1/me/refund/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUMUP_API_KEY}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data.message || data.error_message || data.detail || text || `SumUp HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
  }

  logAudit({ type: "payment", action: "sumup_refund_requested", user, detail: `${orderId || "—"} — ${id}${amount == null ? " — total" : ` — ${amount} EUR`}` });
  return { ok: true, transactionId: id, amount: amount == null ? null : Number(amount), response: data };
}
