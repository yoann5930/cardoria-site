/**
 * Facture PDF/HTML marketplace Cardoria.
 */
export function generateInvoiceHtml(order) {
  const date = new Date(order.createdAt).toLocaleDateString("fr-FR");
  const rows = `
    <tr><td>${order.listingId}</td><td>${order.listingTitle}</td><td>${order.qty}</td>
    <td>${fmt(order.unitPrice)}</td><td>${fmt(order.unitPrice * order.qty)}</td></tr>
    <tr><td colspan="4">Frais de port (${order.shippingCarrier || "—"})</td><td>${fmt(order.shippingCost)}</td></tr>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Facture ${order.id}</title>
<style>
body{font-family:Arial,sans-serif;padding:32px;color:#111;max-width:800px;margin:0 auto}
h1{color:#b8860b;margin:0 0 8px}table{width:100%;border-collapse:collapse;margin:20px 0}
th,td{border:1px solid #ddd;padding:10px;text-align:left}th{background:#111;color:#ffe18a}
.total{font-size:22px;font-weight:bold;color:#b8860b}.badge{display:inline-block;padding:4px 10px;background:#eee;border-radius:6px;font-size:12px}
@media print{.no-print{display:none}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start">
<div><h1>FACTURE</h1><p><strong>${order.id}</strong><br>Date : ${date}<br>
<span class="badge">Statut : ${order.status}</span></p></div>
<div style="text-align:right"><h2 style="color:#b8860b;margin:0">CARDORIA</h2>
<p>Cardoria59330@gmail.com<br>Marketplace TCG premium</p></div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:24px 0">
<div><h3>Client</h3><p>${order.buyerName || "—"}<br>${order.buyerEmail}<br>${order.shippingAddress || ""}</p></div>
<div><h3>Paiement SumUp</h3><p>Statut : ${order.paymentStatus || order.status || "En attente"}<br>Méthode : ${order.paymentMethod || "Carte bancaire SumUp"}<br>Réf. : ${order.paymentReference || order.sumupCheckoutId || order.stripeSessionId || "—"}</p></div></div>
<table><thead><tr><th>Réf.</th><th>Désignation</th><th>Qté</th><th>P.U.</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
<p class="total">Total TTC : ${fmt(order.total)}</p>
<p style="font-size:12px;color:#666">Document généré automatiquement par Cardoria Marketplace.</p>
<button class="no-print" onclick="window.print()" style="padding:12px 24px;background:#b8860b;color:#fff;border:none;border-radius:8px;cursor:pointer">Imprimer / PDF</button>
</body></html>`;
}

function fmt(n) {
  return Number(n || 0).toFixed(2).replace(".", ",") + " €";
}
