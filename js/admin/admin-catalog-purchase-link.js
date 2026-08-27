(function(){
  "use strict";
  var A=window.CardoriaAdmin;if(!A)return;
  var STORAGE_KEY="cardoria_purchase_lot_cards";

  function readLot(){try{var v=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");return Array.isArray(v)?v:[];}catch(e){return [];}}
  function writeLot(cards){localStorage.setItem(STORAGE_KEY,JSON.stringify(cards));updateBanner();}
  function clearLot(){localStorage.removeItem(STORAGE_KEY);updateBanner();}
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}

  function ensureBanner(){
    var banner=document.getElementById("cardoriaLotDraft");if(banner)return banner;
    var host=document.querySelector("main")||document.querySelector(".admin-main")||document.body;
    banner=document.createElement("div");banner.id="cardoriaLotDraft";banner.className="admin-panel";banner.style.marginBottom="16px";
    banner.innerHTML='<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><strong>Lot en préparation : <span id="cardoriaLotDraftCount">0</span> carte(s)</strong><button type="button" class="btn btn-primary" id="cardoriaLotFinish">Finaliser le lot</button><button type="button" class="btn btn-secondary" id="cardoriaLotClear">Vider le lot</button></div><small style="color:#baaf97">Le brouillon reste enregistré jusqu’à validation réussie de l’achat.</small><div class="admin-table-wrap" style="margin-top:12px"><table class="admin-table"><thead><tr><th>#</th><th>Carte</th><th>Extension</th><th>Numéro</th><th>Action</th></tr></thead><tbody id="cardoriaLotDraftBody"></tbody></table></div>';
    if(host.firstChild)host.insertBefore(banner,host.firstChild);else host.appendChild(banner);
    document.getElementById("cardoriaLotFinish").onclick=function(){if(!readLot().length)return;location.href="admin-achats-cartes.html?source=lot&packaging=lot_cartes";};
    document.getElementById("cardoriaLotClear").onclick=function(){if(!readLot().length||confirm("Vider le lot en préparation ?"))clearLot();};
    return banner;
  }

  function updateBanner(){
    ensureBanner();
    var cards=readLot(),count=document.getElementById("cardoriaLotDraftCount"),finish=document.getElementById("cardoriaLotFinish"),body=document.getElementById("cardoriaLotDraftBody");
    if(count)count.textContent=String(cards.length);
    if(finish)finish.disabled=cards.length===0;
    if(body){
      body.innerHTML=cards.map(function(c,i){return '<tr><td>'+(i+1)+'</td><td>'+esc(c.name||"Carte Pokémon")+'</td><td>'+esc(c.extension||"—")+'</td><td>'+esc(c.number||"—")+'</td><td><button type="button" class="btn btn-secondary cardoriaLotDraftRemove" data-index="'+i+'">Retirer</button></td></tr>';}).join("")||'<tr><td colspan="5">Aucune carte ajoutée au lot.</td></tr>';
      body.querySelectorAll(".cardoriaLotDraftRemove").forEach(function(btn){btn.onclick=function(){var list=readLot();list.splice(Number(btn.dataset.index),1);writeLot(list);};});
    }
  }

  function cardFromRow(id,button){
    var row=button&&button.closest("tr");
    if(!row)return null;
    var cardCell=row.cells&&row.cells[1],txt=cardCell?cardCell.textContent.trim():"";
    var strong=cardCell&&cardCell.querySelector("strong"),small=cardCell&&cardCell.querySelector("small"),img=row.querySelector("img");
    var meta=small?small.textContent.trim():"";
    var match=meta.match(/^(.*)\s+#([^#]+)$/);
    return {id:String(id),name:strong?strong.textContent.trim():(txt||"Carte Pokémon"),extension:match?match[1].trim():"",number:match?match[2].trim():"",imageThumb:img?String(img.src||""):""};
  }

  async function addToLot(id,button){
    if(!id||!button)return;
    button.disabled=true;var old=button.textContent;button.textContent="Ajout…";
    try{
      var c=cardFromRow(id,button);
      if(!c){
        var d=await A.adminFetch("/api/admin/engine/cards/"+encodeURIComponent(id));
        if(!d.ok||!d.card)throw new Error("Carte introuvable");
        c=d.card;
      }
      var cards=readLot();
      cards.push({id:String(c.id||id),name:String(c.name||"Carte Pokémon"),extension:String(c.extension||""),number:String(c.number||""),imageThumb:String(c.imageThumb||"")});
      writeLot(cards);
      button.textContent="Ajoutée · "+cards.length+" carte(s)";
      setTimeout(function(){button.textContent=old;button.disabled=false;},700);
    }catch(e){button.textContent="Erreur";setTimeout(function(){button.textContent=old;button.disabled=false;},1000);}
  }

  function enhance(){
    updateBanner();var body=document.getElementById("catalogBody");if(!body)return;
    body.querySelectorAll("tr").forEach(function(row){
      var history=row.querySelector("[data-history]");if(!history)return;
      var id=history.getAttribute("data-history"),cell=history.closest("td");if(!id||!cell||cell.querySelector("[data-add-purchase]"))return;
      var unitBtn=document.createElement("button");unitBtn.type="button";unitBtn.className="btn btn-primary";unitBtn.style.marginLeft="6px";unitBtn.textContent="Ajouter aux achats";unitBtn.setAttribute("data-add-purchase",id);unitBtn.onclick=function(e){e.preventDefault();e.stopPropagation();location.href="admin-achats-cartes.html?source=card&id="+encodeURIComponent(id)+"&packaging=carte_unite";};cell.appendChild(unitBtn);
      var lotBtn=document.createElement("button");lotBtn.type="button";lotBtn.className="btn btn-secondary";lotBtn.style.marginLeft="6px";lotBtn.textContent="Ajouter au lot";lotBtn.setAttribute("data-add-purchase-lot",id);lotBtn.onclick=function(e){e.preventDefault();e.stopPropagation();addToLot(id,lotBtn);};cell.appendChild(lotBtn);
    });
  }

  window.addEventListener("storage",function(e){if(e.key===STORAGE_KEY)updateBanner();});
  var observer=new MutationObserver(function(){enhance();});
  function start(){var body=document.getElementById("catalogBody");if(!body){setTimeout(start,150);return;}observer.observe(body,{childList:true,subtree:true});enhance();}
  start();
})();