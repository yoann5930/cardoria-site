(function(){
  "use strict";
  var ENERGY_SPOTS=["Plante","Feu","Eau","Électrique","Psy","Combat","Obscurité","Métal","Dragon","Incolore","Dresseur / Supporter","Objet / Stade"];
  function isAdmin(){return /admin-live\.html$/i.test(location.pathname);}
  function api(path,body){
    if(isAdmin()&&window.CardoriaAdmin){return CardoriaAdmin.adminFetch(path,{method:"POST",body:JSON.stringify(body||{})});}
    if(window.CardoriaMarketplace&&CardoriaMarketplace.getToken){return fetch((window.CARDORIA_BACKEND||location.origin)+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+CardoriaMarketplace.getToken()},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false)throw new Error(d.error||"Erreur Live");return d;});});}
    return Promise.reject(new Error("Session Live indisponible."));
  }
  function liveId(){return String(window.CardoriaLiveSelectedId||"");}
  function productId(){var p=document.getElementById("lasProduct");return p&&p.value?String(p.value):"";}
  function actionPath(suffix){var id=liveId();if(!id)return"";return isAdmin()?"/api/admin/live/sessions/"+encodeURIComponent(id)+"/actions/"+suffix:"/api/live/actions/seller/"+encodeURIComponent(id)+"/"+suffix;}
  function sheet(title,html,onGo){var s=document.getElementById("lasSheet");if(!s)return alert("Panneau de vente indisponible.");s.hidden=false;document.getElementById("lasSheetTitle").textContent=title;document.getElementById("lasSheetFields").innerHTML=html;document.getElementById("lasSheetGo").onclick=onGo;document.getElementById("lasSheetCancel").onclick=function(){s.hidden=true;};}
  function requireContext(){var id=liveId(),pid=productId();if(!id){alert("Sélectionnez un Live.");return null;}if(!pid){alert("Ajoutez et sélectionnez d’abord un lot dans la file.");return null;}return{id:id,productId:pid};}
  function startBreak(type,spots,price,labels){var c=requireContext();if(!c)return;api(actionPath("break/start"),{productId:c.productId,breakType:type,spots:spots,pricePerSpot:price,spotLabels:labels||[]}).then(function(){var s=document.getElementById("lasSheet");if(s)s.hidden=true;window.dispatchEvent(new Event("cardoria-live-selected"));setTimeout(function(){location.reload();},250);}).catch(function(e){alert(e.message);});}
  function decorate(){
    var actions=document.querySelector(".live-studio-actions");if(!actions)return;
    var game=document.getElementById("lasGame");
    if(game){game.disabled=false;game.textContent="Jeu de l’énergie";game.title="12 spots énergie Cardoria";game.onclick=function(){var c=requireContext();if(!c)return;var p=document.querySelector("#lasProduct option:checked");sheet("Jeu de l’énergie","<p><strong>12 spots :</strong> "+ENERGY_SPOTS.join(" · ")+"</p><label>Prix / spot <input id='lasEnergyPrice' type='number' min='0.01' step='0.01' value='1'></label>",function(){startBreak("energy_game",12,Number(document.getElementById("lasEnergyPrice").value||0),ENERGY_SPOTS);});};}
    if(!document.getElementById("lasBoxBreak")){
      var btn=document.createElement("button");btn.type="button";btn.id="lasBoxBreak";btn.textContent="Box Break";var ref=document.getElementById("lasBreak");if(ref&&ref.nextSibling)actions.insertBefore(btn,ref.nextSibling);else actions.appendChild(btn);
      btn.onclick=function(){var c=requireContext();if(!c)return;sheet("Box Break","<label>Nombre de spots <input id='lasBoxSpots' type='number' min='1' max='1000' value='12'></label><label>Prix / spot <input id='lasBoxPrice' type='number' min='0.01' step='0.01' value='1'></label>",function(){startBreak("box_break",Number(document.getElementById("lasBoxSpots").value||0),Number(document.getElementById("lasBoxPrice").value||0),[]);});};
    }
    var follow=document.getElementById("lasGiveFollow"),buyer=document.getElementById("lasGiveBuyer");
    if(follow){follow.hidden=true;follow.setAttribute("aria-hidden","true");}
    if(buyer){buyer.hidden=true;buyer.setAttribute("aria-hidden","true");}
  }
  var obs=new MutationObserver(decorate);obs.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener("DOMContentLoaded",decorate);decorate();
  window.CardoriaLiveSalesControls={energySpots:ENERGY_SPOTS.slice(),decorate:decorate};
})();
