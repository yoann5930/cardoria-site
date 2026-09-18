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
  await page.waitForSelector("#lasGroupSales");
  await page.waitForSelector("#lasBoxBreak");
  await page.waitForSelector("#lasGiveBuyer");
  const groups=await page.locator(".live-action-group-title").allTextContents();
  assert.deepEqual(groups,["Vendre","Jeux / breaks","Animation"]);
  for(const id of ["lasBuyNow","lasAuction","lasFlash","lasBreak","lasBoxBreak","lasGame","lasGiveaway","lasGiveBuyer"]){
    assert.equal(await page.locator("#"+id).isVisible(),true,id+" doit être visible");
    const h=await page.locator("#"+id).evaluate((el)=>el.getBoundingClientRect().height);
    assert.ok(h>=40,id+" doit être utilisable au clic");
  }
  assert.equal(await page.locator("#lasGiveFollow").isVisible(),false);
  await page.click("#lasAuction"); assert.equal(await page.locator("#lasSheetTitle").textContent(),"Enchère"); await page.click("#lasSheetCancel");
  await page.click("#lasFlash"); assert.equal(await page.locator("#lasSheetTitle").textContent(),"Vente flash"); await page.click("#lasSheetCancel");
  await page.click("#lasBreak"); assert.equal(await page.locator("#lasSheetTitle").textContent(),"Ouverture / break"); await page.click("#lasSheetCancel");
  await page.click("#lasBoxBreak"); assert.equal(await page.locator("#lasSheetTitle").textContent(),"Box Break"); await page.click("#lasSheetCancel");
  await page.click("#lasGame"); assert.equal(await page.locator("#lasSheetTitle").textContent(),"Jeu de l’énergie");
  await page.selectOption("#lasEnergyGameCount","2"); assert.equal(await page.locator("[data-energy-game-row]").count(),2);
  await page.fill("[data-energy-game-items='0']","EV10"); await page.click("[data-energy-game-preview='0']");
  await page.waitForFunction(()=>document.querySelector("[data-energy-game-preview-box='0']").textContent.includes("Spots détectés"));
  await page.click("#lasSheetCancel");
  await page.click("#lasGiveaway"); assert.equal(await page.locator("#lasSheetTitle").textContent(),"Giveaway"); await page.click("#lasSheetCancel");
  await page.click("#lasGiveBuyer"); assert.equal(await page.locator("#lasSheetTitle").textContent(),"Giveaway Acheteur");
  await page.click("#lasSheetGo"); await page.waitForTimeout(100);
  let calls=JSON.parse(await page.evaluate(()=>localStorage.getItem("__calls")||"[]"));
  assert.ok(calls.some((x)=>x.path.endsWith("/actions/giveaway/buyer/start")&&x.method==="POST"));
  await page.setViewportSize({width:390,height:844});
  await page.goto("http://127.0.0.1:"+port+"/admin-live.html",{waitUntil:"networkidle"});
  await page.waitForSelector("#lasGroupSales");
  const cols=await page.locator(".live-studio-actions").evaluate((el)=>getComputedStyle(el).gridTemplateColumns.split(" ").length);
  assert.equal(cols,1);
  for(const id of ["lasBuyNow","lasAuction","lasFlash","lasBreak","lasBoxBreak","lasGame","lasGiveaway","lasGiveBuyer"]) assert.equal(await page.locator("#"+id).isVisible(),true);
  const alerts=await page.evaluate(()=>window.__alerts); assert.deepEqual(alerts,[]);
  console.log("LIVE ADMIN SALES MENU BROWSER E2E OK");
} finally {
  await browser.close();
  await new Promise((resolve)=>server.close(resolve));
}
