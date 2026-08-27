(function(){
  "use strict";
  var A=window.CardoriaAdmin,Store=window.CardoriaLotDraft;
  if(!A||!Store)return;

  function cardFromRow(id,button){
    var row=button&&button.closest("tr");
    if(!row)return null;
    var cardCell=row.cells&&row.cells[1],strong=cardCell&&cardCell.querySelector("strong"),small=cardCell&&cardCell.querySelector("small"),img=row.querySelector("img");
    var meta=small?small.textContent.trim():"",match=meta.match(/^(.*)\s+#([^#]+)$/);
    return {id:String(id),name:strong?strong.textContent.trim():"Carte Pokémon",extension:match?match[1].trim():"",number:match?match[2].trim():"",imageThumb:img?String(img.src||""):""};
  }

  function addToLot(id,button){
    if(!id||!button)return;
    var card=cardFromRow(id,button);
    if(!card)return;
    var draft=Store.addCard(card),old=button.textContent;
    button.disabled=true;
    button.textContent="Ajoutée au lot ("+draft.cards.length+")";
    setTimeout(function(){button.textContent=old;button.disabled=false;},850);
  }

  function enhance(){
    var body=document.getElementById("catalogBody");if(!body)return;
    body.querySelectorAll("tr").forEach(function(row){
      var history=row.querySelector("[data-history]");if(!history)return;
      var id=history.getAttribute("data-history"),cell=history.closest("td");if(!id||!cell||cell.querySelector("[data-add-purchase]"))return;
      var unitBtn=document.createElement("button");unitBtn.type="button";unitBtn.className="btn btn-primary";unitBtn.style.marginLeft="6px";unitBtn.textContent="Ajouter aux achats";unitBtn.setAttribute("data-add-purchase",id);unitBtn.onclick=function(e){e.preventDefault();e.stopPropagation();location.href="admin-achats-cartes.html?source=card&id="+encodeURIComponent(id)+"&packaging=carte_unite";};cell.appendChild(unitBtn);
      var lotBtn=document.createElement("button");lotBtn.type="button";lotBtn.className="btn btn-secondary";lotBtn.style.marginLeft="6px";lotBtn.textContent="Ajouter au lot";lotBtn.setAttribute("data-add-purchase-lot",id);lotBtn.onclick=function(e){e.preventDefault();e.stopPropagation();addToLot(id,lotBtn);};cell.appendChild(lotBtn);
    });
  }

  var observer=new MutationObserver(enhance);
  function start(){var body=document.getElementById("catalogBody");if(!body){setTimeout(start,150);return;}observer.observe(body,{childList:true,subtree:true});enhance();}
  start();
})();