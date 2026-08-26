(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function statusLabel(value) {
    return ({ paid: "Payé", pending: "En attente", cancelled: "Annulé", refunded: "Remboursé" })[value] || value || "—";
  }

  function formHtml() {
    return '<form id="purchaseForm" class="admin-purchase-form">' +
      '<input type="hidden" id="purchaseId">' +
      '<div class="admin-form-grid">' +
      '<label>Date<input id="purchaseDate" type="date" required></label>' +
      '<label>Vendeur / fournisseur<input id="purchaseSeller" maxlength="160" placeholder="Nom du vendeur" required></label>' +
      '<label>Description<input id="purchaseDescription" maxlength="240" placeholder="Display, carte, lot, fournitures..." required></label>' +
      '<label>Catégorie<select id="purchaseCategory"><option value="cartes">Cartes</option><option value="boosters">Boosters / Displays</option><option value="lots">Lots</option><option value="accessoires">Accessoires</option><option value="emballages">Emballages</option><option value="transport">Transport</option><option value="frais">Frais</option><option value="autre">Autre</option></select></label>' +
      '<label>Licence<select id="purchaseLicense"><option value="">Sans licence</option><option value="pokemon">Pokémon</option><option value="yugioh">Yu-Gi-Oh!</option><option value="onepiece">One Piece</option><option value="lorcana">Lorcana</option><option value="magic">Magic</option><option value="dragonball">Dragon Ball</option><option value="sports">Sports</option></select></label>' +
      '<label>Quantité<input id="purchaseQuantity" type="number" min="1" step="1" value="1" required></label>' +
      '<label>Montant total (€)<input id="purchaseAmount" type="number" min="0" step="0.01" required></label>' +
      '<label>Paiement<select id="purchasePayment"><option value="CB">Carte bancaire</option><option value="PayPal">PayPal</option><option value="Virement">Virement</option><option value="Espèces">Espèces</option><option value="Whatnot">Whatnot</option><option value="Vinted">Vinted</option><option value="Autre">Autre</option></select></label>' +
      '<label>Statut<select id="purchaseStatus"><option value="paid">Payé</option><option value="pending">En attente</option><option value="refunded">Remboursé</option><option value="cancelled">Annulé</option></select></label>' +
      '<label>Référence<input id="purchaseReference" maxlength="120" placeholder="Facture, commande, transaction..."></label>' +
      '<label class="admin-form-wide">Notes<textarea id="purchaseNotes" rows="3" maxlength="1000" placeholder="Notes internes"></textarea></label>' +
      '</div>' +
      '<div class="actions" style="margin-top:16px">' +
      '<button class="btn btn-primary" type="submit" id="savePurchaseBtn">Enregistrer l\'achat</button>' +
      '<button class="btn btn-secondary" type="button" id="cancelPurchaseEdit" hidden>Annuler la modification</button>' +
      '</div><p id="purchaseMessage" class="small"></p></form>';
  }

  A.renderShell("purchases", "Achats", "Saisie manuelle des achats reliée automatiquement à la comptabilité",
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Total achats</label><strong id="purchaseTotal">0,00 €</strong><small id="purchaseCount">0 achat</small></div>' +
      '<div class="admin-kpi"><label>Résultat net comptable</label><strong id="netResult">0,00 €</strong><small>Ventes - achats</small></div>' +
    '</div>' +
    '<div class="admin-panel"><h2>Ajouter un achat</h2>' + formHtml() + '</div>' +
    '<div class="admin-panel"><h2>Historique des achats</h2>' +
      '<div class="admin-filters"><input id="purchaseSearch" placeholder="Rechercher vendeur, article, référence..."><select id="purchaseFilterCategory"><option value="">Toutes catégories</option><option value="cartes">Cartes</option><option value="boosters">Boosters / Displays</option><option value="lots">Lots</option><option value="accessoires">Accessoires</option><option value="emballages">Emballages</option><option value="transport">Transport</option><option value="frais">Frais</option><option value="autre">Autre</option></select></div>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Vendeur</th><th>Description</th><th>Catégorie</th><th>Licence</th><th>Qté</th><th>Montant</th><th>Paiement</th><th>Statut</th><th>Actions</th></tr></thead><tbody id="purchasesBody"></tbody></table></div>' +
    '</div>');

  var editing = null;
  var currentPurchases = [];
  A.qs("#purchaseDate").value = today();

  function readForm() {
    return {
      date: A.qs("#purchaseDate").value,
      seller: A.qs("#purchaseSeller").value.trim(),
      description: A.qs("#purchaseDescription").value.trim(),
      category: A.qs("#purchaseCategory").value,
      license: A.qs("#purchaseLicense").value,
      quantity: Number(A.qs("#purchaseQuantity").value || 1),
      amount: Number(A.qs("#purchaseAmount").value || 0),
      paymentMethod: A.qs("#purchasePayment").value,
      status: A.qs("#purchaseStatus").value,
      reference: A.qs("#purchaseReference").value.trim(),
      notes: A.qs("#purchaseNotes").value.trim()
    };
  }

  function resetForm() {
    editing = null;
    A.qs("#purchaseForm").reset();
    A.qs("#purchaseDate").value = today();
    A.qs("#purchaseQuantity").value = "1";
    A.qs("#purchaseCategory").value = "cartes";
    A.qs("#purchasePayment").value = "CB";
    A.qs("#purchaseStatus").value = "paid";
    A.qs("#savePurchaseBtn").textContent = "Enregistrer l'achat";
    A.qs("#cancelPurchaseEdit").hidden = true;
  }

  function fillForm(p) {
    editing = p.id;
    A.qs("#purchaseDate").value = p.date || today();
    A.qs("#purchaseSeller").value = p.seller || "";
    A.qs("#purchaseDescription").value = p.description || "";
    A.qs("#purchaseCategory").value = p.category || "autre";
    A.qs("#purchaseLicense").value = p.license || "";
    A.qs("#purchaseQuantity").value = p.quantity || 1;
    A.qs("#purchaseAmount").value = p.amount || 0;
    A.qs("#purchasePayment").value = p.paymentMethod || "Autre";
    A.qs("#purchaseStatus").value = p.status || "paid";
    A.qs("#purchaseReference").value = p.reference || "";
    A.qs("#purchaseNotes").value = p.notes || "";
    A.qs("#savePurchaseBtn").textContent = "Mettre à jour l'achat";
    A.qs("#cancelPurchaseEdit").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderRows(list) {
    A.qs("#purchasesBody").innerHTML = list.map(function (p) {
      return '<tr>' +
        '<td>' + esc(p.date) + '</td>' +
        '<td>' + esc(p.seller) + '</td>' +
        '<td><strong>' + esc(p.description) + '</strong>' + (p.reference ? '<br><small>' + esc(p.reference) + '</small>' : '') + '</td>' +
        '<td>' + esc(p.category || "autre") + '</td>' +
        '<td>' + esc(p.license || "—") + '</td>' +
        '<td>' + esc(p.quantity || 1) + '</td>' +
        '<td><strong>' + A.euro(p.amount) + '</strong></td>' +
        '<td>' + esc(p.paymentMethod || "—") + '</td>' +
        '<td>' + esc(statusLabel(p.status)) + '</td>' +
        '<td><button type="button" class="btn btn-secondary purchase-edit" data-id="' + esc(p.id) + '">Modifier</button> <button type="button" class="btn btn-secondary purchase-delete" data-id="' + esc(p.id) + '">Supprimer</button></td>' +
        '</tr>';
    }).join("") || '<tr><td colspan="10">Aucun achat enregistré</td></tr>';

    document.querySelectorAll(".purchase-edit").forEach(function (btn) {
      btn.onclick = function () {
        var p = currentPurchases.find(function (item) { return item.id === btn.dataset.id; });
        if (p) fillForm(p);
      };
    });
    document.querySelectorAll(".purchase-delete").forEach(function (btn) {
      btn.onclick = async function () {
        if (!confirm("Supprimer définitivement cet achat ?")) return;
        var d = await A.adminFetch("/api/admin/accounting/purchases/" + encodeURIComponent(btn.dataset.id), { method: "DELETE" });
        if (!d.ok) return alert(d.error || "Suppression impossible");
        loadAll();
      };
    });
  }

  async function loadAll() {
    var q = A.qs("#purchaseSearch").value.trim();
    var category = A.qs("#purchaseFilterCategory").value;
    var d = await A.adminFetch("/api/admin/accounting/purchases?q=" + encodeURIComponent(q) + "&category=" + encodeURIComponent(category));
    if (d.ok) {
      currentPurchases = d.purchases || [];
      renderRows(currentPurchases);
    }
    var s = await A.adminFetch("/api/admin/accounting/stats");
    if (s.ok) {
      A.qs("#purchaseTotal").textContent = A.euro(s.totalPurchases || 0);
      A.qs("#purchaseCount").textContent = (s.purchaseCount || 0) + " achat(s)";
      A.qs("#netResult").textContent = A.euro(s.netResult || 0);
    }
  }

  A.qs("#purchaseForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var msg = A.qs("#purchaseMessage");
    msg.textContent = "Enregistrement...";
    var path = "/api/admin/accounting/purchases" + (editing ? "/" + encodeURIComponent(editing) : "");
    var d = await A.adminFetch(path, {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(readForm())
    });
    if (!d.ok) {
      msg.textContent = d.error || "Enregistrement impossible.";
      return;
    }
    msg.textContent = editing ? "Achat mis à jour." : "Achat enregistré et ajouté à la comptabilité.";
    resetForm();
    loadAll();
  });

  A.qs("#cancelPurchaseEdit").onclick = resetForm;
  A.qs("#purchaseSearch").addEventListener("input", loadAll);
  A.qs("#purchaseFilterCategory").addEventListener("change", loadAll);
  loadAll();
})();
