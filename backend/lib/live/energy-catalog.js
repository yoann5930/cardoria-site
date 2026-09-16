import { readJson, writeJson } from "../storage.js";

const API="https://api.tcgdex.net/v2/fr";
const CACHE_KEY="live-energy-catalog-cache.json";
const TTL=24*60*60*1000;
const CANONICAL=["Plante","Feu","Eau","Électrique","Psy","Combat","Obscurité","Métal","Dragon","Incolore","Dresseur / Supporter","Objet / Stade"];
const TYPE_MAP=new Map([
  ["plante","Plante"],["grass","Plante"],
  ["feu","Feu"],["fire","Feu"],
  ["eau","Eau"],["water","Eau"],
  ["electrique","Électrique"],["électrique","Électrique"],["lightning","Électrique"],["electric","Électrique"],
  ["psy","Psy"],["psychic","Psy"],
  ["combat","Combat"],["fighting","Combat"],
  ["obscurite","Obscurité"],["obscurité","Obscurité"],["darkness","Obscurité"],["dark","Obscurité"],
  ["metal","Métal"],["métal","Métal"],
  ["dragon","Dragon"],
  ["incolore","Incolore"],["colorless","Incolore"]
]);

const clean=(v,m=160)=>String(v==null?"":v).trim().slice(0,m);
const key=(v)=>clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function cache(){const d=readJson(CACHE_KEY,{sets:null,setsAt:0,spots:{}});if(!d.spots||typeof d.spots!=="object")d.spots={};return d;}
function saveCache(d){writeJson(CACHE_KEY,d);}
async function json(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"Cardoria-Live/1.0"},signal:controller.signal});if(!r.ok)throw Object.assign(new Error(`Catalogue Pokémon indisponible (${r.status}).`),{status:502});return await r.json();}catch(e){if(e?.name==="AbortError")throw Object.assign(new Error("Le catalogue Pokémon met trop de temps à répondre."),{status:504});throw e;}finally{clearTimeout(timer);}}
function aliasId(v){const compact=clean(v).replace(/\s+/g,"").toLowerCase();let m=compact.match(/^ev(\d{1,2}(?:\.\d+)?)$/i);if(m)return"sv"+m[1].padStart(2,"0");m=compact.match(/^me(\d{1,2}(?:\.\d+)?)$/i);if(m)return"me"+m[1].padStart(2,"0");return compact;}
async function allSets(){const d=cache();if(Array.isArray(d.sets)&&Date.now()-Number(d.setsAt||0)<TTL)return d.sets;const sets=await json(`${API}/sets`);d.sets=Array.isArray(sets)?sets:[];d.setsAt=Date.now();saveCache(d);return d.sets;}
export async function searchEnergyCatalog(query,limit=12){const q=clean(query);if(!q)return[];const sets=await allSets(),qid=aliasId(q),qk=key(q);const ranked=sets.map((s)=>{const id=String(s?.id||""),name=String(s?.name||"");let score=99;if(id.toLowerCase()===qid)score=0;else if(key(name)===qk)score=1;else if(id.toLowerCase().includes(qid))score=2;else if(key(name).includes(qk))score=3;return{score,id,name,logo:s?.logo||"",cardCount:s?.cardCount||{}};}).filter(x=>x.score<99).sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name,"fr"));return ranked.slice(0,Math.max(1,Math.min(30,Number(limit)||12)));}
async function resolveSet(query){const matches=await searchEnergyCatalog(query,10);if(!matches.length)throw Object.assign(new Error(`Extension Pokémon introuvable : ${clean(query)}.`),{status:404,query:clean(query)});return matches[0];}
function canonicalType(v){return TYPE_MAP.get(key(v).replace(/ /g,""))||TYPE_MAP.get(key(v))||null;}
function classifyCard(card,out){const category=key(card?.category);if(category==="pokemon"){for(const t of Array.isArray(card?.types)?card.types:[]){const c=canonicalType(t);if(c)out.add(c);}return;}if(category==="trainer"||category==="dresseur"){const tt=key(card?.trainerType);if(tt.includes("support"))out.add("Dresseur / Supporter");else if(tt.includes("stad")||tt.includes("item")||tt.includes("objet")||tt.includes("tool")||tt.includes("outil"))out.add("Objet / Stade");else out.add("Dresseur / Supporter");return;}if(category==="energy"||category==="energie"){const text=key(card?.name);for(const [raw,label] of TYPE_MAP){if(text.includes(key(raw))){out.add(label);break;}}}}
async function setSpots(set){const d=cache(),cached=d.spots?.[set.id];if(cached&&Date.now()-Number(cached.at||0)<TTL&&Array.isArray(cached.spots))return cached;const full=await json(`${API}/sets/${encodeURIComponent(set.id)}`),cards=Array.isArray(full?.cards)?full.cards:[],out=new Set();const ids=cards.map(c=>String(c?.id||"")).filter(Boolean);for(let i=0;i<ids.length;i+=16){const batch=ids.slice(i,i+16);const details=await Promise.all(batch.map(id=>json(`${API}/cards/${encodeURIComponent(id)}`).catch(()=>null)));for(const card of details)if(card)classifyCard(card,out);if(CANONICAL.every(x=>out.has(x)))break;}const spots=CANONICAL.filter(x=>out.has(x));if(!spots.length)throw Object.assign(new Error(`Aucun type exploitable trouvé pour ${set.name||set.id}.`),{status:502});const value={at:Date.now(),setId:set.id,setName:set.name,spots,source:"TCGdex"};d.spots[set.id]=value;saveCache(d);return value;}
export async function resolveEnergyItems(items){const queries=(Array.isArray(items)?items:String(items||"").split(/[+,;\n]/)).map(x=>clean(x)).filter(Boolean).slice(0,12);if(!queries.length)throw Object.assign(new Error("Indique au moins un item / une extension Pokémon pour ce jeu."),{status:400});const resolved=[],union=[];for(const query of queries){const set=await resolveSet(query),data=await setSpots(set);resolved.push({query,setId:data.setId,setName:data.setName,spots:[...data.spots]});for(const spot of data.spots)if(!union.includes(spot))union.push(spot);}return{items:resolved,spots:CANONICAL.filter(x=>union.includes(x)),source:"TCGdex"};}
export { CANONICAL as ENERGY_GAME_SPOTS };
