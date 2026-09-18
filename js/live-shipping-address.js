(function(){
  "use strict";
  function clean(v){return String(v==null?"":v).trim();}
  function key(liveId,email){return "cardoria_live_shipping_address:"+String(liveId||"")+":"+clean(email).toLowerCase();}
  function load(liveId,email){try{return JSON.parse(sessionStorage.getItem(key(liveId,email))||"null");}catch(e){return null;}}
  function save(liveId,email,address){try{sessionStorage.setItem(key(liveId,email),JSON.stringify(address));}catch(e){}}
  function promptRequired(label,defaultValue){var value=window.prompt(label,defaultValue||"");if(value===null)return null;value=clean(value);if(!value){window.alert(label.replace(" :","")+" obligatoire.");return null;}return value;}
  function collect(options){
    options=options||{};
    var liveId=clean(options.liveId),email=clean(options.email).toLowerCase(),name=clean(options.name);
    if(!liveId||!email)return null;
    var cached=load(liveId,email);
    if(cached&&cached.addressLine1&&cached.postalCode&&cached.city&&cached.recipientName)return cached;
    var recipientName=promptRequired("Nom et prénom pour l’envoi :",name);if(!recipientName)return null;
    var addressLine1=promptRequired("Adresse postale :",cached&&cached.addressLine1||"");if(!addressLine1)return null;
    var addressLine2=window.prompt("Complément d’adresse (facultatif) :",cached&&cached.addressLine2||"");if(addressLine2===null)return null;
    var postalCode=promptRequired("Code postal :",cached&&cached.postalCode||"");if(!postalCode)return null;
    var city=promptRequired("Ville :",cached&&cached.city||"");if(!city)return null;
    var countryCode=window.prompt("Pays — code à 2 lettres :",cached&&cached.countryCode||"FR");if(countryCode===null)return null;countryCode=clean(countryCode).toUpperCase()||"FR";
    if(!/^[A-Z]{2}$/.test(countryCode)){window.alert("Code pays invalide. Exemple : FR.");return null;}
    var phone=window.prompt("Téléphone (facultatif, utile pour certains transporteurs) :",cached&&cached.phone||"");if(phone===null)return null;
    var address={recipientName:recipientName,addressLine1:addressLine1,addressLine2:clean(addressLine2),postalCode:clean(postalCode).toUpperCase(),city:city,countryCode:countryCode,phone:clean(phone)};
    save(liveId,email,address);return address;
  }
  window.CardoriaLiveShippingAddress={collect:collect,load:load};
})();