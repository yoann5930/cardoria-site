(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var orders = [];
  var filter = "all";
  var CARRIERS = ["La Poste", "Mondial Relay", "Relais Colis"];
  var STATUSES = ["À préparer", "En préparation", "Expédiée", "Livrée", "Annulée"];

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
  function euro(v) { return Number(v || 0).toFixed(2).replace(".", ",") + " €"; }
  function total(o) { return Number(o.total || (o.items || []).reduce(function (s, i) { return s + Number(i.qty || 1) * Number(i.price || 0); }, 0)); }
  function paymentLabel(o) { return ({paid:"Payé",pending:"En attente",failed:"Échoué",refunded:"Remboursé"})[o.paymentStatus] || o.payment || "—"; }
  function paymentClass(o) { return o.paymentStatus === "paid" ? "admin-badge--ok" : (o.paymentStatus === "failed" || o.paymentStatus === "refunded") ? "admin-badge--danger" : "admin-badge--gold"; }
  function options(values, current, emptyLabel) { var out = emptyLabel ? '<option value="">'+esc(emptyLabel)+'</option>' : ""; return out + values.map(function (v) { return '<option value="'+esc(v)+'"'+(v===current?' selected':'')+'>'+esc(v)+'</option>'; }).join(""); }

  function statusSteps(current) {
    if (current === "Annulée") return '<span class="active">Annulée</span>';
    var steps = ["À préparer","En préparation","Expédiée","Livrée"], idx = steps.indexOf(current);
    return steps.map(function (s, i) { return '<span class="'+(i<=idx?"active":"")+'">'+esc(s)+'</span>'; }).join("");
  }

  function render() {
    var q = (A.qs("#orderSearch")?.value || "").toLowerCase();
    var list = orders.filter(function (o) {
      var matchesFilter = filter === "all" || (filter === "today" ? o.date === new Date().toISOString().slice(0,10) : o.status === filter);
      return matchesFilter && JSON.stringify([o.id,o.client,o.email,o.phone,o.status,o.tracking,o.carrier]).toLowerCase().includes(q);
    });

    A.qs("#ordersCount").textContent = String(orders.length);
    A.qs("#ordersPrepare").textContent = String(orders.filter(function (o) { return o.status === "À préparer"; }).length);
    A.qs("#ordersShipped").textContent = String(orders.filter(function (o) { return o.status === "Expédiée"; }).length);
    A.qs("#ordersRevenue").textContent = euro(orders.filter(function (o) { return o.paymentStatus === "paid"; }).reduce(function (s,o) { return s + total(o); }, 0));

    A.qs("#orderCards").innerHTML = list.map(function (o) {
      var canRefund = o.paymentStatus === "paid" && !!(o.sumupCheckoutId || o.sumupTransactionId);
      var review = o.paymentReviewRequired ? '<div class="admin-panel" style="margin:10px 0;border-color:#b44"><strong style="color:#ff8f8f">Remboursement SumUp à confirmer</strong><br><small>Le stock reste bloqué jusqu’à confirmation du remboursement.</small></div>' : "";
      var items = (o.items || []).map(function (i) { return '<tr><td>'+esc(i.name||i.ref)+'</td><td>'+Number(i.qty||1)+'</td><td>'+euro(i.price)+'</td><td>'+euro(Number(i.qty||1)*Number(i.price||0))+'</td></tr>'; }).join("") || '<tr><td colspan="4">Aucun article</td></tr>';
      var legacyCarrier = o.carrier && CARRIERS.indexOf(o.carrier) < 0 ? [o.carrier].concat(CARRIERS) : CARRIERS;
      return '<article class="request-card" data-order-card="'+esc(o.id)+'" style="margin-bottom:18px">' +
        '<div class="request-head"><div><h3>'+esc(o.id)+'</h3><p>'+esc(o.date||"")+' • '+esc(o.client||"Client")+'<br>'+esc(o.email||"")+(o.phone?'<br>'+esc(o.phone):'')+'</p><small style="color:#baaf97">Checkout SumUp : '+esc(o.sumupCheckoutId||"—")+'</small></div><div style="text-align:right"><strong>'+euro(total(o))+'</strong><br><span class="admin-badge '+paymentClass(o)+'">'+esc(paymentLabel(o))+'</span></div></div>' +
        '<div class="progress">'+statusSteps(o.status)+'</div>'+review+
        '<details open><summary style="cursor:pointer;color:#ffe18a;margin-bottom:10px">Articles</summary><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Article</th><th>Qté</th><th>PU</th><th>Total</th></tr></thead><tbody>'+items+'</tbody></table></div></details>' +
        '<div class="admin-form-grid" style="margin-top:14px">' +
          '<label>Statut<select data-field="status">'+options(STATUSES,o.status)+'</select></label>' +
          '<label>Transporteur<select data-field="carrier">'+options(legacyCarrier,o.carrier||"","Choisir")+'</select></label>' +
          '<label>Numéro de suivi<input data-field="tracking" value="'+esc(o.tracking||"")+'" placeholder="Suivi colis"></label>' +
          '<label>Téléphone<input data-field="phone" value="'+esc(o.phone||"")+'"></label>' +
          '<label class="admin-form-wide">Adresse de livraison<textarea data-field="address" rows="3">'+esc(o.address||"")+'</textarea></label>' +
          '<label class="admin-form-wide">Note interne<textarea data-field="internalNote" rows="3">'+esc(o.internalNote||"")+'</textarea></label>' +
        '</div><div class="actions" style="margin-top:14px">' +
          '<button type="button" class="btn btn-primary" data-save="'+esc(o.id)+'">Enregistrer</button> ' +
          (o.sumupCheckoutId?'<button type="button" class="btn btn-secondary" data-sync="'+esc(o.id)+'">Synchroniser SumUp</button> ':'') +
          (canRefund?'<button type="button" class="btn btn-secondary" data-refund="'+esc(o.id)+'">Rembourser SumUp</button> ':'') +
          '<button type="button" class="btn btn-secondary" data-doc="'+esc(o.id)+'" data-type="bon">Bon commande</button> <button type="button" class="btn btn-secondary" data-doc="'+esc(o.id)+'" data-type="facture">Facture</button>' +
        '</div><p class="small" data-status-message></p></article>';
    }).join("") || '<div class="admin-panel">Aucune commande.</div>';
    bind();
  }

  function card(id) { return A.qs('[data-order-card="'+CSS.escape(String(id))+'"]'); }
  function payload(c) { function v(n){ return c.querySelector('[data-field="'+n+'"]')?.value || ""; } return { status:v("status"), carrier:v("carrier"), tracking:v("tracking"), phone:v("phone"), address:v("address"), internalNote:v("internalNote"), shipping:"Standard" }; }

  function reload(id, message) {
    return A.adminFetch("/api/admin/payments/boutique-orders", { cache:"no-store" }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "Chargement impossible");
      orders = d.orders || [];
      if (Array.isArray(d.carriers) && d.carriers.length) CARRIERS = d.carriers;
      render();
      var c = id && card(id), box = c && c.querySelector("[data-status-message]"); if (box) box.textContent = message || "Mis à jour.";
    });
  }

  function bind() {
    A.qs("#orderCards").querySelectorAll("button[data-save]").forEach(function (btn) { btn.onclick = function () { var id=btn.dataset.save,c=card(id),m=c?.querySelector("[data-status-message]"); btn.disabled=true; if(m)m.textContent="Enregistrement..."; A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify(payload(c))}).then(function(d){if(!d.ok)throw new Error(d.error||"Mise à jour impossible");return reload(id,"Commande mise à jour.");}).catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;}); }; });
    A.qs("#orderCards").querySelectorAll("button[data-sync]").forEach(function (btn) { btn.onclick = function () { var id=btn.dataset.sync,c=card(id),m=c?.querySelector("[data-status-message]"); btn.disabled=true; if(m)m.textContent="Synchronisation SumUp..."; A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/sync-sumup",{method:"POST",body:"{}"}).then(function(d){if(!d.ok)throw new Error(d.error||"Synchronisation impossible");return reload(id,"SumUp synchronisé : "+(d.status||"OK"));}).catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;}); }; });
    A.qs("#orderCards").querySelectorAll("button[data-refund]").forEach(function (btn) { btn.onclick = function () { var id=btn.dataset.refund,c=card(id),m=c?.querySelector("[data-status-message]"); if(!confirm("Confirmer le remboursement intégral SumUp de cette commande ?"))return; btn.disabled=true; if(m)m.textContent="Remboursement SumUp..."; A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/refund",{method:"POST",body:"{}"}).then(function(d){if(!d.ok)throw new Error(d.error||"Remboursement impossible");return reload(id,d.status==="refunded"?"Remboursement confirmé. Stock libéré.":"Remboursement demandé. Synchronise SumUp pour confirmer.");}).catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;}); }; });
    A.qs("#orderCards").querySelectorAll("button[data-doc]").forEach(function (btn) { btn.onclick=function(){window.open("document-commande.html?id="+encodeURIComponent(btn.dataset.doc)+"&type="+encodeURIComponent(btn.dataset.type),"_blank");}; });
  }

  A.renderShell("orders","Commandes Boutique","Cycle complet : paiement SumUp, préparation, transport, livraison et remboursement",
    '<div class="admin-kpi-grid" style="margin-bottom:16px"><div class="admin-kpi"><label>Total commandes</label><strong id="ordersCount">—</strong></div><div class="admin-kpi"><label>À préparer</label><strong id="ordersPrepare">—</strong></div><div class="admin-kpi"><label>Expédiées</label><strong id="ordersShipped">—</strong></div><div class="admin-kpi"><label>CA payé</label><strong id="ordersRevenue">—</strong></div></div>' +
    '<div class="admin-filters"><input id="orderSearch" placeholder="Commande, client, email, suivi..."><button class="btn btn-secondary" data-filter="all">Toutes</button><button class="btn btn-secondary" data-filter="today">Aujourd\'hui</button><button class="btn btn-secondary" data-filter="À préparer">À préparer</button><button class="btn btn-secondary" data-filter="En préparation">En préparation</button><button class="btn btn-secondary" data-filter="Expédiée">Expédiées</button><button class="btn btn-secondary" data-filter="Livrée">Livrées</button><button class="btn btn-secondary" data-filter="Annulée">Annulées</button></div><div id="orderCards"></div>');
  A.qs("#orderSearch").addEventListener("input", render);
  A.qs(".admin-filters").querySelectorAll("button[data-filter]").forEach(function (b) { b.onclick=function(){filter=b.dataset.filter;render();}; });
  reload();
})();
