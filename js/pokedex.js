(function () {
  "use strict";
  const KEY="cardoria_session_token", LEGACY_KEY="cardoria_client_session";
  const token=localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY);
  const $=id=>document.getElementById(id);
  const state={owned:new Map(),page:1,tab:"owned",search:[],total:0,query:"",language:"fr",busy:false};
  const msg=(text)=>{$("dexMessage").textContent=text||"";};
  function safeImage(value){try{const u=new URL(value,location.origin);return u.protocol==="https:"||u.origin===location.origin?u.href:"";}catch{return "";}}
  async function api(path,options={}) {
    const headers={Authorization:"Bearer "+token,Accept:"application/json",...options.headers};
    const response=await fetch(path,{...options,headers,cache:"no-store"});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw new Error(data.error||"Erreur de connexion");
    return data;
  }
  function stat(){
    const values=Array.from(state.owned.values());
    $("dexUnique").textContent=String(values.length);
    $("dexCopies").textContent=String(values.reduce((sum,row)=>sum+Number(row.quantity||0),0));
  }
  function addText(el,tag,content,className){const node=document.createElement(tag);node.textContent=String(content||"");if(className)node.className=className;el.appendChild(node);return node;}
  async function update(cardId,quantity){
    try{
      state.busy=true;const r=await api("/api/auth/pokedex/"+encodeURIComponent(cardId),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({quantity})});
      if(!r.ok)throw new Error("Enregistrement impossible");
      const previous=state.owned.get(cardId);
      if(quantity===0)state.owned.delete(cardId);
      else if(previous)state.owned.set(cardId,{...previous,quantity});
      else {const card=state.search.find(c=>c.id===cardId);if(card)state.owned.set(cardId,{...card,quantity});}
      stat();render();msg("Collection mise à jour.");
    }catch(e){msg(e.message);}finally{state.busy=false;}
  }
  function cardElement(card){
    const box=document.createElement("article");box.className="dex-card";
    const img=safeImage(card.imageThumb||card.imageHd);
    if(img){const image=document.createElement("img");image.src=img;image.alt="Carte "+String(card.name||"Pokémon");image.loading="lazy";image.onerror=()=>image.remove();box.appendChild(image);}
    addText(box,"h3",card.name||"Carte Pokémon");
    addText(box,"small",[card.extension,card.number?"N° "+card.number:"",String(card.language||"").toUpperCase()].filter(Boolean).join(" · "));
    if(card.rarity)addText(box,"small",card.rarity);
    const controls=document.createElement("div");controls.className="dex-count";
    const value=state.owned.get(card.id)?.quantity||0;
    const minus=document.createElement("button");minus.type="button";minus.textContent="−";minus.setAttribute("aria-label","Retirer un exemplaire");minus.disabled=!value;minus.onclick=()=>!state.busy&&update(card.id,Math.max(0,value-1));
    const count=document.createElement("span");count.textContent=String(value)+" possédée"+(value>1?"s":"");
    const plus=document.createElement("button");plus.type="button";plus.textContent="+";plus.setAttribute("aria-label","Ajouter un exemplaire");plus.disabled=value>=999;plus.onclick=()=>!state.busy&&update(card.id,Math.min(999,value+1));
    controls.append(minus,count,plus);box.appendChild(controls);return box;
  }
  function render(){
    const grid=$("dexGrid");grid.replaceChildren();
    const cards=state.tab==="owned"?Array.from(state.owned.values()):state.search;
    if(!cards.length){addText(grid,"p",state.tab==="owned"?"Aucune carte enregistrée. Ouvrez « Ajouter des cartes » pour commencer.":"Aucune carte à afficher. Essayez une autre recherche.","dex-empty");}
    else cards.forEach(card=>grid.appendChild(cardElement(card)));
    $("dexMore").hidden=state.tab!=="search"||state.search.length>=state.total;
  }
  async function search(more=false){
    if(state.busy)return;
    const q=$("dexQuery").value.trim();
    if(q.length<2){msg("Saisissez au moins deux caractères.");return;}
    state.busy=true;
    if(!more){state.page=1;state.search=[];}
    msg("Recherche des cartes…");
    try{
      const params=new URLSearchParams({q,license:"pokemon",language:$("dexLanguage").value,page:String(state.page),limit:"24"});
      const data=await api("/api/engine/cards?"+params.toString());
      state.search.push(...(data.cards||[]));state.total=data.pagination?.total||0;state.page++;
      render();msg(state.total+" résultat(s) dans le catalogue.");
    }catch(e){msg(e.message);}finally{state.busy=false;}
  }
  async function init(){
    if(!token){location.replace("/client-login.html?mode=login");return;}
    try{
      const me=await api("/api/auth/me");
      if(me.user?.role!=="client")throw new Error("Compte client requis.");
      const data=await api("/api/auth/pokedex");
      state.owned=new Map((data.cards||[]).map(c=>[c.id,c]));stat();render();
    }catch(e){msg(e.message+" Veuillez vous reconnecter si nécessaire.");return;}
    document.querySelectorAll("[data-tab]").forEach(button=>button.addEventListener("click",()=>{
      state.tab=button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b===button));
      $("dexSearchForm").hidden=state.tab!=="search";render();
    }));
    $("dexSearchForm").addEventListener("submit",e=>{e.preventDefault();search(false);});
    $("dexMore").addEventListener("click",()=>search(true));
  }
  document.addEventListener("DOMContentLoaded",init);
})();