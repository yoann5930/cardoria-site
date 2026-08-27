(function(){
  "use strict";
  var A=window.CardoriaAdmin;if(!A)return;
  var TYPES=[
    ["booster","Booster"],["blister","Blister"],["duopack","Duo pack"],["tripack","Tripack"],["quadpack","Quad pack"],
    ["bundle","Bundle"],["mini_bundle","Mini bundle"],["demi_display","Demi-display"],["display","Display"],["case_display","Case de displays"],
    ["etb","ETB"],["etb_pokemon_center","ETB Pokémon Center"],["upc","UPC"],["coffret","Coffret"],["collection_box","Collection box"],
    ["tin","Tin"],["pokebox","Pokébox"],["mini_tin","Mini Tin"],["build_battle","Build & Battle"],["build_battle_stadium","Build & Battle Stadium"],
    ["deck","Deck"],["premium_collection","Premium Collection"],["poster_collection","Poster Collection"],["binder_collection","Binder Collection"],
    ["calendar","Calendrier"],["advent_calendar","Calendrier de l’Avent"],["case_carton","Carton / Case usine"],["master_case","Master Case"],["other","Autres scellés"]
  ];
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function href(type){return "admin-references-scelles.html?packaging="+encodeURIComponent(type);}
  function insertPanel(){
    if(document.getElementById("sealedCatalogFamilies"))return;
    var main=document.querySelector(".admin-main");if(!main)return;
    var topbar=main.querySelector(".admin-topbar");
    var panel=document.createElement("div");panel.id="sealedCatalogFamilies";panel.className="admin-panel";
    panel.innerHTML='<h2>Catalogue de référence Pokémon</h2><p style="color:#baaf97">Accès direct aux cartes et à tous les produits scellés référencés.</p><div class="admin-filters" id="sealedCatalogFamilyLinks"><a class="btn btn-primary" href="admin-catalogue.html">Cartes à l’unité</a>'+TYPES.map(function(t){return '<a class="btn btn-secondary" data-sealed-type="'+esc(t[0])+'" href="'+href(t[0])+'">'+esc(t[1])+' <span data-count>—</span></a>';}).join("")+'</div>';
    if(topbar&&topbar.nextSibling)main.insertBefore(panel,topbar.nextSibling);else main.insertBefore(panel,main.firstChild);
    A.adminFetch("/api/admin/catalog/sealed-references").then(function(d){
      if(!d.ok)return;var counts={};(d.references||[]).forEach(function(r){counts[r.packaging]=(counts[r.packaging]||0)+1;});
      panel.querySelectorAll("[data-sealed-type]").forEach(function(link){var span=link.querySelector("[data-count]");if(span)span.textContent="("+(counts[link.dataset.sealedType]||0)+")";});
    }).catch(function(){});
  }
  var tries=0;function start(){tries+=1;if(document.querySelector(".admin-main")){insertPanel();return;}if(tries<40)setTimeout(start,100);}start();
})();