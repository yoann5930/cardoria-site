(function(){
"use strict";
const API=window.CARDORIA_BACKEND||window.location.origin;
const TOKEN_KEY="cardoria_client_session";
const message=document.getElementById("clientOrdersMessage");
const list=document.getElementById("clientOrdersList");
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function euro(v){return Number(v||0).toFixed(2).replace(".",",")+" €";}
function trackingUrl(carrier,tracking){
  const t=String(tracking||"").trim(); if(!t)return "";
  const c=String(carrier||"").toLowerCase();
  if(c.includes("mondial"))return "https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition="+encodeURIComponent(t);
  if(c.includes("relais colis"))return "https://www.relaiscolis.com/suivi-de-colis/?search="+encodeURIComponent(t);
  if(c.includes("poste")||c.includes("colissimo")||c.includes("chronopost"))return "https://www.laposte.fr/outils/suivre-vos-envois?code="+encodeURIComponent(t);
  return "";
}
function steps(status){
  if(status==="Annulée"||status==="Paiement échoué")return '<div class="client-order-progress is-cancelled"><span class="active">'+esc(status)+'</span></div>';
  const values=["Commande confirmée","En préparation","Expédiée","Livrée"];
  let idx=0;
  if(status==="En préparation")idx=1; else if(status==="Expédiée")idx=2; else if(status==="Livrée")idx=3;
  return '<div class="client-order-progress">'+values.map((s,i)=>'<span class="'+(i<=idx?'active':'')+'">'+s+'</span>').join("")+'</div>';
}
function render(orders){
  message.hidden=true;list.hidden=false;
  if(!orders.length){list.innerHTML='<div class="client-auth-card"><h2>Aucune commande</h2><p>Les commandes passées avec l’adresse e-mail de ce compte apparaîtront ici.</p><a class="client-auth-primary client-order-link" href="/boutique.html">Voir la boutique</a></div>';return;}
  list.innerHTML=orders.map(o=>{
    const url=trackingUrl(o.carrier,o.tracking);
    const items=(o.items||[]).map(i=>'<li><span>'+esc(i.name||i.ref)+'</span><strong>'+Number(i.qty||1)+' × '+euro(i.price)+'</strong></li>').join("");
    const tracking=o.tracking?'<div class="client-order-shipping"><div><small>TRANSPORTEUR</small><strong>'+esc(o.carrier||"Non renseigné")+'</strong></div><div><small>NUMÉRO DE SUIVI</small><strong>'+esc(o.tracking)+'</strong></div>'+(url?'<a class="client-auth-primary client-order-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Suivre mon colis →</a>':'')+'</div>':'<p class="client-order-wait">Le numéro de suivi apparaîtra ici dès que votre colis sera expédié.</p>';
    return '<article class="client-order-card"><div class="client-order-head"><div><small>COMMANDE</small><h2>'+esc(o.id)+'</h2><p>'+esc(o.date||"")+'</p></div><strong class="client-order-total">'+euro(o.total)+'</strong></div>'+steps(o.status)+'<ul class="client-order-items">'+items+'</ul>'+tracking+'</article>';
  }).join("");
}
async function load(){
  const token=localStorage.getItem(TOKEN_KEY)||"";
  if(!token){message.innerHTML='<h2>Connexion requise</h2><p>Connectez-vous à votre compte CardoriaShop pour consulter vos commandes et vos suivis.</p><a class="client-auth-primary client-order-link" href="/client-login.html">Se connecter</a>';return;}
  try{
    const res=await fetch(API+"/api/auth/orders",{headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(res.status===401||res.status===403){localStorage.removeItem(TOKEN_KEY);throw new Error("Votre session a expiré. Reconnectez-vous.");}
    if(!res.ok||data.ok===false)throw new Error(data.error||"Impossible de charger vos commandes.");
    render(data.orders||[]);
  }catch(e){message.innerHTML='<h2>Mes commandes</h2><p>'+esc(e.message)+'</p><a class="client-auth-primary client-order-link" href="/client-login.html">Retour à la connexion</a>';}
}
load();
})();
