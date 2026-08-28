(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var state = { status: "", q: "", selected: null };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function euro(v) { return A.euro(Number(v || 0)); }
  function fmtDate(v) {
    if (!v) return "—";
    try { return new Date(v).toLocaleString("fr-FR"); } catch { return v; }
  }

  function statusClass(status) {
    if (status === "Payée") return "admin-badge--ok";
    if (status === "Refusée") return "admin-badge--danger";
    if (["Carte reçue", "Acceptée"].indexOf(status) >= 0) return "admin-badge--gold";
    if (status === "Offre envoyée") return "admin-badge--warn";
    return "";
  }

  function badge(status) {
    return '<span class="admin-badge ' + statusClass(status) + '">' + esc(status || "—") + "</span>";
  }

  function kpis(summary) {
    summary = summary || {};
    return '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Dossiers actifs</label><strong>' + (summary.active || 0) + '</strong><small>À traiter</small></div>' +
      '<div class="admin-kpi"><label>Offres en attente</label><strong>' + (summary.offersToAnswer || 0) + '</strong><small>Réponse client</small></div>' +
      '<div class="admin-kpi"><label>Cartes à recevoir</label><strong>' + (summary.acceptedToReceive || 0) + '</strong><small>Offres acceptées</small></div>' +
      '<div class="admin-kpi"><label>Cartes à payer</label><strong>' + (summary.receivedToPay || 0) + '</strong><small>Réception validée</small></div>' +
      '<div class="admin-kpi"><label>Rachats finalisés</label><strong>' + (summary.completed || 0) + '</strong></div>' +
      '<div class="admin-kpi"><label>Total payé</label><strong>' + euro(summary.paidAmount || 0) + '</strong></div>' +
    '</div>';
  }

  function renderRows(list) {
    var body = A.qs("#rachatBody");
    body.innerHTML = (list || []).map(function (p) {
      var offer = p.offer && p.offer.amount ? euro(p.offer.amount) : "—";
      return '<tr data-id="' + esc(p.id) + '" style="cursor:pointer">' +
        '<td><strong>' + esc(p.id) + '</strong><br><small>' + esc(fmtDate(p.createdAt)) + '</small></td>' +
        '<td>' + esc(p.cardName || "—") + '<br><small>' + esc(p.cardGame || "") + '</small></td>' +
        '<td>' + esc(p.customerName || "—") + '<br><small>' + esc(p.customerEmail || "") + '</small></td>' +
        '<td>' + badge(p.status) + '</td>' +
        '<td>' + offer + '</td>' +
        '<td>' + (p.purchaseId ? '<span class="admin-badge admin-badge--ok">' + esc(p.purchaseId) + '</span>' : '—') + '</td>' +
      '</tr>';
    }).join("") || '<tr><td colspan="6">Aucun dossier de rachat.</td></tr>';

    body.querySelectorAll("tr[data-id]").forEach(function (row) {
      row.onclick = function () { loadDetail(row.dataset.id); };
    });
  }

  function historyHtml(history) {
    return (history || []).slice().reverse().map(function (h) {
      return '<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)">' +
        '<strong>' + esc(h.status || "Événement") + '</strong> <small>· ' + esc(fmtDate(h.at)) + '</small>' +
        '<div style="font-size:12px;color:#baaf97">' + esc(h.user || "") + (h.note ? ' · ' + esc(h.note) : '') + '</div></div>';
    }).join("") || '<p>Aucun historique.</p>';
  }

  function actionPanel(p) {
    if (p.status === "Proposition reçue") {
      return '<div class="admin-panel"><h3>Démarrer la vérification</h3><textarea id="reviewNote" placeholder="Note interne facultative" style="width:100%;min-height:80px"></textarea><button class="btn btn-primary" id="startReview">Passer à À vérifier</button></div>';
    }
    if (p.status === "À vérifier") {
      return '<div class="admin-panel"><h3>Envoyer une offre</h3><div class="admin-filters"><input id="offerAmount" type="number" min="0.01" step="0.01" placeholder="Montant €"><input id="offerDays" type="number" min="1" max="30" value="14" placeholder="Validité jours"></div><textarea id="offerNote" placeholder="Message pour le client" style="width:100%;min-height:90px"></textarea><button class="btn btn-primary" id="sendOffer">Envoyer l’offre</button></div>';
    }
    if (p.status === "Offre envoyée") {
      return '<div class="admin-panel"><h3>Offre envoyée</h3><p>Montant : <strong>' + euro(p.offer && p.offer.amount) + '</strong><br>Expiration : ' + esc(fmtDate(p.offer && p.offer.expiresAt)) + '<br>E-mail : ' + ((p.offer && p.offer.emailSent) ? 'envoyé' : 'non envoyé') + '</p><p style="color:#baaf97">Si le client répond autrement que par le lien sécurisé, vous pouvez enregistrer sa décision ici.</p><div class="admin-filters"><button class="btn btn-primary" id="adminAccept">Enregistrer acceptation</button><button class="btn btn-secondary" id="adminRefuse">Enregistrer refus</button></div></div>';
    }
    if (p.status === "Acceptée") {
      return '<div class="admin-panel"><h3>Réception de la carte</h3><div class="admin-filters"><select id="receivedCondition"><option value="">État confirmé</option><option>Mint</option><option>Near Mint</option><option>Excellent</option><option>Good</option><option>Light Played</option><option>Played</option><option>Poor</option></select></div><label style="display:flex;gap:8px;align-items:center;margin:12px 0"><input type="checkbox" id="authConfirmed"> Authenticité contrôlée et confirmée</label><textarea id="receivedNote" placeholder="Notes de réception / défauts constatés" style="width:100%;min-height:90px"></textarea><button class="btn btn-primary" id="markReceived">Valider la réception</button></div>';
    }
    if (p.status === "Carte reçue") {
      var defaultAmount = p.offer && p.offer.amount ? Number(p.offer.amount) : 0;
      return '<div class="admin-panel"><h3>Enregistrer le paiement et créer l’achat réel</h3><div class="admin-filters"><input id="paidAmount" type="number" min="0.01" step="0.01" value="' + esc(defaultAmount) + '" placeholder="Montant payé"><select id="paymentMethod"><option value="">Mode de paiement</option><option value="virement">Virement</option><option value="paypal">PayPal</option><option value="especes">Espèces</option><option value="autre">Autre</option></select><input id="paymentReference" placeholder="Référence paiement"><select id="purchaseBuyer"><option value="non_attribue">Non attribué</option><option value="yoann">Yoann</option><option value="valentin">Valentin</option></select></div><div class="admin-filters"><input id="boutiquePrice" type="number" min="0" step="0.01" placeholder="Prix Boutique (facultatif)"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="boutiqueEnabled" checked> Mettre en Boutique</label></div><p style="color:#baaf97">Cette action crée l’achat réel payé dans la comptabilité et injecte la carte dans le stock Boutique.</p><button class="btn btn-primary" id="markPaid">Paiement enregistré + envoyer au stock</button></div>';
    }
    if (p.status === "Payée") {
      return '<div class="admin-panel"><h3>Rachat finalisé</h3><p><strong>Achat réel :</strong> ' + esc(p.purchaseId || "—") + '<br><strong>Montant payé :</strong> ' + euro(p.payment && p.payment.amount) + '<br><strong>Mode :</strong> ' + esc(p.payment && p.payment.method) + '<br><strong>Référence :</strong> ' + esc(p.payment && p.payment.reference || "—") + '</p><a class="btn btn-secondary" href="admin-stock.html">Voir le stock Boutique</a> <a class="btn btn-secondary" href="admin-comptabilite.html">Voir la comptabilité</a></div>';
    }
    return '<div class="admin-panel"><h3>Dossier clos</h3><p>' + badge(p.status) + '</p></div>';
  }

  function bindActions(p) {
    function post(path, payload, confirmText) {
      if (confirmText && !window.confirm(confirmText)) return;
      A.adminFetch(path, { method: "POST", body: JSON.stringify(payload || {}) }).then(function (d) {
        if (!d.ok) return alert(d.error || "Action impossible");
        load();
        loadDetail(p.id);
      }).catch(function () { alert("Action impossible"); });
    }

    var el;
    el = A.qs("#startReview"); if (el) el.onclick = function () { post("/api/admin/rachat/" + encodeURIComponent(p.id) + "/review", { note: A.qs("#reviewNote").value || "" }); };
    el = A.qs("#sendOffer"); if (el) el.onclick = function () {
      var amount = Number(A.qs("#offerAmount").value || 0);
      if (!(amount > 0)) return alert("Saisissez un montant d’offre.");
      post("/api/admin/rachat/" + encodeURIComponent(p.id) + "/offer", { amount: amount, expiresDays: Number(A.qs("#offerDays").value || 14), note: A.qs("#offerNote").value || "" }, "Envoyer cette offre au client ?");
    };
    el = A.qs("#adminAccept"); if (el) el.onclick = function () { post("/api/admin/rachat/" + encodeURIComponent(p.id) + "/decision", { decision: "accepted" }, "Confirmer que le client a accepté l’offre ?"); };
    el = A.qs("#adminRefuse"); if (el) el.onclick = function () { post("/api/admin/rachat/" + encodeURIComponent(p.id) + "/decision", { decision: "refused" }, "Confirmer que le client a refusé l’offre ?"); };
    el = A.qs("#markReceived"); if (el) el.onclick = function () {
      if (!A.qs("#authConfirmed").checked) return alert("Vous devez confirmer l’authenticité de la carte.");
      post("/api/admin/rachat/" + encodeURIComponent(p.id) + "/received", { receivedCondition: A.qs("#receivedCondition").value || "", authenticityConfirmed: true, note: A.qs("#receivedNote").value || "" }, "Confirmer la réception physique et l’authenticité de la carte ?");
    };
    el = A.qs("#markPaid"); if (el) el.onclick = function () {
      var amount = Number(A.qs("#paidAmount").value || 0), method = A.qs("#paymentMethod").value, ref = A.qs("#paymentReference").value || "";
      if (!(amount > 0)) return alert("Montant payé obligatoire.");
      if (!method) return alert("Mode de paiement obligatoire.");
      if (method !== "especes" && !ref.trim()) return alert("Référence du paiement obligatoire hors espèces.");
      post("/api/admin/rachat/" + encodeURIComponent(p.id) + "/paid", { amount: amount, method: method, reference: ref, buyer: A.qs("#purchaseBuyer").value, boutiquePrice: Number(A.qs("#boutiquePrice").value || 0), boutiqueEnabled: A.qs("#boutiqueEnabled").checked }, "Cette action va créer l’achat réel payé et injecter la carte dans le stock Boutique. Confirmer ?");
    };
  }

  function renderDetail(p) {
    state.selected = p;
    var box = A.qs("#rachatDetail");
    box.innerHTML = '<div class="admin-panel"><div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap"><div><h2 style="margin:0 0 6px">' + esc(p.cardName || "Carte") + '</h2><p style="margin:0;color:#baaf97">' + esc(p.id) + ' · ' + esc(p.customerName || "") + ' · ' + esc(p.customerEmail || "") + '</p></div><div>' + badge(p.status) + '</div></div><div class="admin-grid-2" style="margin-top:18px"><div><h3>Dossier</h3><p><strong>Licence :</strong> ' + esc(p.cardGame || "—") + '<br><strong>Carte ID :</strong> ' + esc(p.cardId || "—") + '<br><strong>État estimation :</strong> ' + esc(p.condition || "—") + '<br><strong>Estimation :</strong> ' + esc(p.estimationId || "—") + '</p></div><div><h3>Offre / paiement</h3><p><strong>Offre :</strong> ' + (p.offer ? euro(p.offer.amount) : '—') + '<br><strong>Décision :</strong> ' + esc(p.customerDecision && p.customerDecision.decision || '—') + '<br><strong>Achat réel :</strong> ' + esc(p.purchaseId || '—') + '<br><strong>Paiement :</strong> ' + (p.payment && p.payment.status === 'paid' ? euro(p.payment.amount) : 'Non payé') + '</p></div></div>' + (p.message ? '<p><strong>Message client :</strong><br>' + esc(p.message) + '</p>' : '') + '</div>' + actionPanel(p) + '<div class="admin-panel"><h3>Historique immuable du dossier</h3>' + historyHtml(p.history) + '</div>';
    bindActions(p);
  }

  function loadDetail(id) {
    A.qs("#rachatDetail").innerHTML = '<div class="admin-panel">Chargement du dossier…</div>';
    A.adminFetch("/api/admin/rachat/" + encodeURIComponent(id)).then(function (d) {
      if (!d.ok) return A.qs("#rachatDetail").innerHTML = '<div class="admin-panel">Erreur : ' + esc(d.error || "Dossier introuvable") + '</div>';
      renderDetail(d.proposal);
    });
  }

  function load() {
    var params = new URLSearchParams();
    if (state.status) params.set("status", state.status);
    if (state.q) params.set("q", state.q);
    A.adminFetch("/api/admin/rachat?" + params.toString()).then(function (d) {
      if (!d.ok) return alert(d.error || "Chargement impossible");
      A.qs("#rachatKpis").innerHTML = kpis(d.summary);
      renderRows(d.proposals);
      var select = A.qs("#filterStatus");
      if (select.options.length <= 1) {
        (d.statuses || []).forEach(function (status) {
          var option = document.createElement("option"); option.value = status; option.textContent = status; select.appendChild(option);
        });
      }
    });
  }

  A.renderShell("rachat", "Rachat cartes", "Proposition → vérification → offre → acceptation → réception → paiement → stock Boutique",
    '<div id="rachatKpis"></div>' +
    '<div class="admin-filters"><input id="searchRachat" placeholder="Référence, client, carte, e-mail..."><select id="filterStatus"><option value="">Tous les statuts</option></select><button class="btn btn-primary" id="reloadRachat" type="button">Actualiser</button><a class="btn btn-secondary" href="admin-estimations.html">Voir les estimations</a></div>' +
    '<div class="admin-panel"><h2>Dossiers de rachat</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Référence</th><th>Carte</th><th>Client</th><th>Statut</th><th>Offre</th><th>Achat réel</th></tr></thead><tbody id="rachatBody"></tbody></table></div></div>' +
    '<div id="rachatDetail"><div class="admin-panel">Cliquez sur un dossier pour afficher son workflow complet.</div></div>');

  A.qs("#searchRachat").addEventListener("input", function () { state.q = this.value || ""; load(); });
  A.qs("#filterStatus").addEventListener("change", function () { state.status = this.value || ""; load(); });
  A.qs("#reloadRachat").onclick = load;
  load();
})();
