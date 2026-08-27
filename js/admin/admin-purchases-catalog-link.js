(function(){
  "use strict";
  var A=window.CardoriaAdmin,Store=window.CardoriaLotDraft;
  if(!A||!Store||window.CARDORIA_PURCHASE_MODE!=="pokemon_card")return;
  var pendingLotSubmit=false;

  function qs(id){return document.getElementById(id);}
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function setLabel(inputId,text){var el=qs(inputId);if(!el||!el.parentElement)return;var label=el.parentElement;for(var i=0;i<label.childNodes.length;i++){if(label.childNodes[i].nodeType===3){label.childNodes[i].nodeValue=text;return;}}}
  function draft(){return Store.get();}

  function formSnapshot(){
    var ids=["pDate","pBuyer","pSeller","pDescription","pAmount","pPayment","pStatus","pReference","pNotes"];
    var out={};ids.forEach(function(id){var el=qs(id);if(el)out[id]=el.value;});return out;
  }
  function saveDraftForm(){if(qs("pPackaging")&&qs("pPackaging").value==="lot_cartes")Store.setForm(formSnapshot());}
  function restoreDraftForm(data){Object.keys(data||{}).forEach(function(id){var el=qs(id);if(el&&data[id]!=null)el.value=String(data[id]);});}

  function ensureLotBox(){
    var form=qs("purchaseForm");if(!form||qs("purchaseLotCards"))return;
    var box=document.createElement("div");box.id="purchaseLotCards";box.className="admin-panel";box.style.marginTop="16px";box.hidden=true;
    box.innerHTML='<h3>Cartes du lot</h3><p><strong id="purchaseLotCounter">0 / 0 carte</strong></p><p id="purchaseLotState" style="color:#baaf97">Ajoute exactement le nombre de cartes indiqué.</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Carte</th><th>Extension</th><th>Numéro</th><th>Action</th></tr></thead><tbody id="purchaseLotBody"></tbody></table></div><div class="actions" style="margin-top:12px"><button type="button" class="btn btn-secondary" id="purchaseLotBack">Ajouter des cartes depuis le catalogue</button><button type="button" class="btn btn-secondary" id="purchaseLotClear">Vider le lot</button></div>';
    form.appendChild(box);
    qs("purchaseLotBack").onclick=function(){saveDraftForm();location.href="admin-catalogue.html";};
    qs("purchaseLotClear").onclick=function(){if(confirm("Vider toutes les cartes et le brouillon du lot ?")){Store.clear();if(qs("pQty"))qs("pQty").value="1";renderLot();}};
  }

  function renderLot(){
    ensureLotBox();var box=qs("purchaseLotCards"),packaging=qs("pPackaging");if(!box||!packaging)return;
    var isLot=packaging.value==="lot_cartes";box.hidden=!isLot;
    var submit=qs("purchaseForm")&&qs("purchaseForm").querySelector('button[type="submit"]');
    if(!isLot){if(submit)submit.disabled=false;return;}
    var d=draft(),expected=Math.max(1,Number(qs("pQty").value||d.targetQty||1)),cards=d.cards||[],counter=qs("purchaseLotCounter"),state=qs("purchaseLotState"),body=qs("purchaseLotBody");
    if(counter)counter.textContent=cards.length+" / "+expected+" carte(s)";
    if(state){
      if(cards.length===expected){state.textContent="Lot complet : tu peux valider l’achat.";state.style.color="#6bd98f";}
      else if(cards.length<expected){state.textContent="Il manque "+(expected-cards.length)+" carte(s). Validation impossible.";state.style.color="#ffcc66";}
      else{state.textContent="Il y a "+(cards.length-expected)+" carte(s) en trop. Validation impossible.";state.style.color="#ff7373";}
    }
    if(submit)submit.disabled=cards.length!==expected;
    if(body)body.innerHTML=cards.map(function(c,i){return '<tr><td>'+(i+1)+'</td><td>'+esc(c.name||"Carte Pokémon")+'</td><td>'+esc(c.extension||"—")+'</td><td>'+esc(c.number||"—")+'</td><td><button type="button" class="btn btn-secondary lotRemove" data-index="'+i+'">Retirer</button></td></tr>';}).join("")||'<tr><td colspan="5">Aucune carte ajoutée au lot.</td></tr>';
    if(body)body.querySelectorAll(".lotRemove").forEach(function(btn){btn.onclick=function(){Store.removeAt(Number(btn.dataset.index));renderLot();};});
  }

  function activateLot(targetQty){
    var qty=Math.max(1,Number(targetQty)||1);Store.begin(qty,formSnapshot());if(qs("pPackaging"))qs("pPackaging").value="lot_cartes";if(qs("pQty"))qs("pQty").value=String(qty);updateLotLabels();
  }

  function updateLotLabels(){
    var packaging=qs("pPackaging");if(!packaging)return;
    if(packaging.value==="lot_cartes"){
      setLabel("pQty","Nombre exact de cartes dans le lot");setLabel("pAmount","Prix total du lot (€)");
      var qty=Math.max(1,Number(qs("pQty").value||draft().targetQty||1));Store.begin(qty,formSnapshot());
    }else if(packaging.value==="carte_unite"){
      setLabel("pQty","Nombre de cartes");setLabel("pAmount","Montant total (€)");
    }else{
      setLabel("pQty","Quantité achetée");setLabel("pAmount","Prix total (€)");
    }
    renderLot();
  }

  function fillCommon(data){
    if(qs("pDescription"))qs("pDescription").value=data.description||"";
    if(qs("pReference"))qs("pReference").value=data.reference||"";
    if(qs("pPackaging"))qs("pPackaging").value=data.packaging||"carte_unite";
    if(qs("pQty"))qs("pQty").value=String(data.quantity||1);
    if(qs("pNotes")&&data.notes)qs("pNotes").value=data.notes;
    updateLotLabels();
    var form=qs("purchaseForm");if(form)form.scrollIntoView({behavior:"smooth",block:"start"});
  }

  async function prefillFromUrl(){
    var params=new URLSearchParams(location.search),source=params.get("source"),id=params.get("id"),requestedPackaging=params.get("packaging"),d=draft();
    try{
      if(source==="lot"){
        var qty=d.targetQty||d.cards.length||1;restoreDraftForm(d.form);activateLot(qty);return;
      }
      if(source==="card"&&id){
        var response=await A.adminFetch("/api/admin/engine/cards/"+encodeURIComponent(id));
        if(response.ok&&response.card){var c=response.card,packaging=requestedPackaging==="lot_cartes"?"lot_cartes":"carte_unite";fillCommon({description:(c.name||"Carte Pokémon")+(c.extension?" — "+c.extension:"")+(c.number?" #"+c.number:""),reference:"catalog-card:"+c.id,packaging:packaging,quantity:1,notes:packaging==="lot_cartes"?"Lot créé depuis le catalogue de référence Cardoria.":"Ajouté depuis le catalogue de référence Cardoria."});}
        return;
      }
      if(!source&&d.active){restoreDraftForm(d.form);activateLot(d.targetQty||d.cards.length||1);}
    }catch(e){}
  }

  function installSubmitGuard(){
    var form=qs("purchaseForm");if(!form||form.dataset.lotGuard)return;form.dataset.lotGuard="1";
    form.addEventListener("submit",function(e){
      pendingLotSubmit=false;
      if(qs("pPackaging")&&qs("pPackaging").value==="lot_cartes"){
        saveDraftForm();var d=draft(),cards=d.cards||[],expected=Math.max(1,Number(qs("pQty").value||d.targetQty||1));
        Store.setTarget(expected);
        if(cards.length!==expected){e.preventDefault();e.stopImmediatePropagation();var msg=qs("pMessage");if(msg)msg.textContent="Impossible de valider : le lot doit contenir exactement "+expected+" carte(s), actuellement "+cards.length+".";renderLot();return;}
        var refs=cards.map(function(c){return c.id;}),notes=qs("pNotes");
        if(notes){var cleaned=(notes.value||"").replace(/\n?\[LOT_CARDS\][\s\S]*$/m,"").trim();notes.value=cleaned+(cleaned?"\n":"")+"[LOT_CARDS] "+JSON.stringify(refs);}
        pendingLotSubmit=true;
      }
    },true);
  }

  function watchSuccess(){
    var msg=qs("pMessage");if(!msg||msg.dataset.lotWatch)return;msg.dataset.lotWatch="1";
    new MutationObserver(function(){var text=msg.textContent.trim();if(text==="Achat enregistré."&&pendingLotSubmit){Store.clear();pendingLotSubmit=false;renderLot();}else if(text&&text!=="Achat enregistré."){pendingLotSubmit=false;}}).observe(msg,{childList:true,characterData:true,subtree:true});
  }

  function installPersistence(){
    var form=qs("purchaseForm");if(!form)return;
    form.addEventListener("input",function(){if(qs("pPackaging").value==="lot_cartes")saveDraftForm();});
    form.addEventListener("change",function(){if(qs("pPackaging").value==="lot_cartes")saveDraftForm();});
    window.addEventListener("cardoria:lot-draft-change",renderLot);
  }

  function start(){
    var packaging=qs("pPackaging");if(!packaging){setTimeout(start,100);return;}
    ensureLotBox();packaging.addEventListener("change",updateLotLabels);qs("pQty").addEventListener("input",function(){if(packaging.value==="lot_cartes")Store.setTarget(Math.max(1,Number(qs("pQty").value)||1));renderLot();});installSubmitGuard();watchSuccess();installPersistence();prefillFromUrl().then(updateLotLabels);
  }
  start();
})();