import { readJson, writeJson } from "../storage.js";
import { sendEmail, publicSiteOrigin } from "../email.js";
import { getSeller } from "../marketplace/sellers.js";
import { assertSellerPlan } from "./plans.js";
import { listSellerPlanStates } from "./seller-plans.js";

const STORE = "subscription-invoices.json";

function rows() {
  const value = readJson(STORE, []);
  return Array.isArray(value) ? value : [];
}
function save(value) { writeJson(STORE, value); }
function money(value) { return Number(value || 0).toFixed(2).replace(".", ",") + " €"; }
function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char])); }
function pad(value, size = 5) { return String(value).padStart(size, "0"); }
function invoiceNumber(existing, date) {
  const year = date.getUTCFullYear();
  const prefix = `ABO-${year}-`;
  const seq = existing.filter((item) => String(item.invoiceNumber || "").startsWith(prefix)).reduce((max, item) => {
    const n = Number(String(item.invoiceNumber || "").split("-").pop());
    return Number.isInteger(n) ? Math.max(max, n) : max;
  }, 0) + 1;
  return prefix + pad(seq);
}
function addMonth(date) {
  const source = new Date(date);
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 1, source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}
function currentPeriod(startedAt, now = new Date()) {
  let start = new Date(startedAt);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(current.getTime())) return null;
  if (start > current) return null;
  let next = addMonth(start);
  let guard = 0;
  while (next <= current && guard < 240) {
    start = next;
    next = addMonth(start);
    guard += 1;
  }
  return { start, end: next };
}
function periodKey(date) { return new Date(date).toISOString().slice(0, 10); }
function configuredVatRate() {
  const value = Number(process.env.SUBSCRIPTION_VAT_RATE || 0);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
}
function totals(ttc) {
  const vatRate = configuredVatRate();
  const total = Math.round(Number(ttc || 0) * 100) / 100;
  const subtotal = vatRate > 0 ? Math.round((total / (1 + vatRate / 100)) * 100) / 100 : total;
  const vatAmount = Math.round((total - subtotal) * 100) / 100;
  return { subtotal, vatRate, vatAmount, total };
}
function invoiceHtml(invoice) {
  const issuerName = String(process.env.CARDORIA_LEGAL_NAME || "Cardoria").trim();
  const issuerSiret = String(process.env.CARDORIA_SIRET || "").trim();
  const issuerAddress = String(process.env.CARDORIA_BILLING_ADDRESS || "").trim();
  const date = new Date(invoice.issuedAt).toLocaleDateString("fr-FR");
  const from = new Date(invoice.periodStart).toLocaleDateString("fr-FR");
  const to = new Date(new Date(invoice.periodEnd).getTime() - 1).toLocaleDateString("fr-FR");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Facture ${esc(invoice.invoiceNumber)}</title>
<style>body{font-family:Arial,sans-serif;max-width:820px;margin:0 auto;padding:32px;color:#171717}h1{color:#9b761d}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#111;color:#f4d774}.total{font-size:20px;font-weight:700;color:#9b761d}</style></head><body>
<h1>FACTURE ABONNEMENT</h1>
<p><strong>${esc(invoice.invoiceNumber)}</strong><br>Date d’émission : ${date}</p>
<p><strong>Émetteur :</strong><br>${esc(issuerName)}${issuerSiret ? "<br>SIRET : " + esc(issuerSiret) : ""}${issuerAddress ? "<br>" + esc(issuerAddress) : ""}</p>
<p><strong>Client professionnel :</strong><br>${esc(invoice.customerName || invoice.email)}<br>${esc(invoice.email)}${invoice.siret ? "<br>SIRET : " + esc(invoice.siret) : ""}</p>
<table><thead><tr><th>Désignation</th><th>Période</th><th>HT</th><th>TVA</th><th>TTC</th></tr></thead><tbody>
<tr><td>Pack Cardoria ${esc(invoice.planName)}</td><td>${from} au ${to}</td><td>${money(invoice.subtotal)}</td><td>${invoice.vatRate}% · ${money(invoice.vatAmount)}</td><td>${money(invoice.total)}</td></tr>
</tbody></table>
<p class="total">Total TTC : ${money(invoice.total)}</p>
<p>Facture générée automatiquement pour l’abonnement mensuel actif Cardoria.</p>
</body></html>`;
}
export function listSubscriptionInvoicesForSeller(sellerId) {
  const id = String(sellerId || "").trim();
  return rows().filter((item) => item.sellerId === id).sort((a,b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
}
export function getSubscriptionInvoice(invoiceNumberValue, sellerId = "") {
  const number = String(invoiceNumberValue || "").trim();
  const invoice = rows().find((item) => item.invoiceNumber === number) || null;
  if (!invoice) return null;
  if (sellerId && invoice.sellerId !== String(sellerId)) return null;
  return { ...invoice, html: invoiceHtml(invoice) };
}
async function sendInvoice(invoice) {
  const url = publicSiteOrigin() + "/client-login.html";
  const sent = await sendEmail({
    kind: "subscription_invoice",
    to: invoice.email,
    subject: `Cardoria — Facture ${invoice.invoiceNumber} — Pack ${invoice.planName}`,
    text: `Votre facture mensuelle Cardoria est disponible.\n\nPack : ${invoice.planName}\nPériode : ${new Date(invoice.periodStart).toLocaleDateString("fr-FR")} au ${new Date(new Date(invoice.periodEnd).getTime()-1).toLocaleDateString("fr-FR")}\nTotal TTC : ${money(invoice.total)}\nFacture : ${invoice.invoiceNumber}`,
    actionUrl: url,
    actionLabel: "Ouvrir mon compte",
    details: [
      { label: "Facture", value: invoice.invoiceNumber },
      { label: "Pack", value: invoice.planName },
      { label: "Total TTC", value: money(invoice.total) },
      { label: "SIRET", value: invoice.siret || "—" }
    ]
  });
  return sent;
}
export async function ensureCurrentSubscriptionInvoice(sellerId, now = new Date()) {
  const state = listSellerPlanStates().find((item) => item.sellerId === String(sellerId || "")) || null;
  if (!state?.active || !state.planStartedAt) return { created: false, reason: "inactive" };
  const seller = getSeller(state.sellerId);
  if (!seller?.email) return { created: false, reason: "seller_missing" };
  const period = currentPeriod(state.planStartedAt, now);
  if (!period) return { created: false, reason: "period_unavailable" };

  const key = state.sellerId + ":" + periodKey(period.start);
  let current = rows();
  const existing = current.find((item) => item.key === key);
  if (existing) return { created: false, reason: "already_exists", invoice: existing };

  const plan = assertSellerPlan(state.planId);
  const amounts = totals(plan.monthlyPriceEur);
  const issuedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const invoice = {
    key,
    invoiceNumber: invoiceNumber(current, new Date(issuedAt)),
    sellerId: seller.id,
    email: seller.email,
    customerName: seller.professionalLegalName || seller.displayName || seller.email,
    siret: seller.siret || "",
    planId: plan.id,
    planName: plan.name,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    issuedAt,
    ...amounts,
    emailStatus: "pending",
    emailedAt: ""
  };
  current.push(invoice);
  save(current);

  const sent = await sendInvoice(invoice);
  current = rows();
  const index = current.findIndex((item) => item.key === key);
  if (index >= 0) {
    current[index] = { ...current[index], emailStatus: sent ? "sent" : "failed", emailedAt: sent ? new Date().toISOString() : "" };
    save(current);
    return { created: true, invoice: current[index], sent };
  }
  return { created: true, invoice, sent };
}
export async function runMonthlySubscriptionInvoiceCycle(now = new Date()) {
  const active = listSellerPlanStates({ activeOnly: true });
  const result = { checked: active.length, created: 0, sent: 0, failed: 0 };
  for (const state of active) {
    try {
      const item = await ensureCurrentSubscriptionInvoice(state.sellerId, now);
      if (item.created) {
        result.created += 1;
        if (item.sent) result.sent += 1;
        else result.failed += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
