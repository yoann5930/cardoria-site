(function(){
  "use strict";
  var A=window.CardoriaAdmin;
  if(!A||window.CARDORIA_PURCHASE_MODE!=="pokemon_card")return;
  var running=false,timer=null;
  async function sync(){
    if(running)return;running=true;
    try{await A.adminFetch("/api/admin/marketplace/cardoria-stock/sync",{method:"POST",body:"{}"});}
    catch(e){}
    finally{running=false;}
  }
  function schedule(delay){clearTimeout(timer);timer=setTimeout(sync,delay||250);}
  function start(){
    var msg=document.getElementById("pMessage");
    if(!msg){setTimeout(start,100);return;}
    new MutationObserver(function(){if(msg.textContent.trim()==="Achat enregistré.")schedule(100);}).observe(msg,{childList:true,characterData:true,subtree:true});
    document.addEventListener("click",function(e){var b=e.target&&e.target.closest&&e.target.closest(".pDelete");if(b)schedule(1200);},true);
    schedule(150);
  }
  start();
})();
