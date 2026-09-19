(function(){
  "use strict";
  var timer=null,lastKey="";
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];});}
  function currentLiveId(){var selected=document.querySelector('[data-session-id][data-selected="true"]');return String(selected&&selected.dataset.sessionId||new URLSearchParams(location.search).get("session")||"");}
  function get(path){return fetch(path,{headers:{Accept:"application/json"},cache:"no-store"}).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false)throw new Error(d.error||"Erreur Live");return d;});});}
  async function buy(liveId,productId,spotLabel){
    try {
      if(!window.CardoriaLiveShippingAddress)throw new Error("Formulaire d'expédition indisponible.");
      const shipping=await window.CardoriaLiveShippingAddress.collect({liveId:liveId});
      if(!shipping)return;
      const headers={Accept:"application/json","Content-Type":"application/json"};
      let token="";try{token=localStorage.getItem("cardoria_client_session")||"";}catch(e){}
      if(token)headers.Authorization="Bearer "+token;
      const response=await fetch("/api/live/checkout",{method:"POST",headers:headers,body:JSON.stringify({
        liveId:liveId,productId:productId,qty:1,spotLabel:spotLabel,
        customerEmail:shipping.email,customerName:shipping.name,
        shippingAddress:shipping.address,servicePoint:shipping.servicePoint,
        successUrl:location.origin+"/live.html?session="+encodeURIComponent(liveId),
        cancelUrl:location.origin+"/live.html?session="+encodeURIComponent(liveId)
      })});
      const data=await response.json().catch(function(){return{};});
      if(!response.ok||data.ok===false)throw new Error(data.error||"Paiement Live indisponible.");
      if(!data.checkout||!data.checkout.url)throw new Error("Lien de paiement Live non reçu.");
      location.assign(data.checkout.url);
    }catch(e){alert(e.message);refresh();}
  }
  function render(liveId,state){var content=document.getElementById("claContent");if(!content)return;var b=state&&state.break;if(!b||b.status!=="running"||b.breakType!=="energy_game"){var old=document.getElementById("cardoriaEnergySpots");if(old)old.remove();document.querySelectorAll("[data-live-buy]").forEach(function(x){if(x.dataset.energyHidden==="1"){x.hidden=false;delete x.dataset.energyHidden;}});lastKey="";return;}
    document.querySelectorAll("[data-live-buy]").forEach(function(x){if(String(x.dataset.productId||"")===String(b.productId||"")){x.hidden=true;x.dataset.energyHidden="1";}});
    var labels=Array.isArray(b.spotLabels)?b.spotLabels:[],key=[liveId,b.id,labels.join("|"),b.remainingSpots].join(":");var box=document.getElementById("cardoriaEnergySpots");if(!box){box=document.createElement("div");box.id="cardoriaEnergySpots";box.style.marginTop="12px";content.appendChild(box);}else if(lastKey===key)return;lastKey=key;
    box.innerHTML="<div><strong>Jeu de l’énergie — choisissez votre spot</strong><p>"+esc(b.productName)+" · "+Number(b.pricePerSpot||0).toFixed(2)+" € / spot</p><div class='live-energy-buy-grid'>"+labels.map(function(label){return "<button type='button' data-buy-energy='"+esc(label)+"'>"+esc(label)+" — "+Number(b.pricePerSpot||0).toFixed(2)+" €</button>";}).join("")+"</div></div>";
    box.querySelectorAll("[data-buy-energy]").forEach(function(btn){btn.onclick=async function(){if(btn.disabled)return;btn.disabled=true;try{await buy(liveId,b.productId,btn.dataset.buyEnergy);}finally{btn.disabled=false;}};});
  }
  function refresh(){var liveId=currentLiveId();if(!liveId)return;get("/api/live/actions/"+encodeURIComponent(liveId)+"/state").then(function(d){render(liveId,d.state||{});}).catch(function(){});}
  function start(){if(timer)return;refresh();timer=setInterval(refresh,1800);}document.addEventListener("DOMContentLoaded",start);if(document.readyState!=="loading")start();window.addEventListener("beforeunload",function(){if(timer)clearInterval(timer);});
})();
