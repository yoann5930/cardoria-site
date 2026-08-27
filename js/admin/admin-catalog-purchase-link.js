(function(){
  "use strict";
  function enhance(){
    var body=document.getElementById("catalogBody");if(!body)return;
    body.querySelectorAll("tr").forEach(function(row){
      var history=row.querySelector("[data-history]");if(!history)return;
      var id=history.getAttribute("data-history");var cell=history.closest("td");
      if(!id||!cell||cell.querySelector("[data-add-purchase]"))return;

      var unitBtn=document.createElement("button");
      unitBtn.type="button";unitBtn.className="btn btn-primary";unitBtn.style.marginLeft="6px";unitBtn.textContent="Ajouter aux achats";unitBtn.setAttribute("data-add-purchase",id);
      unitBtn.onclick=function(e){e.preventDefault();e.stopPropagation();location.href="admin-achats-cartes.html?source=card&id="+encodeURIComponent(id)+"&packaging=carte_unite";};
      cell.appendChild(unitBtn);

      var lotBtn=document.createElement("button");
      lotBtn.type="button";lotBtn.className="btn btn-secondary";lotBtn.style.marginLeft="6px";lotBtn.textContent="Ajouter en lot";lotBtn.setAttribute("data-add-purchase-lot",id);
      lotBtn.onclick=function(e){e.preventDefault();e.stopPropagation();location.href="admin-achats-cartes.html?source=card&id="+encodeURIComponent(id)+"&packaging=lot_cartes";};
      cell.appendChild(lotBtn);
    });
  }
  var observer=new MutationObserver(function(){enhance();});
  function start(){var body=document.getElementById("catalogBody");if(!body){setTimeout(start,150);return;}observer.observe(body,{childList:true,subtree:true});enhance();}
  start();
})();