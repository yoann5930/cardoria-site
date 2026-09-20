import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html=fs.readFileSync("boutique.html","utf8");
const runtimeHtml=fs.readFileSync("backend/public/boutique.html","utf8");
const js=fs.readFileSync("js/boutique.js","utf8");
const runtimeJs=fs.readFileSync("backend/public/js/boutique.js","utf8");
const css=fs.readFileSync("css/boutique-v2.css","utf8");
const runtimeCss=fs.readFileSync("backend/public/css/boutique-v2.css","utf8");

test("boutique exposes an accessible instant-search combobox",()=>{
  for(const id of ["search","shopSearchClear","shopQuickResults","shopSearchCount"]) assert.ok(html.includes('id="'+id+'"'),"missing "+id);
  assert.match(html,/role="combobox"/);
  assert.match(html,/aria-autocomplete="list"/);
  assert.match(html,/aria-controls="shopQuickResults"/);
  assert.match(html,/boutique\.js\?v=20260921-quick-search-1/);
  assert.match(html,/boutique-v2\.css\?v=20260921-quick-search-1/);
});

test("boutique search is local, indexed and accent tolerant",()=>{
  assert.match(js,/function normalizeSearch\(value\)/);
  assert.match(js,/\.normalize\("NFD"\)/);
  assert.match(js,/replace\(\/\[\\u0300-\\u036f\]\/g, ""\)/);
  assert.match(js,/function buildSearchIndex\(\)/);
  assert.match(js,/name: normalizeSearch\(product\.name\)/);
  assert.match(js,/extension: normalizeSearch\(product\.extension\)/);
  assert.match(js,/number: normalizeSearch\(product\.number\)/);
  assert.match(js,/rarity: normalizeSearch\(product\.rarity\)/);
  assert.match(js,/condition: normalizeSearch\(product\.condition\)/);
  assert.match(js,/products = data\.products;\s*buildSearchIndex\(\);/);
  assert.match(js,/input\.addEventListener\("input", scheduleSearchRender\)/);
  assert.match(js,/requestAnimationFrame/);
});

test("quick suggestions show useful buying information and keyboard navigation",()=>{
  assert.match(js,/matches\.slice\(0, 6\)/);
  assert.match(js,/data-quick-product/);
  assert.match(js,/product\.price/);
  assert.match(js,/product\.stock/);
  for(const key of ["ArrowDown","ArrowUp","Enter","Escape"]) assert.ok(js.includes('"'+key+'"'),"missing keyboard key "+key);
  assert.match(js,/selectQuickProduct/);
  assert.match(js,/scrollIntoView/);
});

test("quick-search change preserves cart, authentication and SumUp checkout",()=>{
  assert.match(js,/cardoria_boutique_cart/);
  assert.match(js,/cardoria_session_token/);
  assert.match(js,/\/api\/auth\/me/);
  assert.match(js,/\/api\/payments\/boutique\/checkout/);
  assert.match(js,/provider:\s*"sumup"/);
});

test("quick-search runtime mirrors are identical",()=>{
  assert.equal(runtimeHtml,html);
  assert.equal(runtimeJs,js);
  assert.equal(runtimeCss,css);
});
