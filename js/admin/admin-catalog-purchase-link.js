(function(){
  "use strict";
  function enhance(){
    var body=document.getElementById("catalogBody");if(!body)return;
    body.querySelectorAll("tr").forEach(function(row){
      var history=row.querySelector("[data-history]");if(!history)return;
      var id=history.getAttribute("data-history");var cell=history.closest("td");
      if(!id||!cell||cell.querySelector("[data-add-purchase]"))return;
      var btn=document.createElement("button");btn.type="button";btn.className="btn btn-primary";btn.style.marginLeft="6px";btn.textContent="Ajouter aux achats";btn.setAttribute("data-add-purchase",id);
      btn.onclick=function(e){e.preventDefault();e.stopPropagation();location.href="admin-achats-cartes.html?source=card&id="+encodeURIComponent(id);};
      cell.appendChild(btn);
    });
  }
  var observer=new MutationObserver(function(){enhance();});
  function start(){var body=document.getElementById("catalogBody");if(!body){setTimeout(start,150);return;}observer.observe(body,{childList:true,subtree:true});enhance();}
  start();
})();