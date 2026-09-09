/**
 * Remboursements SumUp retirés du runtime Cardoria.
 * Aucun appel réseau. Conservé pour le contrôle syntaxique CI.
 */
export async function refundSumUpTransaction() {
  const error = new Error("SumUp n'est plus utilisé. Les remboursements Boutique et Live Admin passent par Revolut.");
  error.status = 410;
  error.provider = "retired";
  throw error;
}
