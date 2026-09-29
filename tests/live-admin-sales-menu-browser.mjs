import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root=process.cwd();
const mime={".js":"application/javascript",".css":"text/css",".html":"text/html"};
function fixture(){
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/css/live-studio-clean.css">
  </head><body><main class="admin-main"></main>
  <script>
  window.CardoriaLiveSelectedId="LIVE-BROWSER";
  window.__alerts=[];
  window.alert=(m)=>window.__alerts.push(String(m));
  window.__session={"id":"LIVE-BROWSER","title":"Live Browser Test","ownerRole":"admin","ownerId":"cardoria","status":"live","products":[{"id":"LOT-1","name":"Booster test","mode":"buy_now","price":5,"qty":12,"stock":12,"shippingWeightGrams":20},{"id":"LOT-2","name":"Display test","mode":"break","price":10,"qty":12,"stock":12,"shippingWeightGrams":500}],"currentLot":"LOT-1"};
  window.__state={"pinnedProductId":"LOT-1","auction":null,"flash":null,"giveaway":null,"break":null,"chat":[]};
  function record(path,options){const list=JSON.parse(localStorage.getItem("__calls")||"[]");list.push({path,method:(options&&options.method)||"GET",body:(options&&options.body)||""});localStorage.setItem("__calls",JSON.stringify(list));}
  window.CardoriaAdmin={adminFetch:async function(path,options){
    record(path,options||{});
    if(path==="/api/admin/live/sessions") return {sessions:[window.__session]};
    if(path==="/api/admin/live/sessions/LIVE-BROWSER") {
      if(options&&options.method==="PATCH"&&options.body){const body=JSON.parse(options.body);if(body.currentLot) window.__session.currentLot=body.currentLot;if(body.products) window.__session.products=body.products;}
      return {session:window.__session};
    }
    if(path==="/api/admin/live/sessions/LIVE-BROWSER/actions") return {state:window.__state};
    if(path==="/api/admin/live/checkouts") return {checkouts:[{id:"C1",status:"paid",productName:"Booster test",amount:7.29,customerEmail:"buyer@example.com",customerName:"Buyer"}]};
    if(path.endsWith("/actions/game/prepare")) {
      const body=JSON.parse((options&&options.body)||"{}");
      const product=window.__session.products.find((p)=>p.id===body.productId);
      window.__state.preparedGame={id:"PREP-1",type:body.type,productId:body.productId,productName:product?product.name:"",config:body.config||{},status:"ready"};
      return {ok:true,preparedGame:window.__state.preparedGame};
    }
    if(path.endsWith("/actions/game/launch")) {
      if(window.__state.preparedGame) window.__state.preparedGame={...window.__state.preparedGame,status:"launched"};
      return {ok:true,prepared:window.__state.preparedGame,result:{kind:"auction"}};
    }
    if(path.includes("/actions/")) return {ok:true,state:window.__state,giveaway:{status:"running"},break:{status:"running"},auction:{status:"running"},flash:{status:"running"}};
    return {ok:true};
  }};
  <\/script>
  <script src="/js/live-studio-actions-ui.js"><\/script>
  <script src="/js/live-studio-sales-controls.js"><\/script>
  </body></html>`;
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,"http://127.0.0.1");
  if(url.pathname==="/admin-live.html"){res.writeHead(200,{"content-type":"text/html"});res.end(fixture());return;}
  if(url.pathname.startsWith("/api/live/webrtc/status/")){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({viewers:3}));return;}
  if(url.pathname==="/api/live/actions/energy-catalog/resolve"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({ok:true,items:[{setId:"sv10",setName:"EV10"}],spots:["Feu","Eau","Psy","Dresseur / Supporter"]}));return;}
  if(url.pathname==="/api/live/actions/sealed-units/resolve"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({ok:true,packaging:"display",unitsPerPackage:18,source:"catalog",reference:{id:"sealed-1",name:"Display test",extension:"EV10"}}));return;}
  const rel=url.pathname.replace(/^\//,""),file=path.join(root,rel);
  if(file.startsWith(root)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.writeHead(200,{"content-type":mime[path.extname(file)]||"application/octet-stream"});fs.createReadStream(file).pipe(res);return;}
  res.writeHead(404);res.end("not found");
});
await new Promise((resolve)=>server.listen(0,"127.0.0.1",resolve));
const port=server.address().port;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1365,height:900}});
try{
  await page.goto("http://127.0.0.1:"+port+"/admin-live.html",{waitUntil:"networkidle"});
  await page.waitForSelector("#lasGameProduct");
  await page.waitForSelector("#lasGameType");
  await page.waitForSelector("#lasLaunchPreset");

  assert.equal(await page.locator("#lasGameProduct").isVisible(),true);
  assert.equal(await page.locator("#lasGameType").isVisible(),true);
  assert.equal((await page.locator("#lasLaunchPreset").textContent()).trim(),"Valider / préparer");
  assert.equal(await page.locator(".live-studio-actions").isVisible(),false);

  // Commandes opérateur : pas de faux bouton "Vendu", navigation claire et épinglage réel.
  assert.equal((await page.locator("#lasPrev").textContent()).trim(),"← Précédent");
  assert.equal((await page.locator("#lasPin").textContent()).trim(),"📌 Épingler");
  assert.equal((await page.locator("#lasReplay").textContent()).trim(),"↻ Relancer l’item");
  assert.equal((await page.locator("#lasSkip").textContent()).trim(),"Passer");
  assert.equal((await page.locator("#lasNext").textContent()).trim(),"Suivant →");
  assert.equal(await page.locator("#lasSold").count(),0,"aucun bouton Vendu manuel");
  await page.click("#lasPin");
  await page.waitForTimeout(30);
  let operatorCalls=JSON.parse(await page.evaluate(()=>localStorage.getItem("__calls")||"[]"));
  assert.ok(operatorCalls.some((x)=>x.path.endsWith("/actions/pin")&&x.method==="POST"),"épinglage envoyé");

  // Box Break: Cardoria calcule automatiquement les boosters depuis la référence scellée.
  await page.selectOption("#lasGameProduct","LOT-2");
  await page.selectOption("#lasGameType","box_break");
  await page.click("#lasLaunchPreset");
  await page.waitForSelector("#lasBoosterTotal");
  assert.equal((await page.locator("#lasBoostersPerItem").inputValue()),"18");
  assert.equal((await page.locator("#lasBoosterTotal").textContent()).trim(),"18");
  await page.fill("#lasItemCount","2");
  await page.waitForTimeout(20);
  assert.equal((await page.locator("#lasBoosterTotal").textContent()).trim(),"36");
  await page.click("#lasSheetGo");
  await page.waitForSelector("#lasLaunchPreparedGame");

  let calls=JSON.parse(await page.evaluate(()=>localStorage.getItem("__calls")||"[]"));
  const prepareCall=calls.find((x)=>x.path.endsWith("/actions/game/prepare")&&x.method==="POST");
  assert.ok(prepareCall,"préparation Box Break envoyée");
  const prepareBody=JSON.parse(prepareCall.body);
  assert.equal(prepareBody.config.boosterCount,36);
  assert.ok(!calls.some((x)=>x.path.endsWith("/actions/auction/start")),"aucune enchère auto");

  await page.click("#lasLaunchPreparedGame");
  await page.waitForTimeout(100);
  calls=JSON.parse(await page.evaluate(()=>localStorage.getItem("__calls")||"[]"));
  assert.ok(calls.some((x)=>x.path.endsWith("/actions/game/launch")&&x.method==="POST"),"lancement manuel envoyé");

  await page.setViewportSize({width:390,height:844});
  await page.goto("http://127.0.0.1:"+port+"/admin-live.html",{waitUntil:"networkidle"});
  await page.waitForSelector("#lasGameProduct");
  assert.equal(await page.locator("#lasGameProduct").isVisible(),true);
  assert.equal(await page.locator("#lasGameType").isVisible(),true);
  assert.equal(await page.locator("#lasLaunchPreset").isVisible(),true);
  assert.equal(await page.locator(".live-studio-actions").isVisible(),false);
  const alerts=await page.evaluate(()=>window.__alerts); assert.deepEqual(alerts,[]);
  console.log("LIVE ADMIN SALES MENU BROWSER E2E OK");
} finally {
  await browser.close();
  await new Promise((resolve)=>server.close(resolve));
}
