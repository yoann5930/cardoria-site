import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";

const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({path:path.resolve("js/live-shipping-address.js")});
  const result=await page.evaluate(()=>{
    const answers=["Jean Dupont","12 rue des Cartes","","59330","Hautmont","FR","0600000000"];
    let calls=0;
    window.alert=()=>{};
    window.prompt=()=>{calls++;return answers.shift();};
    const first=window.CardoriaLiveShippingAddress.collect({liveId:"LIVE-E2E",email:"buyer@example.com",name:"Pseudo"});
    const callsAfterFirst=calls;
    const second=window.CardoriaLiveShippingAddress.collect({liveId:"LIVE-E2E",email:"buyer@example.com",name:"Pseudo"});
    return {first,second,callsAfterFirst,callsAfterSecond:calls};
  });
  assert.equal(result.first.recipientName,"Jean Dupont");
  assert.equal(result.first.addressLine1,"12 rue des Cartes");
  assert.equal(result.first.postalCode,"59330");
  assert.equal(result.first.city,"Hautmont");
  assert.equal(result.first.countryCode,"FR");
  assert.deepEqual(result.second,result.first);
  assert.equal(result.callsAfterFirst,7);
  assert.equal(result.callsAfterSecond,7);
  console.log("Postal address collector Chromium E2E: OK");
} finally {
  await browser.close();
}
