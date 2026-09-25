(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var orders = [];
  var filter = "all";
  var colissimo = { configured:false, senderConfigured:false, labelPurchasesEnabled:false, productCode:"DOM" };
  var colissimoMessage = "";
  var emailConfig = { configured:false, missingReason:"" };
  var CARRIERS = ["Colissimo (La Poste)", "La Poste", "Mondial Relay", "Relais Colis"];
  var STATUSES = ["À préparer", "En préparation", "Prête à expédier", "Expédiée", "Livrée", "Annulée"];
  var creatingLabels = Object.create(null);

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
  function euro(v) { return Number(v || 0).toFixed(2).replace(".", ",") + " €"; }
  function total(o) { return Number(o.total || (o.items || []).reduce(function (s, i) { return s + Number(i.qty || 1) * Number(i.price || 0); }, 0)); }
  function paymentLabel(o) { return ({paid:"Payé",pending:"En attente",failed:"Échoué",refunded:"Remboursé"})[o.paymentStatus] || o.payment || "—"; }
  function paymentClass(o) { return o.paymentStatus === "paid" ? "admin-badge--ok" : (o.paymentStatus === "failed" || o.paymentStatus === "refunded") ? "admin-badge--danger" : "admin-badge--gold"; }
  function options(values, current, emptyLabel) { var out = emptyLabel ? '<option value="">'+esc(emptyLabel)+'</option>' : ""; return out + values.map(function (v) { return '<option value="'+esc(v)+'"'+(v===current?' selected':'')+'>'+esc(v)+'</option>'; }).join(""); }
  function emailLabel(state) { if(!state)return "Non envoyé"; if(state.status==="sent")return "Envoyé"; if(state.status==="failed")return "Échec"; if(state.status==="sending")return "En cours"; return "Non envoyé"; }
  function emailColor(state) { return state?.status==="sent"?"#7fd59b":state?.status==="failed"?"#ff8f8f":"#baaf97"; }
  function fmtDate(value) { if (!value) return "—"; var d = new Date(value); return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString("fr-FR"); }
  function isRelay(o) { return String(o.shippingMethod || o.shipping || "").toLowerCase().indexOf("mondial") >= 0 || String(o.carrier || "").toLowerCase().indexOf("mondial") >= 0 || !!(o.pickupPoint && o.pickupPoint.id); }
  function trackingUrl(carrier, tracking) {
    var t = String(tracking || "").trim(); if (!t) return "";
    var c = String(carrier || "").toLowerCase();
    var q = encodeURIComponent(t);
    if (c.indexOf("mondial") >= 0) return "https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=" + q;
    if (c.indexOf("relais colis") >= 0) return "https://www.relaiscolis.com/suivi-de-colis/?search=" + q;
    if (c.indexOf("colissimo") >= 0 || c.indexOf("la poste") >= 0) return "https://www.laposte.fr/outils/suivre-vos-envois?code=" + q;
    return oTrackingFallback(c, q);
  }
  function oTrackingFallback(c, q) {
    if (c.indexOf("chronopost") >= 0) return "https://www.chronopost.fr/fr/suivi-colis?listeNumerosLT=" + q;
    return "";
  }
  function pickupText(o) {
    var p = o.pickupPoint || {};
    if (!p.id) return "";
    return [p.name, p.id ? "n° " + p.id : "", p.address, [p.postalCode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(" — ");
  }
  function shippingMethodLabel(o) {
    if (isRelay(o)) return "Point Relais";
    if (String(o.shippingMethod || "").indexOf("colissimo") >= 0 || String(o.carrier || "").indexOf("Colissimo") >= 0) return "Domicile";
    return o.shipping || "Livraison";
  }
  function weightHint(o) {
    var items = o.items || [];
    var missing = [];
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      var grams = Math.trunc(Number(items[i].shippingWeightGrams));
      if (!Number.isFinite(grams) || grams < 1) missing.push(items[i].name || items[i].ref || "article");
      else sum += grams * Math.max(1, Number(items[i].qty) || 1);
    }
    if (items.length && !missing.length) return { grams: sum, known: true, source: "articles" };
    if (Number(o.shippingWeightGrams) >= 1) return { grams: Math.trunc(Number(o.shippingWeightGrams)), known: true, source: o.weightSource || "saisi" };
    return { grams: null, known: false, source: "inconnu" };
  }

  function statusSteps(current) {
    if (current === "Annulée") return '<span class="active">Annulée</span>';
    var steps = ["À préparer","En préparation","Prête à expédier","Expédiée","Livrée"], idx = steps.indexOf(current);
    return steps.map(function (s, i) { return '<span class="'+(i<=idx?"active":"")+'">'+esc(s)+'</span>'; }).join("");
  }

  function section(title, body) {
    return '<section class="admin-order-section"><h4>'+esc(title)+'</h4>'+body+"</section>";
  }

  function colissimoButtonLabel() {
    if (!colissimo.configured) return "Clé API Colissimo non configurée";
    if (!colissimo.senderConfigured) return "Adresse expéditeur Colissimo à renseigner";
    if (!colissimo.labelPurchasesEnabled) return "Configuration Colissimo en attente";
    return "Créer l’étiquette";
  }

  function render() {
    var q = (A.qs("#orderSearch")?.value || "").toLowerCase();
    var list = orders.filter(function (o) {
      var matchesFilter = filter === "all" || (filter === "today" ? o.date === new Date().toISOString().slice(0,10) : o.status === filter);
      var hay = JSON.stringify([o.id,o.client,o.email,o.phone,o.status,o.tracking,o.carrier,o.pickupPoint]).toLowerCase();
      return matchesFilter && hay.includes(q);
    });

    A.qs("#ordersCount").textContent = String(orders.length);
    A.qs("#ordersPrepare").textContent = String(orders.filter(function (o) { return o.status === "À préparer" || o.status === "Prête à expédier"; }).length);
    A.qs("#ordersShipped").textContent = String(orders.filter(function (o) { return o.status === "Expédiée"; }).length);
    A.qs("#ordersRevenue").textContent = euro(orders.filter(function (o) { return o.paymentStatus === "paid"; }).reduce(function (s,o) { return s + total(o); }, 0));

    A.qs("#orderCards").innerHTML = list.map(function (o) {
      var canRefund = o.paymentStatus === "paid" && !!(o.sumupCheckoutId || o.sumupTransactionId);
      var colissimoReady = !!(colissimo.configured && colissimo.senderConfigured && colissimo.labelPurchasesEnabled);
      var colissimoAttempt = o.colissimoLabelAttempt && o.colissimoLabelAttempt.status || "";
      var colissimoBlocked = colissimoAttempt === "reconciliation_required";
      var colissimoPending = colissimoAttempt === "creation_pending" || creatingLabels[o.id];
      var purchaseMail = o.purchaseEmail || null, trackingMail = o.trackingEmail || null;
      var relay = isRelay(o);
      var tracking = o.tracking||o.colissimoParcelNumber||"";
      var followUrl = o.trackingUrl || trackingUrl(o.carrier, tracking);
      var weight = weightHint(o);
      var pickup = pickupText(o);
      var items = (o.items || []).map(function (i) { return '<tr><td>'+esc(i.name||i.ref)+'</td><td>'+Number(i.qty||1)+'</td><td>'+euro(i.price)+'</td><td>'+euro(Number(i.qty||1)*Number(i.price||0))+'</td></tr>'; }).join("") || '<tr><td colspan="4">Aucun article</td></tr>';
      var legacyCarrier = o.carrier && CARRIERS.indexOf(o.carrier) < 0 ? [o.carrier].concat(CARRIERS) : CARRIERS;
      var review = o.paymentReviewRequired ? '<div class="admin-panel" style="margin:10px 0;border-color:#b44"><strong style="color:#ff8f8f">Remboursement SumUp à confirmer</strong><br><small>Le stock reste bloqué jusqu’à confirmation du remboursement.</small></div>' : "";
      var createDisabled = !colissimoReady || colissimoBlocked || colissimoPending || !weight.known || o.paymentStatus !== "paid" || relay;
      var createLabel = colissimoPending ? "Création d’étiquette en cours…" : colissimoButtonLabel();
      var waitNote = "";
      if (relay) waitNote = tracking
        ? '<p class="small">Mondial Relay : suivi enregistré par le parcours d’expédition.</p>'
        : '<p class="small">Mondial Relay : l’Admin ne crée pas d’étiquette et ne contacte pas Sendcloud. Le suivi apparaîtra ici lorsqu’il aura été enregistré par le parcours d’expédition.</p>';
      else if (colissimoBlocked) waitNote = '<p class="small" style="color:#ffb36b">Colissimo : rapprochement requis dans la Cbox avant tout nouvel essai.</p>';
      else if (!colissimoReady && o.paymentStatus==="paid" && !o.colissimoParcelNumber) waitNote = '<p class="small">'+esc(colissimoMessage || colissimoButtonLabel())+'</p>';
      else if (!weight.known && o.paymentStatus==="paid" && !relay) waitNote = '<p class="small">Poids du colis inconnu : renseignez-le avant de créer une étiquette.</p>';

      var clientBox = section("Client",
        '<p><strong>'+esc(o.client||"Client")+'</strong><br>'+esc(o.email||"")+(o.phone?'<br>'+esc(o.phone):"")+'</p>');
      var paymentBox = section("Paiement",
        '<p><span class="admin-badge '+paymentClass(o)+'">'+esc(paymentLabel(o))+'</span><br><small>Montant : '+euro(total(o))+'</small><br><small>Stock : '+esc((o.stockImpact && o.stockImpact.label) || "—")+'</small></p>');
      var itemsBox = section("Articles",
        '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Article</th><th>Qté</th><th>PU</th><th>Total</th></tr></thead><tbody>'+items+'</tbody></table></div>');
      var deliveryBox = section("Livraison",
        '<p><small>Méthode</small><br><strong>'+esc(shippingMethodLabel(o))+'</strong></p>'+
        (relay
          ? '<p><small>Point Relais</small><br>'+esc(pickup || "Point Relais manquant")+'</p>'
          : '<p><small>Adresse</small><br>'+esc(o.address||"—")+'</p>'));
      var expeditionBox = section("Expédition",
        '<div class="admin-form-grid">'+
          '<label>Statut de préparation<select data-field="status">'+options(STATUSES.indexOf(o.status)<0 && o.status ? [o.status].concat(STATUSES) : STATUSES,o.status)+'</select></label>'+
          '<label>Transporteur<select data-field="carrier">'+options(legacyCarrier,o.carrier||"","Choisir")+'</select></label>'+
          '<label>Numéro de suivi<input data-field="tracking" value="'+esc(tracking)+'" readonly placeholder="Enregistré par le parcours d’expédition"></label>'+
          '<label>Poids du colis (g)<input data-field="shippingWeightGrams" type="number" min="1" max="30000" step="1" value="'+esc(o.shippingWeightGrams||(weight.known?weight.grams:""))+'" placeholder="'+(weight.known?"Calculé : "+weight.grams:"Ex. 250")+'"></label>'+
          '<label>Téléphone<input data-field="phone" value="'+esc(o.phone||"")+'"></label>'+
          '<label class="admin-form-wide">Adresse de livraison<textarea data-field="address" rows="3">'+esc(o.address||"")+'</textarea></label>'+
        '</div>'+
        '<p class="small">Statut expédition : <strong>'+esc(o.shipmentStatus || "—")+'</strong> · Date d’expédition : <strong>'+fmtDate(o.shippedAt)+'</strong>'+(weight.known?' · Poids : '+weight.grams+' g':"")+'</p>'+
        '<input type="hidden" data-field="shipping" value="'+esc(o.shipping || shippingMethodLabel(o))+'">'+
        '<input type="hidden" data-field="shippingMethod" value="'+esc(o.shippingMethod || (relay?"mondial_relay":"colissimo_home"))+'">');
      var followBox = section("Suivi",
        '<p><small>E-mails client</small><br>Confirmation achat : <span style="color:'+emailColor(purchaseMail)+'">'+esc(emailLabel(purchaseMail))+'</span>'+(purchaseMail?.sentAt?' · '+esc(new Date(purchaseMail.sentAt).toLocaleString("fr-FR")):'')+'<br>Suivi expédition : <span style="color:'+emailColor(trackingMail)+'">'+esc(emailLabel(trackingMail))+'</span>'+(trackingMail?.sentAt?' · '+esc(new Date(trackingMail.sentAt).toLocaleString("fr-FR")):'')+'</p>'+
        (emailConfig.configured?'':'<p class="small" style="color:#ffb36b">SMTP : '+esc(emailConfig.missingReason||"non configuré")+'</p>')+
        (followUrl?'<p><a class="btn btn-secondary" href="'+esc(followUrl)+'" target="_blank" rel="noopener noreferrer">Lien de suivi</a></p>':'<p class="small">Le lien de suivi apparaîtra dès qu’un numéro sera enregistré.</p>')+
        '<label class="admin-form-wide">Note interne<textarea data-field="internalNote" rows="3">'+esc(o.internalNote||"")+'</textarea></label>');

      var actions = '<div class="actions admin-order-actions">'+
        '<button type="button" class="btn btn-primary" data-save="'+esc(o.id)+'">Enregistrer</button> '+
        (o.paymentStatus==="paid" && o.status!=="Expédiée" && o.status!=="Livrée" && o.status!=="Annulée"?'<button type="button" class="btn btn-secondary" data-mark-shipped="'+esc(o.id)+'">Marquer comme expédiée</button> ':'')+
        (o.sumupCheckoutId?'<button type="button" class="btn btn-secondary" data-sync="'+esc(o.id)+'">Synchroniser SumUp</button> ':'')+
        (canRefund?'<button type="button" class="btn btn-secondary" data-refund="'+esc(o.id)+'">Rembourser SumUp</button> ':'')+
        (o.paymentStatus==="paid"?'<button type="button" class="btn btn-secondary" data-mail-purchase="'+esc(o.id)+'">Renvoyer mail achat</button> ':'')+
        (o.status==="Expédiée"&&o.carrier&&o.tracking?'<button type="button" class="btn btn-secondary" data-mail-tracking="'+esc(o.id)+'">Renvoyer mail suivi</button> ':'')+
        (o.colissimoParcelNumber
          ? '<button type="button" class="btn btn-secondary" data-colissimo-download="'+esc(o.id)+'">Télécharger l’étiquette existante</button> <button type="button" class="btn btn-secondary" data-colissimo-print="'+esc(o.id)+'">Imprimer</button> '
          : "")+
        '<button type="button" class="btn btn-secondary" data-doc="'+esc(o.id)+'" data-type="bon">Bon commande</button> <button type="button" class="btn btn-secondary" data-doc="'+esc(o.id)+'" data-type="facture">Facture</button>'+
      "</div>";

      return '<article class="request-card admin-order-card" data-order-card="'+esc(o.id)+'">' +
        '<div class="request-head"><div><h3>'+esc(o.id)+'</h3><p>'+esc(o.date||"")+' • '+esc(o.client||"Client")+'</p></div><div style="text-align:right"><strong>'+euro(total(o))+'</strong><br><span class="admin-badge '+paymentClass(o)+'">'+esc(paymentLabel(o))+'</span></div></div>' +
        '<div class="progress">'+statusSteps(o.status)+'</div>'+review+
        '<div class="admin-order-grid">'+clientBox+paymentBox+itemsBox+deliveryBox+expeditionBox+followBox+'</div>'+
        actions+waitNote+'<p class="small" data-status-message></p></article>';
    }).join("") || '<div class="admin-panel">Aucune commande.</div>';
    bind();
  }

  function card(id) { return A.qs('[data-order-card="'+CSS.escape(String(id))+'"]'); }
  function payload(c) { function v(n){ return c.querySelector('[data-field="'+n+'"]')?.value || ""; } return { status:v("status"), carrier:v("carrier"), tracking:v("tracking"), phone:v("phone"), address:v("address"), internalNote:v("internalNote"), shipping:v("shipping")||"Standard", shippingMethod:v("shippingMethod"), shippingWeightGrams:v("shippingWeightGrams") }; }

  async function saveOrder(id, btn) {
    var c=card(id),m=c?.querySelector("[data-status-message]");
    if(!c)return;
    var data=payload(c);
    btn.disabled=true;
    try {
      if(m)m.textContent="Enregistrement...";
      var d=await A.adminFetch("/api/admin/payments/boutique-orders/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify(data)});
      if(!d.ok)throw new Error(d.error||"Mise à jour impossible");
      var savedTracking=String(d.order?.tracking||data.tracking||"").trim();
      var msg=data.status==="Expédiée"?(savedTracking?"Commande expédiée · suivi "+savedTracking+".":"Commande expédiée."):"Commande mise à jour.";
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

  function downloadAdminPdf(path, filename, printAfter) {
    var token = sessionStorage.getItem("cardoria_session_token") || "";
    if (!token) return Promise.reject(new Error("Session administrateur requise."));
    return fetch(A.BACKEND + path, { headers:{ Authorization:"Bearer " + token }, cache:"no-store" }).then(async function(r){
      if (!r.ok) { var d=await r.json().catch(function(){return {};}); throw new Error(d.error || "Téléchargement impossible."); }
      return r.blob();
    }).then(function(blob){
      var url=URL.createObjectURL(blob);
      if (printAfter) {
        var frame=document.createElement("iframe");
        frame.style.display="none";
        frame.src=url;
        document.body.appendChild(frame);
        frame.onload=function(){ try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (_) {} setTimeout(function(){ frame.remove(); URL.revokeObjectURL(url); }, 1500); };
        return;
      }
      var a=document.createElement("a"); a.href=url; a.download=filename||"etiquette-colissimo.pdf"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},1000);
    });
  }

  function reload(id, message) {
    return A.adminFetch("/api/admin/payments/boutique-orders", { cache:"no-store" }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "Chargement impossible");
      orders = d.orders || [];
      if (Array.isArray(d.carriers) && d.carriers.length) CARRIERS = d.carriers;
      if (Array.isArray(d.statuses) && d.statuses.length) STATUSES = d.statuses;
      if (d.colissimo) colissimo = d.colissimo;
      colissimoMessage = d.colissimoMessage || "";
      if (d.email) emailConfig = d.email;
      render();
      var c = id && card(id), box = c && c.querySelector("[data-status-message]"); if (box) box.textContent = message || "Mis à jour.";
    });
  }

  function bind() {
    A.qs("#orderCards").querySelectorAll("button[data-save]").forEach(function (btn) { btn.onclick = function () { return saveOrder(btn.dataset.save,btn); }; });
    A.qs("#orderCards").querySelectorAll("button[data-mark-shipped]").forEach(function (btn) { btn.onclick = function () {
      var c=card(btn.dataset.markShipped), status=c?.querySelector('[data-field="status"]'), carrier=c?.querySelector('[data-field="carrier"]'), tracking=c?.querySelector('[data-field="tracking"]'), m=c?.querySelector("[data-status-message]");
      if (!String(carrier?.value||"").trim() || !String(tracking?.value||"").trim()) { if(m)m.textContent="Transporteur et numéro de suivi obligatoires pour marquer comme expédiée."; return; }
      if (status) status.value="Expédiée";
      return saveOrder(btn.dataset.markShipped, btn);
    }; });
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
    A.qs("#orderCards").querySelectorAll("button[data-colissimo-download]").forEach(function (btn) { btn.onclick = function () {
      var id=btn.dataset.colissimoDownload,c=card(id),m=c?.querySelector("[data-status-message]");btn.disabled=true;if(m)m.textContent="Téléchargement Colissimo...";
      downloadAdminPdf("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/colissimo-label","colissimo-"+id+".pdf")
        .then(function(){if(m)m.textContent="Étiquette téléchargée.";}).catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;});
    }; });
    A.qs("#orderCards").querySelectorAll("button[data-colissimo-print]").forEach(function (btn) { btn.onclick = function () {
      var id=btn.dataset.colissimoPrint,c=card(id),m=c?.querySelector("[data-status-message]");btn.disabled=true;if(m)m.textContent="Impression Colissimo...";
      downloadAdminPdf("/api/admin/payments/boutique-orders/"+encodeURIComponent(id)+"/colissimo-label","colissimo-"+id+".pdf",true)
        .then(function(){if(m)m.textContent="Impression envoyée.";}).catch(function(e){if(m)m.textContent=e.message;}).finally(function(){btn.disabled=false;});
    }; });
    A.qs("#orderCards").querySelectorAll("button[data-doc]").forEach(function (btn) { btn.onclick=function(){window.open("document-commande.html?id="+encodeURIComponent(btn.dataset.doc)+"&type="+encodeURIComponent(btn.dataset.type),"_blank");}; });
  }

  A.renderShell("orders","Commandes Boutique","Cycle complet : paiement SumUp, préparation, transport, livraison et remboursement",
    '<div class="admin-kpi-grid" style="margin-bottom:16px"><div class="admin-kpi"><label>Total commandes</label><strong id="ordersCount">—</strong></div><div class="admin-kpi"><label>À préparer</label><strong id="ordersPrepare">—</strong></div><div class="admin-kpi"><label>Expédiées</label><strong id="ordersShipped">—</strong></div><div class="admin-kpi"><label>CA payé</label><strong id="ordersRevenue">—</strong></div></div>' +
    '<div class="admin-filters"><input id="orderSearch" placeholder="Commande, client, email, suivi..."><button class="btn btn-secondary" data-filter="all">Toutes</button><button class="btn btn-secondary" data-filter="today">Aujourd\'hui</button><button class="btn btn-secondary" data-filter="À préparer">À préparer</button><button class="btn btn-secondary" data-filter="En préparation">En préparation</button><button class="btn btn-secondary" data-filter="Prête à expédier">Prêtes à expédier</button><button class="btn btn-secondary" data-filter="Expédiée">Expédiées</button><button class="btn btn-secondary" data-filter="Livrée">Livrées</button><button class="btn btn-secondary" data-filter="Annulée">Annulées</button></div><div id="orderCards"></div>');
  A.qs("#orderSearch").addEventListener("input", render);
  A.qs(".admin-filters").querySelectorAll("button[data-filter]").forEach(function (b) { b.onclick=function(){filter=b.dataset.filter;render();}; });
  reload();
})();
