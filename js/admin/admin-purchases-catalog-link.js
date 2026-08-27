(function(){
  "use strict";
  var A=window.CardoriaAdmin;
  if(!A||window.CARDORIA_PURCHASE_MODE!=="pokemon_card")return;

  function qs(id){return document.getElementById(id);}
  function setLabel(inputId,text){var el=qs(inputId);if(!el||!el.parentElement)return;var label=el.parentElement;for(var i=0;i<label.childNodes.length;i++){if(label.childNodes[i].nodeType===3){label.childNodes[i].nodeValue=text;return;}}}
  function updateLotLabels(){
    var packaging=qs("pPackaging");if(!packaging)return;
    if(packaging.value==="lot_cartes"){
      setLabel("pQty","Nombre de cartes dans le lot");
      setLabel("pAmount","Prix total du lot (€)");
      if(qs("pQty"))qs("pQty").min="1";
    }else if(packaging.value==="carte_unite"){
      setLabel("pQty","Nombre de cartes");
      setLabel("pAmount","Montant total (€)");
    }else{
      setLabel("pQty","Quantité achetée");
      setLabel("pAmount","Prix total (€)");
    }
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
    var params=new URLSearchParams(location.search),source=params.get("source"),id=params.get("id"),requestedPackaging=params.get("packaging");
    if(!source||!id)return;
    try{
      if(source==="card"){
        var d=await A.adminFetch("/api/admin/engine/cards/"+encodeURIComponent(id));
        if(d.ok&&d.card){
          var c=d.card,packaging=requestedPackaging==="lot_cartes"?"lot_cartes":"carte_unite";
          fillCommon({description:(c.name||"Carte Pokémon")+(c.extension?" — "+c.extension:"")+(c.number?" #"+c.number:""),reference:"catalog-card:"+c.id,packaging:packaging,quantity:1,notes:packaging==="lot_cartes"?"Lot créé depuis le catalogue de référence Cardoria.":"Ajouté depuis le catalogue de référence Cardoria."});
        }
      }else if(source==="sealed"){
        var s=await A.adminFetch("/api/admin/catalog/sealed-references");
        var r=(s.references||[]).find(function(x){return x.id===id;});
        if(r)fillCommon({description:(r.name||"Produit scellé")+(r.extension?" — "+r.extension:""),reference:"catalog-sealed:"+r.id,packaging:r.packaging||"other",quantity:1,notes:"Ajouté depuis les références de produits scellés Cardoria."});
      }
    }catch(e){}
  }
  function start(){
    var packaging=qs("pPackaging");
    if(!packaging){setTimeout(start,100);return;}
    packaging.addEventListener("change",updateLotLabels);
    updateLotLabels();
    prefillFromUrl();
  }
  start();
})();