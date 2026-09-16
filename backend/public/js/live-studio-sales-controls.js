(function(){
  "use strict";
  var ENERGY_SPOTS=["Plante","Feu","Eau","Électrique","Psy","Combat","Obscurité","Métal","Dragon","Incolore","Dresseur / Supporter","Objet / Stade"];
  function isAdmin(){return /admin-live\.html$/i.test(location.pathname);}
  function token(){return window.CardoriaMarketplace&&CardoriaMarketplace.getToken?CardoriaMarketplace.getToken():"";}
  function post(path,body){
    if(isAdmin()&&window.CardoriaAdmin)return CardoriaAdmin.adminFetch(path,{method:"POST",body:JSON.stringify(body||{})});
    return fetch((window.CARDORIA_BACKEND||location.origin)+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token()},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false)throw new Error(d.error||"Erreur Live");return d;});});
  }
  function get(path){
    if(isAdmin()&&window.CardoriaAdmin)return CardoriaAdmin.adminFetch(path);
    return fetch((window.CARDORIA_BACKEND||location.origin)+path,{headers:{Authorization:"Bearer "+token()},cache:"no-store"}).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false)throw new Error(d.error||"Erreur Live");return d;});});
  }
  function liveId(){return String(window.CardoriaLiveSelectedId||"");}
  function productId(){var p=document.getElementById("lasProduct");return p&&p.value?String(p.value):"";}
  function actionPath(suffix){var id=liveId();if(!id)return"";return isAdmin()?"/api/admin/live/sessions/"+encodeURIComponent(id)+"/actions/"+suffix:"/api/live/actions/seller/"+encodeURIComponent(id)+"/"+suffix;}
  function statePath(){var id=liveId();return isAdmin()?"/api/admin/live/sessions/"+encodeURIComponent(id)+"/actions":"/api/live/actions/"+encodeURIComponent(id)+"/state";}
  function sheet(title,html,onGo){var s=document.getElementById("lasSheet");if(!s)return alert("Panneau de vente indisponible.");s.hidden=false;document.getElementById("lasSheetTitle").textContent=title;document.getElementById("lasSheetFields").innerHTML=html;document.getElementById("lasSheetGo").onclick=onGo;document.getElementById("lasSheetCancel").onclick=function(){s.hidden=true;};}
  function requireContext(){var id=liveId(),pid=productId();if(!id){alert("Sélectionnez un Live.");return null;}if(!pid){alert("Ajoutez et sélectionnez d’abord un lot dans la file.");return null;}return{id:id,productId:pid};}
  function energyChecks(selected){selected=selected||[];return "<div class='live-energy-grid'>"+ENERGY_SPOTS.map(function(e){return "<label><input type='checkbox' data-energy='1' value='"+e.replace(/'/g,"&#39;")+"'"+(selected.indexOf(e)>=0?" checked":"")+"> "+e+"</label>";}).join("")+"</div>";}
  function selectedEnergies(){return Array.prototype.map.call(document.querySelectorAll("[data-energy='1']:checked"),function(x){return x.value;});}
  function loadState(){var c=requireContext();if(!c)return Promise.reject(new Error("Contexte Live manquant."));return get(statePath()).then(function(d){return d.state||d.actions||{};});}
  function configureEnergyItem(){var c=requireContext();if(!c)return;loadState().then(function(state){var current=(state.energyTypesByProduct&&state.energyTypesByProduct[c.productId])||[];sheet("Énergies présentes dans cet item","<p>Coche uniquement les énergies réellement présentes dans l’item sélectionné. Ce réglage sera réutilisé automatiquement par Jeu de l’énergie.</p>"+energyChecks(current),function(){var values=selectedEnergies();if(!values.length)return alert("Sélectionnez au moins une énergie.");post(actionPath("energy-config"),{productId:c.productId,energyTypes:values}).then(function(){document.getElementById("lasSheet").hidden=true;}).catch(function(e){alert(e.message);});});}).catch(function(e){alert(e.message);});}
  function startBreak(type,spots,price,labels){var c=requireContext();if(!c)return;post(actionPath("break/start"),{productId:c.productId,breakType:type,spots:spots,pricePerSpot:price,spotLabels:labels||[]}).then(function(){var s=document.getElementById("lasSheet");if(s)s.hidden=true;setTimeout(function(){location.reload();},250);}).catch(function(e){alert(e.message);});}
  function startEnergyGame(){var c=requireContext();if(!c)return;loadState().then(function(state){var energies=(state.energyTypesByProduct&&state.energyTypesByProduct[c.productId])||[];if(!energies.length){alert("Aucune énergie n’est renseignée pour cet item. Clique d’abord sur Énergies item et coche celles réellement présentes.");return;}sheet("Jeu de l’énergie","<p><strong>Spots générés automatiquement depuis l’item :</strong></p><p>"+energies.join(" · ")+"</p><p><strong>Nombre de spots : "+energies.length+"</strong></p><label>Prix / spot <input id='lasEnergyPrice' type='number' min='0.01' step='0.01' value='1'></label>",function(){startBreak("energy_game",energies.length,Number(document.getElementById("lasEnergyPrice").value||0),energies);});}).catch(function(e){alert(e.message);});}
  function decorate(){
    var actions=document.querySelector(".live-studio-actions");if(!actions)return;
    var game=document.getElementById("lasGame");
    if(game&&game.dataset.salesEnhanced!=="1"){
      game.dataset.salesEnhanced="1";
      game.disabled=false;
      if(game.textContent!=="Jeu de l’énergie")game.textContent="Jeu de l’énergie";
      game.title="Utilise automatiquement les énergies configurées sur l’item";
      game.onclick=startEnergyGame;
    }
    if(!document.getElementById("lasEnergyConfig")){
      var cfg=document.createElement("button");cfg.type="button";cfg.id="lasEnergyConfig";cfg.textContent="Énergies item";cfg.title="Définir les énergies réellement présentes dans l’item sélectionné";actions.appendChild(cfg);cfg.onclick=configureEnergyItem;
    }
    if(!document.getElementById("lasBoxBreak")){
      var btn=document.createElement("button");btn.type="button";btn.id="lasBoxBreak";btn.textContent="Box Break";var ref=document.getElementById("lasBreak");if(ref&&ref.nextSibling)actions.insertBefore(btn,ref.nextSibling);else actions.appendChild(btn);
      btn.onclick=function(){var c=requireContext();if(!c)return;sheet("Box Break","<label>Nombre de spots <input id='lasBoxSpots' type='number' min='1' max='1000' value='12'></label><label>Prix / spot <input id='lasBoxPrice' type='number' min='0.01' step='0.01' value='1'></label>",function(){startBreak("box_break",Number(document.getElementById("lasBoxSpots").value||0),Number(document.getElementById("lasBoxPrice").value||0),[]);});};
    }
    var follow=document.getElementById("lasGiveFollow"),buyer=document.getElementById("lasGiveBuyer");
    if(follow&&!follow.hidden){follow.hidden=true;follow.setAttribute("aria-hidden","true");}
    if(buyer&&!buyer.hidden){buyer.hidden=true;buyer.setAttribute("aria-hidden","true");}
  }
  // Keep enhancement detached from DOM mutation loops. A lightweight idempotent timer
  // is sufficient to decorate a freshly rendered editor without freezing the Live page.
  var decorateTimer=setInterval(decorate,1000);
  window.addEventListener("cardoria-live-selected",function(){setTimeout(decorate,0);});
  document.addEventListener("DOMContentLoaded",decorate);decorate();
  window.addEventListener("beforeunload",function(){clearInterval(decorateTimer);});
  window.CardoriaLiveSalesControls={energySpots:ENERGY_SPOTS.slice(),decorate:decorate};
})();
