(function(){
  "use strict";

  var chunks=window.CARDORIA_APPROVED_VISUAL||[];
  var img=document.getElementById("cardoriaApprovedVisual");
  var cleanSrc=window.CARDORIA_REFERENCE_BOTTOM_CLEAN||"";

  if(!img)return;
  if(chunks.length!==12||chunks.some(function(part){return !part;})||!cleanSrc){
    document.documentElement.classList.add("reference-load-error");
    return;
  }

  var base=new Image();
  var clean=new Image();
  var baseReady=false;
  var cleanReady=false;
  var rendered=false;

  function fail(){
    document.documentElement.classList.add("reference-load-error");
  }

  function renderFinal(){
    if(rendered||!baseReady||!cleanReady)return;
    rendered=true;

    try{
      var canvas=document.createElement("canvas");
      canvas.width=1659;
      canvas.height=948;
      var ctx=canvas.getContext("2d",{alpha:false});
      if(!ctx)throw new Error("canvas_unavailable");

      ctx.drawImage(base,0,0,1659,948);
      ctx.drawImage(clean,0,0,1659,148,0,800,1659,148);

      img.addEventListener("load",function(){
        document.documentElement.classList.remove("reference-load-error");
        document.documentElement.classList.add("reference-ready");
      },{once:true});
      img.addEventListener("error",fail,{once:true});
      img.src=canvas.toDataURL("image/png");
    }catch(e){
      fail();
    }
  }

  base.onload=function(){baseReady=true;renderFinal();};
  clean.onload=function(){cleanReady=true;renderFinal();};
  base.onerror=fail;
  clean.onerror=fail;

  base.src="data:image/webp;base64,"+chunks.join("");
  clean.src=cleanSrc;
})();