(function(){
  "use strict";
  var TOKEN_KEY="cardoria_client_session";
  function clean(v){return String(v==null?"":v).trim();}
  function token(){try{return localStorage.getItem(TOKEN_KEY)||"";}catch(e){return"";}}
  function headers(){var h={Accept:"application/json","Content-Type":"application/json"},t=token();if(t)h.Authorization="Bearer "+t;return h;}
  async function api(path,options){
    options=options||{};
    var response=await fetch(path,Object.assign({},options,{headers:Object.assign(headers(),options.headers||{}),cache:"no-store"}));
    var payload=await response.json().catch(function(){return{};});
    if(!response.ok||payload.ok===false){var error=new Error(payload.error||"Erreur expédition.");error.code=payload.code||"";throw error;}
    return payload;
  }
  function key(liveId,email){return "cardoria_live_shipping:"+String(liveId||"")+":"+clean(email).toLowerCase();}
  function load(liveId,email){try{return JSON.parse(sessionStorage.getItem(key(liveId,email))||"null");}catch(e){return null;}}
  function save(liveId,email,value){try{sessionStorage.setItem(key(liveId,email),JSON.stringify(value));}catch(e){}}
  function required(label,defaultValue){var value=window.prompt(label,defaultValue||"");if(value===null)return null;value=clean(value);if(!value){window.alert(label.replace(" :","")+" obligatoire.");return null;}return value;}
  function collectAddress(defaults,name){
    defaults=defaults||{};
    var recipientName=required("Nom et prénom pour l’envoi :",defaults.recipientName||name);if(!recipientName)return null;
    var addressLine1=required("Adresse postale :",defaults.addressLine1||"");if(!addressLine1)return null;
    var addressLine2=window.prompt("Complément d’adresse (facultatif) :",defaults.addressLine2||"");if(addressLine2===null)return null;
    var postalCode=required("Code postal :",defaults.postalCode||"");if(!postalCode)return null;
    var city=required("Ville :",defaults.city||"");if(!city)return null;
    var countryCode=window.prompt("Pays — code à 2 lettres :",defaults.countryCode||"FR");if(countryCode===null)return null;countryCode=clean(countryCode).toUpperCase()||"FR";
    if(!/^[A-Z]{2}$/.test(countryCode)){window.alert("Code pays invalide. Exemple : FR.");return null;}
    var phone=window.prompt("Téléphone :",defaults.phone||"");if(phone===null)return null;
    return{recipientName:recipientName,addressLine1:addressLine1,addressLine2:clean(addressLine2),postalCode:clean(postalCode).toUpperCase(),city:city,countryCode:countryCode,phone:clean(phone)};
  }
  function relayFromProfile(relay){
    if(!relay||!relay.id)return null;
    return{id:String(relay.id),carrierServicePointId:relay.carrierServicePointId||"",name:relay.name||"",address:relay.address||"",postalCode:relay.postalCode||"",city:relay.city||"",countryCode:relay.countryCode||"FR",carrierCode:relay.carrierCode||"mondial_relay"};
  }
  function pointToRelay(point){
    return{id:String(point.id),carrierServicePointId:point.carrierServicePointId||"",name:point.name||"",address:[point.street,point.houseNumber].filter(Boolean).join(" "),postalCode:point.postalCode||"",city:point.city||"",countryCode:point.countryCode||"FR",carrierCode:point.carrierCode||"mondial_relay"};
  }
  async function chooseRelay(address,preferred){
    var query=new URLSearchParams({postalCode:address.postalCode,city:address.city,countryCode:address.countryCode||"FR",limit:"10",radius:"15000"});
    var data=await api("/api/mondial-relay/service-points?"+query.toString(),{method:"GET"});
    var points=Array.isArray(data.points)?data.points:[];
    if(preferred&&preferred.id){
      points.sort(function(a,b){if(String(a.id)===String(preferred.id))return-1;if(String(b.id)===String(preferred.id))return 1;return Number(a.distance||0)-Number(b.distance||0);});
    }
    if(!points.length)throw new Error("Aucun Point Relais Mondial Relay trouvé près de cette adresse.");
    var lines=points.map(function(p,i){return (i+1)+". "+p.name+" — "+[p.street,p.houseNumber,p.postalCode,p.city].filter(Boolean).join(" ") + (p.distance?" — "+Math.round(Number(p.distance))+" m":"");});
    var defaultChoice=preferred&&points.some(function(p){return String(p.id)===String(preferred.id);})?"1":"1";
    var answer=window.prompt("Choisissez votre Point Relais Mondial Relay :\n\n"+lines.join("\n")+"\n\nNuméro du relais :",defaultChoice);
    if(answer===null)return null;
    var index=Math.trunc(Number(answer))-1;
    if(index<0||index>=points.length){window.alert("Choix de Point Relais invalide.");return null;}
    return pointToRelay(points[index]);
  }
  async function currentClient(){
    if(!token())return null;
    try{var data=await api("/api/auth/me",{method:"GET"});return data.user&&data.user.role==="client"?data.user:null;}catch(e){return null;}
  }
  async function collect(options){
    options=options||{};
    var liveId=clean(options.liveId),client=await currentClient();
    var email=clean(client&&client.email||options.email).toLowerCase();
    var name=clean(client&&client.name||options.name);
    if(!email){email=clean(window.prompt("Email pour le paiement Live :")||"").toLowerCase();}
    if(!email)return null;
    if(!name)name=clean(window.prompt("Nom / pseudo :")||"Client Live");
    var cached=load(liveId,email)||{};
    var profileAddress=client&&client.profileReady?{recipientName:client.name||name,addressLine1:client.addressLine1,addressLine2:client.addressLine2,postalCode:client.postalCode,city:client.city,countryCode:client.country||"FR",phone:client.phone||""}:null;
    var address=cached.address||profileAddress;
    if(!address)address=collectAddress({},name);
    else{
      var change=window.confirm("Adresse d’envoi :\n"+address.addressLine1+"\n"+address.postalCode+" "+address.city+"\n\nOK = utiliser cette adresse\nAnnuler = la modifier");
      if(!change)address=collectAddress(address,name);
    }
    if(!address)return null;
    var preferred=cached.servicePoint||relayFromProfile(client&&client.relay);
    var servicePoint=null;
    if(preferred&&preferred.id){
      var usePreferred=window.confirm("Point Relais : "+preferred.name+" — "+preferred.postalCode+" "+preferred.city+"\n\nOK = utiliser ce relais\nAnnuler = choisir un autre relais");
      servicePoint=usePreferred?preferred:await chooseRelay(address,preferred);
    }else servicePoint=await chooseRelay(address,null);
    if(!servicePoint)return null;
    var result={email:email,name:name,address:address,servicePoint:servicePoint};
    save(liveId,email,result);
    if(client){
      try{
        await api("/api/auth/profile",{method:"PATCH",body:JSON.stringify({
          name:name,phone:address.phone,addressLine1:address.addressLine1,addressLine2:address.addressLine2,
          postalCode:address.postalCode,city:address.city,country:address.countryCode||"FR",
          shippingPreference:"mondial_relay",
          relay:client.relayReady?undefined:servicePoint
        })});
      }catch(e){}
    }
    return result;
  }
  window.CardoriaLiveShippingAddress={collect:collect,load:load,currentClient:currentClient};
})();
