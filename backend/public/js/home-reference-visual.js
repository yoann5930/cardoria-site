(function(){
  "use strict";

  var chunks=window.CARDORIA_APPROVED_VISUAL||[];
  var img=document.getElementById("cardoriaApprovedVisual");
  var cleanImg=document.getElementById("cardoriaBottomClean");
  var cleanSrc=window.CARDORIA_REFERENCE_BOTTOM_CLEAN||"";

  if(!img)return;

  function showBase(){
    document.documentElement.classList.remove("reference-load-error");
    document.documentElement.classList.add("reference-ready");
  }

  function failBase(){
    document.documentElement.classList.add("reference-load-error");
  }

  if(chunks.length!==12||chunks.some(function(part){return !part;})){
    failBase();
    return;
  }

  img.addEventListener("load",showBase,{once:true});
  img.addEventListener("error",failBase,{once:true});
  img.src="data:image/webp;base64,"+chunks.join("");

  if(cleanImg&&cleanSrc){
    cleanImg.addEventListener("load",function(){
      document.documentElement.classList.add("reference-bottom-ready");
    },{once:true});
    cleanImg.addEventListener("error",function(){
      document.documentElement.classList.remove("reference-bottom-ready");
    },{once:true});
    cleanImg.src=cleanSrc;
  }
})();