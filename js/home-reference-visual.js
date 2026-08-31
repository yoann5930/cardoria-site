(function(){
  "use strict";
  var chunks=window.CARDORIA_APPROVED_VISUAL||[];
  var img=document.getElementById("cardoriaApprovedVisual");
  if(!img)return;
  if(chunks.length!==11||chunks.some(function(part){return !part;})){
    document.documentElement.classList.add("reference-load-error");
    return;
  }
  img.addEventListener("load",function(){document.documentElement.classList.add("reference-ready");},{once:true});
  img.src="data:image/webp;base64,"+chunks.join("");
})();