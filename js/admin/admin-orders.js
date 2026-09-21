(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var orders = [];
  var filter = "all";
  var colissimo = { configured:false, senderConfigured:false, labelPurchasesEnabled:false, productCode:"DOM" };
  var emailConfig = { configured:false, missingReason:"" };
  var CARRIERS = ["La Poste", "Mondial Relay", "Relais Colis"];
  var STATUSES = ["À préparer", "En préparation", "Expédiée", "Livrée", "Annulée"];

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
  function euro(v) { return Number(v || 0).toFixed(2).replace(".", ",") + " €"; }
  function total(o) { return Number(o.total || (o.items || []).reduce(function (s, i) { return s + Number(i.qty || 1) * Number(i.price || 0); }, 0)); }
  function paymentLabel(o) { return ({paid:"Payé",pending:"En attente",failed:"Échoué",refunded:"Remboursé"})[o.paymentStatus] || o.payment || "—"; }
  function paymentClass(o) { return o.paymentStatus === "paid" ? "admin-badge--ok" : (o.paymentStatus === "failed" || o.paymentStatus === "refunded") ? "admin-badge--danger" : "admin-badge--gold"; }
  function options(values, current, emptyLabel) { var out = emptyLabel ? '<option value="">'+esc(emptyLabel)+'</option>' : ""; return out + values.map(function (v) { return '<option value="'+esc(v)+'"'+(v===current?' selected':'')+'>'+esc(v)+'</option>'; }).join(""); }
  function emailLabel(state) { if(!state)return "Non envoyé"; if(state.status==="sent")return "Envoyé"; if(state.status==="failed")return "Échec"; if(state.status==="sending")return "En cours"; return "Non envoyé"; }
  function emailColor(state) { return state?.status==="sent"?"#7fd59b":state?.status==="failed"?"#ff8f8f":"#baaf97"; }

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
      var colissimoReady = !!(colissimo.configured && colissimo.senderConfigured && colissimo.labelPurchasesEnabled);
      var colissimoAttempt = o.colissimoLabelAttempt && o.colissimoLabelAttempt.status || "";
      var colissimoBlocked = colissimoAttempt === "reconciliation_required";
      var purchaseMail = o.purchaseEmail || null, trackingMail = o.trackingEmail || null;
      var review = o.paymentReviewRequired ? '<div class="admin-panel" style="margin:10px 0;border-color:#b44"><strong style="color:#ff8f8f">Remboursement SumUp à confirmer</strong><br><small>Le stock reste bloqué jusqu’à confirmation du remboursement.</small></div>' : "";
      var mailPanel = '<div class="admin-panel" style="margin:10px 0"><strong>E-mails client</strong><br><small>Confirmation achat : <span style="color:'+emailColor(purchaseMail)+'">'+esc(emailLabel(purchaseMail))+'</span>'+(purchaseMail?.sentAt?' · '+esc(new Date(purchaseMail.sentAt).toLocaleString("fr-FR")):'')+'</small><br><small>Suivi expédition : <span style="color:'+emailColor(trackingMail)+'">'+esc(emailLabel(trackingMail))+'</span>'+(trackingMail?.sentAt?' · '+esc(new Date(trackingMail.sentAt).toLocaleString("fr-FR")):'')+'</small>'+(emailConfig.configured?'':'<br><small style="color:#ffb36b">SMTP : '+esc(emailConfig.missingReason||"non configuré")+'</small>')+'</div>';
      var items = (o.items || []).map(function (i) { return '<tr><td>'+esc(i.name||i.ref)+'</td><td>'+Number(i.qty||1)+'</td><td>'+euro(i.price)+'</td><td>'+euro(Number(i.qty||1)*Number(i.price||0))+'</td></tr>'; }).join("") || '<tr><td colspan="4">Aucun article</td></tr>';
      var legacyCarrier = o.carrier && CARRIERS.indexOf(o.carrier) < 0 ? [o.carrier].concat(CARRIERS) : CARRIERS;
      return '<article class="request-card" data-order-card="'+esc(o.id)+'" style="margin-bottom:18px">' +
        '<div class="request-head"><div><h3>'+esc(o.id)+'</h3><p>'+esc(o.date||"")+' • '+esc(o.client||"Client")+'<br>'+esc(o.email||"")+(o.phone?'<br>'+esc(o.phone):'')+'</p><small style="color:#baaf97">Checkout SumUp : '+esc(o.sumupCheckoutId||"—")+'</small></div><div style="text-align:right"><strong>'+euro(total(o))+'</strong><br><span class="admin-badge '+paymentClass(o)+'">'+esc(paymentLabel(o))+'</span></div></div>' +
        '<div class="progress">'+statusSteps(o.status)+'</div>'+review+mailPanel+
        '<details open><summary style="cursor:pointer;color:#ffe18a;margin-bottom:10px">Articles</summary><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Article</th><th>Qté</th><th>PU</th><th>Total</th></tr></thead><tbody>'+items+'</tbody></table></div></details>' +
        '<div class="admin-form-grid" style="margin-top:14px">' +
          '<label>Statut<select data-field="status">'+options(STATUSES,o.status)+'</select></label>' +
          '<label>Transporteur<select data-field="carrier">'+options(legacyCarrier,o.carrier||"","Choisir")+'</select></label>' +
          '<label>Numéro de suivi<input data-field="tracking" value="'+esc(o.tracking||o.colissimoParcelNumber||"")+'" placeholder="Rempli automatiquement pour Colissimo"></label>' +
          '<label>Poids Colissimo (g)<input data-field="shippingWeightGrams" type="number" min="1" max="30000" step="1" value="'+esc(o.shippingWeightGrams||"")+'" placeholder="Ex. 250"></label>' +
          '<label>Téléphone<input data-field="phone" value="'+esc(o.phone||"")+'"></label>' +
          '<label class="admin-form-wide">Adresse de livraison<textarea data-field="address" rows="3">'+esc(o.address||"")+'</textarea></label>' +
          '<label class="admin-form-wide">Note interne<textarea data-field="internalNote" rows="3">'+esc(o.internalNote||"")+'</textarea></label>' +
        '</div><div class="actions" style="margin-top:14px">' +
          '<button type="button" class="btn btn-primary" data-save="'+esc(o.id)+'">Enregistrer</button> ' +
          (o.sumupCheckoutId?'<button type="button" class="btn btn-secondary" data-sync="'+esc(o.id)+'">Synchroniser SumUp</button> ':'') +
          (canRefund?'<button type="button" class="btn btn-secondary" data-refund="'+esc(o.id)+'">Rembourser SumUp</button> ':'') +
          (o.paymentStatus==="paid"?'<button type="button" class="btn btn-secondary" data-mail-purchase="'+esc(o.id)+'">Renvoyer mail achat</button> ':'') +
          (o.status==="Expédiée"&&o.carrier&&o.tracking?'<button type="button" class="btn btn-secondary" data-mail-tracking="'+esc(o.id)+'">Renvoyer mail suivi</button> ':'') +
          (o.colissimoParcelNumber?'<button type="button" class="btn btn-secondary" data-colissimo-download="'+esc(o.id)+'">Télécharger étiquette Colissimo</button> ':(o.paymentStatus==="paid"?'<button type="button" class="btn btn-secondary" data-colissimo-create="'+esc(o.id)+'" '+((!colissimoReady||colissimoBlocked)?"disabled":"")+'>Créer étiquette Colissimo</button> ':"")) +
          '<button type="button" class="btn btn-secondary" data-doc="'+esc(o.id)+'" data-type="bon">Bon commande</button> <button type="button" class="btn btn-secondary" data-doc="'+esc(o.id)+'" data-type="facture">Facture</button>' +
        '</div>'+(colissimoBlocked?'<p class="small" style="color:#ffb36b">Colissimo : rapprochement requis dans la Cbox avant tout nouvel essai.</p>':(!colissimoReady&&o.paymentStatus==="paid"&&!o.colissimoParcelNumber?'<p class="small">Colissimo : clé API / adresse expéditeur / activation réelle à terminer.</p>':""))+'<p class="small" data-status-message></p></article>';
    }).join("") || '<div class="admin-panel">Aucune commande.</div>';
    bind();
  }

  function card(id) { return A.qs('[data-order-card="'+CSS.escape(String(id))+'"]'); }
  function payload(c) { function v(n){ return c.querySelector('[data-field="'+n+'"]')?.value || ""; } return { status:v("status"), carrier:v("carrier"), tracking:v("tracking"), phone:v("phone"), address:v("address"), internalNote:v("internalNote"), shipping:"Standard" }; }

  async function saveOrder(id, btn) {
    var c=card(id),m=c?.querySelector("[data-status-message]");
    if(!c)return;
    var data=payload(c);
    btn.disabled=true;
    try {
      if(data.status==="Expédiée" && data.carrier==="Colissimo (La Poste)" && !String(data.tracking||"").trim()) {
        if(!(colissimo.configured && colissimo.senderConfigured && colissimo.labelPurchasesEnabled)) {
          throw new Error("Colissimo n’est pas encore prêt pour créer une étiquette réelle.");
        }
        var weight=Number(c.querySelector('[data-field="shippingWeightGrams"]')?.value||0);
        if(!Number.isFinite(weight)||weight<1||weight>30000) throw new Error("Saisissez le poids réel du colis entre 1 g et 30 000 g.");
        if(m)m.textContent="Création de l’étiquette Colissimo...";
        var label=await A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/colissimo-label",{method:"POST",body:JSON.stringify({weightGrams:Math.trunc(weight)})});
        if(!label.ok)throw new Error(label.error||"Création Colissimo impossible");
        data.tracking=String(label.trackingNumber||label.parcelNumber||"").trim();
        if(!data.tracking)throw new Error("Colissimo n’a pas retourné de numéro de suivi.");
        var trackingInput=c.querySelector('[data-field="tracking"]');
        if(trackingInput)trackingInput.value=data.tracking;
        if(m)m.textContent="Étiquette créée · suivi "+data.tracking+" · enregistrement de l’expédition...";
      } else if(m) {
        m.textContent="Enregistrement...";
      }

      var d=await A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify(data)});
      if(!d.ok)throw new Error(d.error||"Mise à jour impossible");
      var savedTracking=String(d.order?.tracking||data.tracking||"").trim();
      var msg=savedTracking?"Commande expédiée · suivi "+savedTracking+".":"Commande mise à jour.";
      if(d.emailNotification){
        msg+=d.emailNotification.sent?" Mail de suivi envoyé.":" Mail de suivi non envoyé"+(d.emailNotification.error?": "+d.emailNotification.error:"");
      }
      return reload(id,msg);
    } catch(e) {
      if(m)m.textContent=e.message;
    } finally {
      btn.disabled=false;
    }
  }

  function downloadAdminPdf(path, filename) {
    var token = sessionStorage.getItem("cardoria_session_token") || "";
    if (!token) return Promise.reject(new Error("Session administrateur requise."));
    return fetch(A.BACKEND + path, { headers:{ Authorization:"Bearer " + token }, cache:"no-store" }).then(async function(r){
      if (!r.ok) { var d=await r.json().catch(function(){return {};}); throw new Error(d.error || "Téléchargement impossible."); }
      return r.blob();
    }).then(function(blob){
      var url=URL.createObjectURL(blob), a=document.createElement("a"); a.href=url; a.download=filename||"etiquette-colissimo.pdf"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},1000);
    });
  }

  function reload(id, message) {
    return A.adminFetch("/api/admin/payments/boutique-orders", { cache:"no-store" }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "Chargement impossible");
      orders = d.orders || [];
      if (Array.isArray(d.carriers) && d.carriers.length) CARRIERS = d.carriers;
      if (d.colissimo) colissimo = d.colissimo;
      if (d.email) emailConfig = d.email;
      render();
      var c = id && card(id), box = c && c.querySelector("[data-status-message]"); if (box) box.textContent = message || "Mis à jour.";
    });
  }

  function bind() {
    A.qs("#orderCards").querySelectorAll("button[data-save]").forEach(function (btn) { btn.onclick = function () { return saveOrder(btn.dataset.save,btn); }; });
    A.qs("#orderCards").querySelectorAll("button[data-sync]").forEach(function (btn) { btn.onclick = function () { var id=btn.dataset.sync,c=card(id),m=c?.querySelector("[data-status-message]"); btn.disabled=true; if(m)m.textContent="Synchronisation SumUp..."; A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/sync-sumup",{method:"POST",body:"{}"}).then(function(d){if(!d.ok)throw new Error(d.error||"Synchronisation impossible");return reload(id,"SumUp synchronisé : "+(d.status||"OK"));}).catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;}); }; });
    A.qs("#orderCards").querySelectorAll("button[data-refund]").forEach(function (btn) { btn.onclick = function () { var id=btn.dataset.refund,c=card(id),m=c?.querySelector("[data-status-message]"); if(!confirm("Confirmer le remboursement intégral SumUp de cette commande ?"))return; btn.disabled=true; if(m)m.textContent="Remboursement SumUp..."; A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/refund",{method:"POST",body:"{}"}).then(function(d){if(!d.ok)throw new Error(d.error||"Remboursement impossible");return reload(id,d.status==="refunded"?"Remboursement confirmé. Stock libéré.":"Remboursement demandé. Synchronise SumUp pour confirmer.");}).catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;}); }; });
    A.qs("#orderCards").querySelectorAll("button[data-mail-purchase]").forEach(function (btn) { btn.onclick = function () {
      var id=btn.dataset.mailPurchase,c=card(id),m=c?.querySelector("[data-status-message]");btn.disabled=true;if(m)m.textContent="Envoi du mail d’achat...";
      A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/emails/purchase",{method:"POST",body:"{}"})
        .then(function(d){if(!d.ok)throw new Error(d.error||"Envoi impossible");return reload(id,"Mail d’achat envoyé.");})
        .catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;});
    }; });
    A.qs("#orderCards").querySelectorAll("button[data-mail-tracking]").forEach(function (btn) { btn.onclick = function () {
      var id=btn.dataset.mailTracking,c=card(id),m=c?.querySelector("[data-status-message]");btn.disabled=true;if(m)m.textContent="Envoi du mail de suivi...";
      A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/emails/tracking",{method:"POST",body:"{}"})
        .then(function(d){if(!d.ok)throw new Error(d.error||"Envoi impossible");return reload(id,"Mail de suivi envoyé.");})
        .catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;});
    }; });
    A.qs("#orderCards").querySelectorAll("button[data-colissimo-create]").forEach(function (btn) { btn.onclick = function () {
      var id=btn.dataset.colissimoCreate,c=card(id),m=c?.querySelector("[data-status-message]"),weight=Number(c?.querySelector('[data-field="shippingWeightGrams"]')?.value||0);
      if(!Number.isFinite(weight)||weight<1||weight>30000){if(m)m.textContent="Saisissez le poids réel du colis entre 1 g et 30 000 g.";return;}
      if(!confirm("Créer une étiquette Colissimo réelle pour cette commande ?"))return;
      btn.disabled=true;if(m)m.textContent="Création Colissimo...";
      A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/colissimo-label",{method:"POST",body:JSON.stringify({weightGrams:Math.trunc(weight)})})
        .then(function(d){if(!d.ok)throw new Error(d.error||"Création Colissimo impossible");return reload(id,"Étiquette Colissimo créée : "+(d.parcelNumber||"OK"));})
        .catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;});
    }; });
    A.qs("#orderCards").querySelectorAll("button[data-colissimo-download]").forEach(function (btn) { btn.onclick = function () {
      var id=btn.dataset.colissimoDownload,c=card(id),m=c?.querySelector("[data-status-message]");btn.disabled=true;if(m)m.textContent="Téléchargement Colissimo...";
      downloadAdminPdf("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/colissimo-label","colissimo-"+id+".pdf")
        .then(function(){if(m)m.textContent="Étiquette téléchargée.";}).catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;});
    }; });
    A.qs("#orderCards").querySelectorAll("button[data-doc]").forEach(function (btn) { btn.onclick=function(){window.open("document-commande.html?id="+encodeURIComponent(btn.dataset.doc)+"&type="+encodeURIComponent(btn.dataset.type),"_blank");}; });
  }

  A.renderShell("orders","Commandes Boutique","Cycle complet : paiement SumUp, préparation, transport, livraison et remboursement",
    '<div class="admin-kpi-grid" style="margin-bottom:16px"><div class="admin-kpi"><label>Total commandes</label><strong id="ordersCount">—</strong></div><div class="admin-kpi"><label>À préparer</label><strong id="ordersPrepare">—</strong></div><div class="admin-kpi"><label>Expédiées</label><strong id="ordersShipped">—</strong></div><div class="admin-kpi"><label>CA payé</label><strong id="ordersRevenue">—</strong></div></div>' +
    '<div class="admin-filters"><input id="orderSearch" placeholder="Commande, client, email, suivi..."><button class="btn btn-secondary" data-filter="all">Toutes</button><button class="btn btn-secondary" data-filter="today">Aujourd\'hui</button><button class="btn btn-secondary" data-filter="À préparer">À préparer</button><button class="btn btn-secondary" data-filter="En préparation">En préparation</button><button class="btn btn-secondary" data-filter="Expédiée">Expédiées</button><button class="btn btn-secondary" data-filter="Livrée">Livrées</button><button class="btn btn-secondary" data-filter="Annulée">Annulées</button></div><div id="orderCards"></div>');
  A.qs("#orderSearch").addEventListener("input", render);
  A.qs(".admin-filters").querySelectorAll("button[data-filter]").forEach(function (b) { b.onclick=function(){filter=b.dataset.filter;render();}; });
  reload();
})();
