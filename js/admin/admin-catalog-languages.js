(function(){
  "use strict";
  var A=window.CardoriaAdmin;if(!A)return;
  var labels={fr:"Français",en:"Anglais",ja:"Japonais",ko:"Coréen"};
  var originalFetch=A.adminFetch.bind(A);
  function selected(){var el=document.getElementById("filterLanguage");return el?String(el.value||""):"";}
  function addLanguage(url){
    var lang=selected();if(!lang)return url;
    if(!/^\/api\/admin\/engine\/(cards\?|catalog\/facets\?|market-prices\/status)/.test(url))return url;
    var sep=url.indexOf("?")>=0?"&":"?";return url+sep+"language="+encodeURIComponent(lang);
  }
  A.adminFetch=function(url,options){
    options=options||{};
    if(url==="/api/admin/engine/sync/pokemon-reference"&&String(options.method||"GET").toUpperCase()==="POST"){
      try{var body=JSON.parse(options.body||"{}");body.language=selected()||"fr";options=Object.assign({},options,{body:JSON.stringify(body)});}catch(e){}
    }
    return originalFetch(addLanguage(url),options);
  };
  function codeFromId(id){id=String(id||"");if(id.indexOf("pokemon-en-")===0)return"en";if(id.indexOf("pokemon-ja-")===0)return"ja";if(id.indexOf("pokemon-ko-")===0)return"ko";return"fr";}
  function decorateRows(){
    var body=document.getElementById("catalogBody");if(!body)return;
    body.querySelectorAll("tr").forEach(function(row){var btn=row.querySelector("[data-history]");if(!btn)return;var cell=row.cells&&row.cells[1];if(!cell||cell.querySelector(".catalog-language-badge"))return;var code=codeFromId(btn.getAttribute("data-history"));var badge=document.createElement("span");badge.className="catalog-language-badge admin-badge";badge.style.marginLeft="8px";badge.textContent=code.toUpperCase();badge.title=labels[code]||code;var strong=cell.querySelector("strong");if(strong)strong.insertAdjacentElement("afterend",badge);});
  }
  function install(){
    var search=document.getElementById("catSearch");if(!search||document.getElementById("filterLanguage")){decorateRows();return Boolean(search);}
    var select=document.createElement("select");select.id="filterLanguage";select.innerHTML='<option value="">Toutes les langues</option><option value="fr">Français</option><option value="en">Anglais</option><option value="ja">Japonais</option><option value="ko">Coréen</option>';search.insertAdjacentElement("afterend",select);
    select.onchange=function(){var reload=document.getElementById("reloadCat");if(reload)reload.click();};
    originalFetch("/api/admin/engine/catalog/facets?license=pokemon").then(function(d){if(!d||!d.languages)return;var counts={};d.languages.forEach(function(x){counts[x.value]=Number(x.count||0);});Array.from(select.options).forEach(function(o){if(o.value&&labels[o.value])o.textContent=labels[o.value]+" ("+(counts[o.value]||0)+")";});}).catch(function(){});
    var body=document.getElementById("catalogBody");if(body)new MutationObserver(decorateRows).observe(body,{childList:true,subtree:true});decorateRows();return true;
  }
  var tries=0,timer=setInterval(function(){tries++;if(install()||tries>80)clearInterval(timer);},100);
})();