(function(){
  "use strict";
  var A=window.CardoriaAdmin;
  if(!A)return;
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];});}
  function euro(v){return Number(v||0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});}
  function formatDate(v){if(!v)return"—";var d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString("fr-FR");}
  function root(){return document.querySelector(".admin-main")||document.body;}
  function ensureUi(){
    if(document.getElementById("liveScheduleArchivePanel"))return;
    var panel=document.createElement("section");panel.id="liveScheduleArchivePanel";panel.className="live-schedule-archive live-management-panel";
    panel.innerHTML="<div class='live-schedule-head'><div><h2>Gestion des Lives</h2><p>Crée, programme, sélectionne et archive tes Lives depuis ce menu permanent.</p></div><div class='live-management-actions'><button type='button' id='liveCreateNowBtn' class='btn btn-primary'>Créer un Live</button><button type='button' id='liveScheduleBtn' class='btn'>Programmer un Live</button><button type='button' id='liveShowSessionsBtn' class='btn'>Liste des Lives</button><button type='button' id='liveShowArchivesBtn' class='btn'>Archives</button></div></div><div id='liveScheduleForm' class='live-schedule-form' hidden><label>Titre du Live<input id='liveScheduleTitle' maxlength='160' placeholder='Ex. Live Pokémon du vendredi'></label><label>Date et heure<input id='liveScheduleAt' type='datetime-local'></label><div><button type='button' id='liveScheduleSave' class='btn btn-primary'>Enregistrer</button> <button type='button' id='liveScheduleCancel' class='btn'>Annuler</button></div></div><div class='live-archive-head'><h3>Archives des Lives terminés</h3><button type='button' id='liveArchiveRefresh' class='btn'>Actualiser</button></div><div id='liveArchiveList' class='live-archive-list'>Chargement…</div><div id='liveArchiveDetail' class='live-archive-detail'></div>";
    var controls=document.querySelector("#liveSelectedSession");
    var controlsSection=controls&&controls.closest("section");
    if(controlsSection&&controlsSection.parentNode)controlsSection.parentNode.insertBefore(panel,controlsSection);else root().insertBefore(panel,root().firstChild);
    document.getElementById("liveCreateNowBtn").onclick=function(){
      var title=prompt("Titre du Live :","Live Cardoria");
      if(title===null)return;title=String(title||"").trim();if(!title)return alert("Indique le titre du Live.");
      A.adminFetch("/api/admin/live/sessions",{method:"POST",body:JSON.stringify({title:title,ownerRole:"admin",products:[]})}).then(function(d){
        var id=d&&d.session&&d.session.id||d&&d.id||"";
        if(id)try{sessionStorage.setItem("cardoria_live_selected",id);}catch(e){}
        location.reload();
      }).catch(function(e){alert(e.message);});
    };
    document.getElementById("liveShowSessionsBtn").onclick=function(){var table=document.getElementById("liveBody");if(table)table.scrollIntoView({behavior:"smooth",block:"center"});};
    document.getElementById("liveShowArchivesBtn").onclick=function(){var box=document.getElementById("liveArchiveList");if(box)box.scrollIntoView({behavior:"smooth",block:"start"});};
    document.getElementById("liveScheduleBtn").onclick=function(){document.getElementById("liveScheduleForm").hidden=false;var input=document.getElementById("liveScheduleAt");if(!input.value){var d=new Date(Date.now()+3600000),pad=function(n){return String(n).padStart(2,"0");};input.value=d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());}};
    document.getElementById("liveScheduleCancel").onclick=function(){document.getElementById("liveScheduleForm").hidden=true;};
    document.getElementById("liveScheduleSave").onclick=scheduleLive;
    document.getElementById("liveArchiveRefresh").onclick=loadArchives;
    loadArchives();
  }
  function scheduleLive(){
    var title=String(document.getElementById("liveScheduleTitle").value||"").trim(),raw=document.getElementById("liveScheduleAt").value;
    if(!title)return alert("Indique le titre du Live.");if(!raw)return alert("Choisis la date et l'heure.");
    var d=new Date(raw);if(Number.isNaN(d.getTime()))return alert("Date ou heure invalide.");if(d.getTime()<=Date.now())return alert("La programmation doit être dans le futur.");
    A.adminFetch("/api/admin/live/sessions",{method:"POST",body:JSON.stringify({title:title,ownerRole:"admin",scheduledAt:d.toISOString(),products:[]})}).then(function(){document.getElementById("liveScheduleForm").hidden=true;document.getElementById("liveScheduleTitle").value="";alert("Live programmé pour "+formatDate(d.toISOString())+".");location.reload();}).catch(function(e){alert(e.message);});
  }
  function loadArchives(){
    var list=document.getElementById("liveArchiveList");if(!list)return;list.textContent="Chargement…";
    A.adminFetch("/api/admin/live/archives").then(function(d){var archives=d.archives||[];if(!archives.length){list.innerHTML="<p>Aucune archive Live pour le moment.</p>";return;}list.innerHTML=archives.map(function(a){return "<button type='button' class='live-archive-card' data-archive='"+esc(a.liveId)+"'><strong>"+esc(a.title||a.liveId)+"</strong><span>Fin : "+esc(formatDate(a.endedAt))+"</span><span>"+Number(a.totals&&a.totals.buyers||0)+" acheteur(s) · "+Number(a.totals&&a.totals.paidPurchases||0)+" achat(s) payé(s) · "+euro(a.totals&&a.totals.paidAmount||0)+"</span></button>";}).join("");list.querySelectorAll("[data-archive]").forEach(function(b){b.onclick=function(){openArchive(b.dataset.archive);};});}).catch(function(e){list.textContent=e.message;});
  }
  function openArchive(liveId){A.adminFetch("/api/admin/live/archives/"+encodeURIComponent(liveId)).then(function(d){renderArchive(d.archive);}).catch(function(e){alert(e.message);});}
  function renderArchive(a){
    var box=document.getElementById("liveArchiveDetail");if(!box||!a)return;
    var buyerRows=(a.buyers||[]).map(function(b){var items=(b.paidPurchases||[]).map(function(p){return esc(p.productName)+(p.spotLabel?" — "+esc(p.spotLabel):"")+" × "+Number(p.qty||1)+" ("+euro(p.amount)+")";}).join("<br>")||"Aucun achat payé";return "<tr><td><strong>"+esc(b.pseudo||"Client")+"</strong><br><small>"+esc(b.customerEmail||"")+"</small></td><td>"+items+"</td><td>"+Math.round(Number(b.totalWeightGrams||0))+" g</td><td>"+esc(b.shippingCarrier||"—")+"<br><small>"+esc(b.shippingPackId||"")+"</small></td><td>"+euro(b.totalShippingPaid||0)+"</td><td>"+euro(b.totalPaid||0)+"</td></tr>";}).join("");
    box.innerHTML="<div class='live-archive-title'><div><h3>"+esc(a.title||a.liveId)+"</h3><p>Début : "+esc(formatDate(a.startedAt))+" · Fin : "+esc(formatDate(a.endedAt))+"</p></div><button type='button' id='liveArchiveCsv' class='btn'>Exporter CSV envois</button></div><div class='live-archive-summary'><strong>"+Number(a.totals&&a.totals.buyers||0)+" acheteur(s)</strong><span>"+Number(a.totals&&a.totals.paidPurchases||0)+" achat(s) payé(s)</span><span>Total : "+euro(a.totals&&a.totals.paidAmount||0)+"</span><span>Port encaissé : "+euro(a.totals&&a.totals.shippingAmount||0)+"</span></div><div class='live-archive-table-wrap'><table><thead><tr><th>Pseudo / client</th><th>Achats</th><th>Poids</th><th>Envoi prévu</th><th>Port payé</th><th>Total payé</th></tr></thead><tbody>"+(buyerRows||"<tr><td colspan='6'>Aucun achat payé.</td></tr>")+"</tbody></table></div><p class='live-archive-note'>L'archive conserve aussi les paiements en attente/refusés pour contrôle, mais le tableau d'envoi affiche les achats payés.</p>";
    document.getElementById("liveArchiveCsv").onclick=function(){exportCsv(a);};
  }
  function exportCsv(a){
    var rows=[["Pseudo","Email","Articles","Poids g","Transporteur","Pack","Port paye","Total paye"]];
    (a.buyers||[]).filter(function(b){return(b.paidPurchases||[]).length;}).forEach(function(b){var items=(b.paidPurchases||[]).map(function(p){return p.productName+(p.spotLabel?" - "+p.spotLabel:"")+" x"+(p.qty||1);}).join(" | ");rows.push([b.pseudo||"",b.customerEmail||"",items,b.totalWeightGrams||0,b.shippingCarrier||"",b.shippingPackId||"",b.totalShippingPaid||0,b.totalPaid||0]);});
    var csv=rows.map(function(r){return r.map(function(v){return '"'+String(v==null?"":v).replace(/"/g,'""')+'"';}).join(";");}).join("\n"),blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="archive-live-"+(a.liveId||"cardoria")+".csv";document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  }
  var timer=setInterval(ensureUi,800);document.addEventListener("DOMContentLoaded",ensureUi);ensureUi();window.addEventListener("beforeunload",function(){clearInterval(timer);});
})();
