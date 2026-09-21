(function(){
"use strict";
const API=window.CARDORIA_BACKEND||window.location.origin;
const TOKEN_KEY="cardoria_session_token",LEGACY_TOKEN_KEY="cardoria_client_session";
const message=document.getElementById("clientOrdersMessage");
const list=document.getElementById("clientOrdersList");
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function euro(v){return Number(v||0).toFixed(2).replace(".",",")+" €";}
function trackingUrl(carrier,tracking,provided){
  const given=String(provided||"").trim();
  if(/^https:\/\//i.test(given)) return given;
  const t=String(tracking||"").trim(); if(!t)return "";
  const c=String(carrier||"").toLowerCase();
  if(c.includes("autre"))return "";
  const q=encodeURIComponent(t);
  if(c.includes("mondial"))return "https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition="+q;
  if(c.includes("relais colis"))return "https://www.relaiscolis.com/suivi-de-colis/?search="+q;
  if(c.includes("chronopost"))return "https://www.chronopost.fr/fr/suivi-colis?listeNumerosLT="+q;
  if(c.includes("colissimo"))return "https://www.laposte.fr/outils/suivre-vos-envois?code="+q;
  if(c.includes("la poste")||c==="poste")return "https://www.laposte.fr/outils/suivre-vos-envois?code="+q;
  if(c.includes("colis privé")||c.includes("colis prive"))return "https://www.colisprive.fr/moncolis/pages/detailColis.aspx?numColis="+q;
  if(c==="dpd"||c.startsWith("dpd "))return "https://trace.dpd.fr/fr/trace/"+q;
  if(c==="gls"||c.startsWith("gls "))return "https://gls-group.com/FR/fr/suivi-colis/?match="+q;
  if(c==="ups"||c.startsWith("ups "))return "https://www.ups.com/track?loc=fr_FR&tracknum="+q;
  if(c.includes("dhl"))return "https://www.dhl.com/fr-fr/home/tracking.html?tracking-id="+q;
  if(c.includes("fedex"))return "https://www.fedex.com/fedextrack/?trknbr="+q;
  if(c==="tnt"||c.startsWith("tnt "))return "https://www.fedex.com/fedextrack/?trknbr="+q;
  if(c.includes("geodis"))return "https://espace.geodis.com/track?reference="+q;
  if(c.includes("schenker"))return "https://www.dbschenker.com/app/tracking-public/?refNumber="+q;
  if(c.includes("ciblex"))return "https://www.ciblex.fr/suivi-colis/";
  if(c.includes("france express"))return "https://www.france-express.com/suivi-envoi/";
  if(c.includes("amazon"))return "https://www.amazon.fr/progress-tracker/package/";
  if(c.includes("cainiao"))return "https://global.cainiao.com/detail.htm?mailNoList="+q;
  if(c.includes("correos"))return "https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number="+q;
  if(c.includes("royal mail"))return "https://www.royalmail.com/track-your-item#/tracking-results/"+q;
  if(c.includes("postnl"))return "https://jouw.postnl.nl/track-and-trace/"+q;
  if(c.includes("bpost"))return "https://track.bpost.cloud/btr/web/#/search?itemCode="+q;
  return "";
}
function statusLabel(status){
  if(status==="À préparer")return "Commande confirmée";
  if(status==="Expédiée")return "Commande expédiée";
  return status||"Commande confirmée";
}
function paymentLabel(status){
  return ({paid:"Payé",pending:"En attente",failed:"Échoué",refunded:"Remboursé"})[status]||status||"—";
}
function steps(status){
  const label=statusLabel(status);
  if(label==="En attente SumUp")return '<div class="client-order-progress is-pending"><span class="active">Paiement en attente</span></div>';
  if(label==="Annulée"||label==="Paiement échoué"||label==="Remboursée")return '<div class="client-order-progress is-cancelled"><span class="active">'+esc(label)+'</span></div>';
  const values=["Commande confirmée","En préparation","Prête à expédier","Expédiée","Livrée"];
  let idx=0;
  if(label==="En préparation")idx=1;
  else if(label==="Prête à expédier")idx=2;
  else if(label==="Expédiée"||label==="Commande expédiée")idx=3;
  else if(label==="Livrée")idx=4;
  return '<div class="client-order-progress is-five">'+values.map((s,i)=>'<span class="'+(i<=idx?'active':'')+'">'+s+'</span>').join("")+'</div>';
}
function deliveryHtml(o){
  const d=o.delivery||{};
  if(d.pickupPoint){
    const p=d.pickupPoint;
    return '<div class="client-order-delivery"><small>POINT RELAIS MONDIAL RELAY</small><strong>'+esc(p.name||"Point Relais")+'</strong><p>'+esc([p.address, [p.postalCode,p.city].filter(Boolean).join(" ")].filter(Boolean).join(" · "))+(p.id?' · n° '+esc(p.id):"")+'</p></div>';
  }
  if(d.address){
    const a=d.address;
    return '<div class="client-order-delivery"><small>ADRESSE DE LIVRAISON</small><p>'+esc([a.street,[a.postalCode,a.city].filter(Boolean).join(" "),a.country].filter(Boolean).join(" · "))+'</p></div>';
  }
  return "";
}
function render(orders){
  message.hidden=true;list.hidden=false;
  if(!orders.length){list.innerHTML='<div class="client-auth-card"><h2>Aucune commande Boutique</h2><p>Les commandes Boutique associées à l’e-mail de ce compte apparaîtront ici.</p><a class="client-auth-primary client-order-link" href="/boutique.html">Voir la boutique</a></div>';return;}
  list.innerHTML=orders.map(o=>{
    const shipped=o.status==="Expédiée"||o.statusLabel==="Commande expédiée";
    const url=trackingUrl(o.carrier,o.tracking,o.trackingUrl);
    const items=(o.items||[]).map(i=>{
      const meta=[i.extension,i.number?"#"+i.number:"",i.condition].filter(Boolean).join(" · ");
      return '<li><span>'+esc(i.name||i.ref)+(meta?'<br><small>'+esc(meta)+'</small>':'')+'</span><strong>'+Number(i.qty||1)+' × '+euro(i.price)+'</strong></li>';
    }).join("");
    const fallback=o.tracking&&!url?'<p class="client-order-wait">Numéro de suivi disponible. Aucun lien officiel n’est associé à ce transporteur : copiez le numéro pour le suivre sur le site du transporteur.</p>':'';
    const method=o.shippingMethod==="mondial_relay"||String(o.shipping||"").toLowerCase().includes("mondial")?"Mondial Relay — Point Relais":(o.shipping||o.carrier||"Livraison");
    const tracking=o.tracking?'<div class="client-order-shipping"><div><small>TRANSPORTEUR</small><strong>'+esc(o.carrier||"Non renseigné")+'</strong></div><div><small>NUMÉRO DE SUIVI</small><strong>'+esc(o.tracking)+'</strong></div>'+(url?'<a class="client-auth-primary client-order-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Suivre mon colis →</a>':'')+'</div>'+fallback:'<p class="client-order-wait">Le numéro de suivi apparaîtra ici dès que votre colis sera expédié.</p>';
    return '<article class="client-order-card'+(shipped?' is-shipped':'')+'">'+
      (shipped?'<p class="client-order-shipped-banner">Commande expédiée</p>':'')+
      '<div class="client-order-head"><div><small>COMMANDE BOUTIQUE</small><h2>'+esc(o.id)+'</h2><p>'+esc(o.date||"")+' · Paiement : '+esc(paymentLabel(o.paymentStatus))+' · Préparation : '+esc(statusLabel(o.status||o.statusLabel))+'</p></div><strong class="client-order-total">'+euro(o.total)+'</strong></div>'+
      steps(o.status)+
      '<p class="client-order-method"><small>MODE DE LIVRAISON</small><strong>'+esc(method)+'</strong></p>'+
      deliveryHtml(o)+
      '<ul class="client-order-items">'+items+'</ul>'+tracking+'</article>';
  }).join("");
}
async function load(){
  let token=localStorage.getItem(TOKEN_KEY)||"";if(!token){token=localStorage.getItem(LEGACY_TOKEN_KEY)||"";if(token){localStorage.setItem(TOKEN_KEY,token);localStorage.removeItem(LEGACY_TOKEN_KEY);}}
  if(!token){message.innerHTML='<h2>Connexion requise</h2><p>Connectez-vous à votre compte client pour consulter uniquement vos commandes Boutique.</p><a class="client-auth-primary client-order-link" href="/client-login.html">Se connecter</a>';return;}
  try{
    const res=await fetch(API+"/api/auth/orders",{headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(res.status===401||res.status===403){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(LEGACY_TOKEN_KEY);throw new Error(res.status===403?"Cet espace est réservé aux comptes clients.":"Votre session a expiré. Reconnectez-vous.");}
    if(!res.ok||data.ok===false)throw new Error(data.error||"Impossible de charger vos commandes.");
    render(data.orders||[]);
  }catch(e){message.innerHTML='<h2>Commandes Boutique</h2><p>'+esc(e.message)+'</p><a class="client-auth-primary client-order-link" href="/client-login.html">Retour à la connexion</a>';}
}
load();
})();
