/**
 * Factures marketplace — numéro, TVA, PDF/HTML, export comptable.
 */
import { getDb } from "../../engine/database.js";
import { getOrder } from "../orders.js";
import { generateInvoiceHtml } from "../invoice.js";

const DEFAULT_VAT = Number(process.env.MARKETPLACE_VAT_RATE || 20);

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function nextInvoiceNumber() {
  const db = getDb();
  const year = new Date().getFullYear();
  const prefix = `FAC-${year}-`;
  const last = db.prepare(`
    SELECT invoice_number FROM mk_invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1
  `).get(prefix + "%");
  let seq = 1;
  if (last) {
    const part = parseInt(last.invoice_number.split("-").pop(), 10);
    if (!Number.isNaN(part)) seq = part + 1;
  }
  return prefix + String(seq).padStart(5, "0");
}

export function createInvoiceForOrder(orderId, vatRate = DEFAULT_VAT) {
  const order = getOrder(orderId);
  if (!order) return null;

  const existing = getDb().prepare("SELECT * FROM mk_invoices WHERE order_id = ?").get(orderId);
  if (existing) return getInvoiceRecord(existing.invoice_number);

  const subtotal = round2(order.total / (1 + vatRate / 100));
  const vatAmount = round2(order.total - subtotal);
  const invoiceNumber = nextInvoiceNumber();
  const html = generateInvoiceHtmlVat(order, { invoiceNumber, vatRate, vatAmount, subtotal });

  getDb().prepare(`
    INSERT INTO mk_invoices (invoice_number, order_id, subtotal, vat_rate, vat_amount, total, buyer_email, issued_at, html_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invoiceNumber, orderId, subtotal, vatRate, vatAmount, order.total,
    order.buyerEmail, new Date().toISOString(), html
  );

  getDb().prepare("UPDATE mk_orders SET invoice_number = ?, vat_rate = ?, vat_amount = ? WHERE id = ?")
    .run(invoiceNumber, vatRate, vatAmount, orderId);

  return getInvoiceRecord(invoiceNumber);
}

export function getInvoiceRecord(invoiceNumber) {
  const row = getDb().prepare("SELECT * FROM mk_invoices WHERE invoice_number = ?").get(invoiceNumber);
  if (!row) return null;
  return {
    invoiceNumber: row.invoice_number,
    orderId: row.order_id,
    subtotal: row.subtotal,
    vatRate: row.vat_rate,
    vatAmount: row.vat_amount,
    total: row.total,
    buyerEmail: row.buyer_email,
    issuedAt: row.issued_at,
    html: row.html_snapshot
  };
}

export function getInvoiceHtmlByOrder(orderId) {
  const inv = getDb().prepare("SELECT * FROM mk_invoices WHERE order_id = ?").get(orderId);
  if (inv) return inv.html_snapshot;
  const created = createInvoiceForOrder(orderId);
  return created?.html || generateInvoiceHtml(getOrder(orderId));
}

export function generateInvoiceHtmlVat(order, { invoiceNumber, vatRate, vatAmount, subtotal }) {
  const base = generateInvoiceHtml(order);
  const vatBlock = `
    <p>Facture n° <strong>${invoiceNumber}</strong></p>
    <p>HT : ${fmt(subtotal)} · TVA ${vatRate}% : ${fmt(vatAmount)} · TTC : ${fmt(order.total)}</p>`;
  return base.replace("<h1>FACTURE</h1>", `<h1>FACTURE</h1>${vatBlock}`);
}

function fmt(n) {
  return Number(n || 0).toFixed(2).replace(".", ",") + " €";
}

export function exportAccountingCsv({ from, to } = {}) {
  const db = getDb();
  let sql = `
    SELECT i.*, o.status, o.payment_status, o.sumup_transaction_id
    FROM mk_invoices i JOIN mk_orders o ON o.id = i.order_id WHERE 1=1
  `;
  const params = [];
  if (from) { sql += " AND date(i.issued_at) >= ?"; params.push(from); }
  if (to) { sql += " AND date(i.issued_at) <= ?"; params.push(to); }
  sql += " ORDER BY i.issued_at ASC";

  const rows = db.prepare(sql).all(...params);
  const header = "invoice_number;order_id;issued_at;buyer_email;subtotal;vat_rate;vat_amount;total;status;payment_status;sumup_ref";
  const lines = rows.map((r) => [
    r.invoice_number, r.order_id, r.issued_at, r.buyer_email,
    r.subtotal, r.vat_rate, r.vat_amount, r.total,
    r.status, r.payment_status || "", r.sumup_transaction_id || ""
  ].map(csvEscape).join(";"));

  return header + "\n" + lines.join("\n");
}

function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export function exportAccountingExcelCsv() {
  return exportAccountingCsv();
}
