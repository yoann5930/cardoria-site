/**
 * Sendcloud API v3 adapter for Cardoria Live shipping.
 * API secret never leaves the server.
 */
const BASE_URL="https://panel.sendcloud.sc/api/v3";

function clean(value,max=200){return String(value==null?"":value).trim().slice(0,max);}
function credentials(){
  const publicKey=clean(process.env.SENDCLOUD_PUBLIC_KEY,500);
  const secretKey=clean(process.env.SENDCLOUD_SECRET_KEY,500);
  if(!publicKey||!secretKey)throw Object.assign(new Error("Sendcloud non configuré côté serveur."),{status:503,code:"SENDCLOUD_NOT_CONFIGURED"});
  return{publicKey,secretKey};
}
export function isSendcloudConfigured(){
  return Boolean(clean(process.env.SENDCLOUD_PUBLIC_KEY,500)&&clean(process.env.SENDCLOUD_SECRET_KEY,500));
}
function authHeader(){
  const {publicKey,secretKey}=credentials();
  return "Basic "+Buffer.from(publicKey+":"+secretKey).toString("base64");
}
async function api(path,{method="GET",body}={}){
  const response=await fetch(BASE_URL+path,{
    method,
    headers:{Accept:"application/json","Content-Type":"application/json",Authorization:authHeader()},
    body:body==null?undefined:JSON.stringify(body)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=payload?.detail||payload?.message||payload?.error?.message||payload?.error||`Sendcloud HTTP ${response.status}`;
    throw Object.assign(new Error(String(message)),{status:502,code:"SENDCLOUD_API_ERROR",sendcloudStatus:response.status,sendcloudPayload:payload});
  }
  return payload;
}
function safeCountry(value){const code=clean(value,2).toUpperCase()||"FR";return /^[A-Z]{2}$/.test(code)?code:"FR";}
function splitAddress(line){
  const value=clean(line,160);
  const match=value.match(/^(.*?)[,\s]+(\d+[A-Za-z0-9-]*)$/);
  if(match&&match[1])return{street:match[1].trim(),houseNumber:match[2]};
  return{street:value,houseNumber:""};
}
function sendcloudAddress(address,{email="",fallbackName="",companyName=""}={}){
  const line1=clean(address?.addressLine1||address?.address_line_1,160);
  const divided=splitAddress(line1);
  return{
    name:clean(address?.recipientName||address?.name||fallbackName,32),
    company_name:clean(companyName||address?.companyName||"",32),
    address_line_1:clean(divided.street||line1,32),
    address_line_2:clean(address?.addressLine2||address?.address_line_2,32),
    house_number:clean(address?.houseNumber||address?.house_number||divided.houseNumber,20),
    postal_code:clean(address?.postalCode||address?.postal_code,12),
    city:clean(address?.city,26),
    country_code:safeCountry(address?.countryCode||address?.country_code),
    phone_number:clean(address?.phone||address?.phone_number,20),
    email:clean(email||address?.email,70)
  };
}
function servicePointView(point){
  if(!point)return null;
  const address=point.address||{};
  return{
    id:Number(point.id)||0,
    carrierServicePointId:clean(point.carrier_service_point_id,120),
    name:clean(point.name,160),
    carrierCode:clean(point.carrier?.code,80),
    carrierName:clean(point.carrier?.name,120),
    shopType:clean(point.general_shop_type,60),
    street:clean(address.street,160),
    houseNumber:clean(address.house_number,30),
    postalCode:clean(address.postal_code,24),
    city:clean(address.city,120),
    countryCode:safeCountry(address.country_code),
    distance:Number(point.distance)||0,
    openingTimes:point.opening_times||null
  };
}
export async function searchMondialRelayServicePoints({countryCode="FR",postalCode="",city="",address="",limit=10,radius=10000}={}){
  const params=new URLSearchParams();
  params.set("country_code",safeCountry(countryCode));
  params.append("carrier_code","mondial_relay");
  if(clean(address,240))params.set("address",clean(address,240));
  else{
    if(clean(postalCode,24))params.set("address_postal_code",clean(postalCode,24));
    if(clean(city,120))params.set("address_city",clean(city,120));
  }
  params.set("radius",String(Math.max(100,Math.min(50000,Number(radius)||10000))));
  params.set("limit",String(Math.max(1,Math.min(30,Number(limit)||10))));
  const payload=await api("/service-points?"+params.toString());
  return{
    points:(payload?.data?.results||[]).map(servicePointView).filter((p)=>p.id),
    geocoding:payload?.data?.geocoding||null
  };
}
export async function getServicePoint(servicePointId){
  const id=Number(servicePointId);
  if(!Number.isFinite(id)||id<=0)throw Object.assign(new Error("Point Relais invalide."),{status:400,code:"SERVICE_POINT_INVALID"});
  const payload=await api("/service-points/"+encodeURIComponent(String(id)));
  return servicePointView(payload?.data||payload);
}
export async function resolveShippingOption({carrierCode,toCountry="FR",fromCountry="FR",weightGrams=1}={}){
  const payload=await api("/fetch-shipping-options",{method:"POST",body:{
    from_country_code:safeCountry(fromCountry),
    to_country_code:safeCountry(toCountry),
    weight:{value:(Math.max(1,Number(weightGrams)||1)/1000).toFixed(3),unit:"kg"},
    carrier_code:clean(carrierCode,80)
  }});
  const options=Array.isArray(payload?.data)?payload.data:[];
  const servicePoint=options.filter((o)=>o?.functionalities?.last_mile==="service_point"||o?.requirements?.is_service_point_required===true);
  const selected=(carrierCode==="mondial_relay"?servicePoint[0]:options.find((o)=>o?.functionalities?.last_mile!=="service_point"))||options[0];
  if(!selected?.code)throw Object.assign(new Error("Aucune option Sendcloud disponible pour ce transporteur et ce poids."),{status:409,code:"SENDCLOUD_SHIPPING_OPTION_UNAVAILABLE"});
  return{code:selected.code,name:selected.name||selected.product?.name||"",contractId:selected.contract?.id||null,carrierCode:selected.carrier?.code||carrierCode};
}
export async function createSendcloudShipment({
  orderNumber,reference,toAddress,toEmail,fromAddress,fromEmail,fromCompanyName,
  weightGrams,totalOrderValue=0,carrierCode="mondial_relay",servicePointId=null
}={}){
  const option=await resolveShippingOption({
    carrierCode,
    toCountry:toAddress?.countryCode||"FR",
    fromCountry:fromAddress?.countryCode||"FR",
    weightGrams
  });
  const shipWith={type:"shipping_option_code",properties:{shipping_option_code:option.code}};
  if(option.contractId)shipWith.properties.contract_id=option.contractId;
  const body={
    label_details:{mime_type:"application/pdf",dpi:72},
    to_address:sendcloudAddress(toAddress,{email:toEmail,fallbackName:toAddress?.recipientName}),
    from_address:sendcloudAddress(fromAddress,{email:fromEmail,fallbackName:fromAddress?.name,companyName:fromCompanyName}),
    ship_with:shipWith,
    order_number:clean(orderNumber,160),
    reference:clean(reference||orderNumber,160),
    total_order_price:{currency:"EUR",value:Number(totalOrderValue||0).toFixed(2)},
    parcels:[{weight:{value:(Math.max(1,Number(weightGrams)||1)/1000).toFixed(3),unit:"kg"}}]
  };
  if(servicePointId){
    body.to_service_point={id:Number(servicePointId)};
  }
  const payload=await api("/shipments/announce",{method:"POST",body});
  const data=payload?.data||{};
  const parcel=Array.isArray(data.parcels)?data.parcels[0]:null;
  const label=parcel?.documents?.find((d)=>d?.type==="label")||parcel?.documents?.[0]||null;
  return{
    shipmentId:clean(data.id,160),
    parcelId:clean(parcel?.id,160),
    trackingNumber:clean(parcel?.tracking_number,160),
    trackingUrl:clean(parcel?.tracking_url,1000),
    labelUrl:clean(label?.link,1000),
    status:clean(parcel?.status?.code||"READY_TO_SEND",80),
    carrierCode:clean(data?.carrier?.code||option.carrierCode,80),
    shippingOptionCode:option.code,
    raw:data
  };
}
