(function(){
  "use strict";
  var A=window.CardoriaAdmin;if(!A)return;
  var editing=null,current=[];
  var PRICE_MARKER=/\[SALE_PRICE\]\s*([0-9]+(?:[.,][0-9]+)?)/i;
  var PACKAGING=[
    ["booster","Booster"],["blister","Blister"],["duopack","Duo pack"],["tripack","Tripack"],["quadpack","Quad pack"],
    ["bundle","Bundle"],["mini_bundle","Mini bundle"],["demi_display","Demi-display"],["display","Display"],["case_display","Case de displays"],
    ["etb","ETB"],["etb_pokemon_center","ETB Pokémon Center"],["upc","UPC"],["coffret","Coffret"],["collection_box","Collection box"],
    ["tin","Tin"],["pokebox","Pokébox"],["mini_tin","Mini Tin"],["build_battle","Build & Battle"],["build_battle_stadium","Build & Battle Stadium"],
    ["deck","Deck"],["theme_deck","Theme Deck"],["battle_deck","Battle Deck"],["league_battle_deck","League Battle Deck"],["starter_deck","Starter Deck"],
    ["premium_collection","Premium Collection"],["poster_collection","Poster Collection"],["binder_collection","Binder Collection"],
    ["calendar","Calendrier"],["advent_calendar","Calendrier de l’Avent"],["case_carton","Carton / Case usine"],["master_case","Master Case"],["other","Autres scellés"]
  ];
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function label(v){var x=PACKAGING.find(function(p){return p[0]===v;});return x?x[1]:v||"—";}
  function options(all){return (all?'<option value="">Tous les scellés</option>':'')+PACKAGING.map(function(p){return '<option value="'+esc(p[0])+'">'+esc(p[1])+'</option>';}).join("");}
  function readPrice(notes){var m=String(notes||"").match(PRICE_MARKER);if(!m)return 0;return Number(String(m[1]).replace(",","."))||0;}
  function cleanNotes(notes){return String(notes||"").replace(/\n?\[SALE_PRICE\]\s*[0-9]+(?:[.,][0-9]+)?/ig,"").trim();}
  function writeNotes(notes,price){var base=cleanNotes(notes),n=Number(price||0);return (base?base+"\n":"")+(n>0?"[SALE_PRICE] "+n.toFixed(2):"");}
  function euro(v){var n=Number(v||0);return n>0?A.euro(n):"—";}

  function panelHtml(){
    return '<div class="admin-panel" id="sealedReferenceCatalog">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">'+
        '<div><h2 style="margin-bottom:6px">Produits scellés</h2><p style="color:#baaf97;margin-top:0">Tous les produits Pokémon scellés sont gérés ici, dans le Catalogue de référence.</p></div>'+
        '<div class="admin-filters" style="margin:0"><button class="btn btn-secondary" type="button" id="repairMissingImages">Réparer les images cartes</button><span id="missingImagesStatus" style="color:#baaf97">Images manquantes : vérification…</span></div>'+
      '</div>'+
      '<div class="admin-grid-2" style="margin-top:18px">'+
        '<div><h3 id="sealedFormTitle">Ajouter un produit scellé</h3><div class="admin-form-grid">'+
          '<label>Nom<input id="scName" placeholder="Ex. Display EV10"></label>'+
          '<label>Extension<input id="scExtension" placeholder="Ex. Rivalités Destinées"></label>'+
          '<label>Conditionnement<select id="scPackaging">'+options(false)+'</select></label>'+
          '<label>Boosters / unités contenus<input id="scUnits" type="number" min="1" value="1"></label>'+
          '<label>EAN<input id="scEan" placeholder="Code-barres"></label>'+
          '<label>Prix de vente (€)<input id="scSalePrice" type="number" min="0" step="0.01" placeholder="0,00"></label>'+
          '<label class="admin-form-wide">Notes<textarea id="scNotes" rows="3"></textarea></label>'+
        '</div><div class="actions" style="margin-top:14px"><button class="btn btn-primary" id="scSave" type="button">Enregistrer</button><button class="btn btn-secondary" id="scCancel" type="button" hidden>Annuler</button></div><p id="scMsg" style="color:#baaf97"></p></div>'+
        '<div><h3>Recherche scellés</h3><div class="admin-filters"><input id="scSearch" placeholder="Nom, extension, EAN…"><select id="scFilter">'+options(true)+'</select></div><p id="scCount" style="color:#baaf97"></p></div>'+
      '</div>'+
      '<div class="admin-table-wrap" style="margin-top:16px"><table class="admin-table"><thead><tr><th>Produit</th><th>Extension</th><th>Type</th><th>Contenu</th><th>EAN</th><th>Prix de vente</th><th>Actions</th></tr></thead><tbody id="scBody"></tbody></table></div>'+
    '</div>';
  }

  function removeSeparateSealedNav(){document.querySelectorAll('a[href="admin-references-scelles.html"]').forEach(function(link){link.remove();});}
  function insertPanel(){
    if(document.getElementById("sealedReferenceCatalog"))return;
    var main=document.querySelector(".admin-main");if(!main)return;
    removeSeparateSealedNav();
    main.insertAdjacentHTML("beforeend",panelHtml());
    bind();load();refreshMissingImages();
    if(location.hash==="#scelles")document.getElementById("sealedReferenceCatalog").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function reset(){editing=null;["scName","scExtension","scEan","scNotes","scSalePrice"].forEach(function(id){var el=A.qs("#"+id);if(el)el.value="";});A.qs("#scUnits").value="1";A.qs("#scPackaging").value="booster";A.qs("#scCancel").hidden=true;A.qs("#sealedFormTitle").textContent="Ajouter un produit scellé";}
  function fill(x){editing=x.id;A.qs("#scName").value=x.name||"";A.qs("#scExtension").value=x.extension||"";A.qs("#scPackaging").value=x.packaging||"other";A.qs("#scUnits").value=x.unitsPerPackage||1;A.qs("#scEan").value=x.ean||"";A.qs("#scSalePrice").value=readPrice(x.notes)||"";A.qs("#scNotes").value=cleanNotes(x.notes);A.qs("#scCancel").hidden=false;A.qs("#sealedFormTitle").textContent="Modifier le produit scellé";document.getElementById("sealedReferenceCatalog").scrollIntoView({behavior:"smooth",block:"start"});}
  function render(list){A.qs("#scBody").innerHTML=(list||[]).map(function(x){return '<tr><td><strong>'+esc(x.name)+'</strong></td><td>'+esc(x.extension||"—")+'</td><td>'+esc(label(x.packaging))+'</td><td>'+esc(x.unitsPerPackage||1)+'</td><td>'+esc(x.ean||"—")+'</td><td><strong>'+esc(euro(readPrice(x.notes)))+'</strong></td><td><button class="btn btn-secondary scEdit" data-id="'+esc(x.id)+'">Modifier</button> <button class="btn btn-secondary scDelete" data-id="'+esc(x.id)+'">Supprimer</button></td></tr>';}).join("")||'<tr><td colspan="7">Aucun produit scellé référencé.</td></tr>';A.qs("#scCount").textContent=(list||[]).length+" référence(s) scellée(s)";A.qs("#scBody").querySelectorAll(".scEdit").forEach(function(b){b.onclick=function(){var x=current.find(function(i){return i.id===b.dataset.id;});if(x)fill(x);};});A.qs("#scBody").querySelectorAll(".scDelete").forEach(function(b){b.onclick=async function(){if(!confirm("Supprimer cette référence scellée ?"))return;var d=await A.adminFetch("/api/admin/catalog/sealed-references/"+encodeURIComponent(b.dataset.id),{method:"DELETE"});if(!d.ok){A.qs("#scMsg").textContent=d.error||"Suppression impossible.";return;}load();};});}
  async function load(){var q=encodeURIComponent(A.qs("#scSearch").value||""),p=encodeURIComponent(A.qs("#scFilter").value||"");try{var d=await A.adminFetch("/api/admin/catalog/sealed-references?q="+q+"&packaging="+p);current=d.references||[];render(current);}catch(e){A.qs("#scBody").innerHTML='<tr><td colspan="7">Erreur de chargement des scellés.</td></tr>';}}
  async function save(){var price=Number(String(A.qs("#scSalePrice").value||"0").replace(",","."))||0;var body={name:A.qs("#scName").value.trim(),license:"pokemon",extension:A.qs("#scExtension").value.trim(),packaging:A.qs("#scPackaging").value,unitsPerPackage:Number(A.qs("#scUnits").value||1),ean:A.qs("#scEan").value.trim(),notes:writeNotes(A.qs("#scNotes").value.trim(),price)};var path="/api/admin/catalog/sealed-references"+(editing?"/"+encodeURIComponent(editing):"");try{var d=await A.adminFetch(path,{method:editing?"PUT":"POST",body:JSON.stringify(body)});A.qs("#scMsg").textContent=d.ok?"Référence scellée enregistrée.":(d.error||"Erreur");if(d.ok){reset();load();}}catch(e){A.qs("#scMsg").textContent="Enregistrement impossible.";}}

  async function refreshMissingImages(){try{var d=await A.adminFetch("/api/admin/engine/market-prices/status");if(!d.ok)return;A.qs("#missingImagesStatus").textContent="Images cartes manquantes : "+Number(d.missingImages||0);}catch(e){A.qs("#missingImagesStatus").textContent="Images cartes : contrôle indisponible";}}
  async function repairMissingImages(){var button=A.qs("#repairMissingImages"),status=A.qs("#missingImagesStatus");button.disabled=true;var previous=-1,totalRepaired=0;try{for(var pass=1;pass<=12;pass++){status.textContent="Réparation images — passage "+pass+"/12…";var d=await A.adminFetch("/api/admin/engine/sync/pokemon-reference",{method:"POST",body:JSON.stringify({priceLimit:2000,skipRarities:true})});if(!d.ok)throw new Error(d.error||"sync_failed");totalRepaired+=Number(d.imagesRepaired||0);var missing=Number(d.missingImagesAfter||0);status.textContent="Images réparées : "+totalRepaired+" · restantes : "+missing;if(missing<=0||missing===previous||Number(d.imagesRepaired||0)<=0)break;previous=missing;}await refreshMissingImages();}catch(e){status.textContent="Réparation des images interrompue.";}finally{button.disabled=false;}}
  function bind(){A.qs("#scSave").onclick=save;A.qs("#scCancel").onclick=reset;A.qs("#scSearch").oninput=load;A.qs("#scFilter").onchange=load;A.qs("#repairMissingImages").onclick=repairMissingImages;}
  var tries=0;function start(){tries+=1;if(document.querySelector(".admin-main")){insertPanel();return;}if(tries<60)setTimeout(start,100);}start();
})();