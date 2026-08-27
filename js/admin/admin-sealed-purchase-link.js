(function(){
  "use strict";
  function enhance(){
    var body=document.getElementById("sBody");if(!body)return;
    body.querySelectorAll("tr").forEach(function(row){
      var edit=row.querySelector(".sEdit[data-id]");if(!edit)return;
      var id=edit.getAttribute("data-id"),cell=edit.closest("td");
      if(!id||!cell||cell.querySelector("[data-add-sealed-purchase]"))return;
      var btn=document.createElement("button");btn.type="button";btn.className="btn btn-primary";btn.style.marginLeft="6px";btn.textContent="Ajouter aux achats";btn.setAttribute("data-add-sealed-purchase",id);
      btn.onclick=function(e){e.preventDefault();e.stopPropagation();location.href="admin-achats-cartes.html?source=sealed&id="+encodeURIComponent(id);};
      cell.appendChild(btn);
    });
  }
  var observer=new MutationObserver(enhance);
  function start(){var body=document.getElementById("sBody");if(!body){setTimeout(start,150);return;}observer.observe(body,{childList:true,subtree:true});enhance();}
  start();
})();