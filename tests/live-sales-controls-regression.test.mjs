import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const actions=read('backend/lib/live/actions.js');
const checkout=read('backend/lib/live/checkout.js');
const saleRules=read('backend/lib/live/sale-rules.js');
const adminRoutes=read('backend/routes/live-admin-studio.js');
const sellerRoutes=read('backend/routes/live-actions.js');
const controls=read('js/live-studio-sales-controls.js');
const controlsMirror=read('backend/public/js/live-studio-sales-controls.js');
const catalog=read('backend/lib/live/energy-catalog.js');
const spectator=read('js/live-energy-spots.js');

test('Box Break stays an explicit regular lot mode',()=>{
  assert.match(actions,/box_break/);
  assert.match(controls,/lasBoxBreak/);
});

test('energy game does not require a pre-existing sale lot',()=>{
  assert.match(controls,/function startEnergyGame\(\).*requireLive/);
  assert.match(actions,/export async function startEnergyGame/);
  assert.match(actions,/virtualProduct:true/);
  assert.match(checkout,/energyBreak/);
});

test('operator chooses 1-10 games or Other',()=>{
  assert.match(controls,/for\(var i=1;i<=10;i\+\+\)/);
  assert.match(controls,/>Autre</);
  assert.match(controls,/lasEnergyGameCountOther/);
});

test('each game defines its format and item sources',()=>{
  assert.match(controls,/Box Break/);
  assert.match(controls,/Scellé/);
  assert.match(controls,/À l’unité/);
  assert.match(controls,/data-energy-game-format/);
  assert.match(controls,/data-energy-game-units/);
  assert.match(controls,/data-energy-game-items/);
  assert.match(controls,/EV10 \+ ME01/);
});

test('Pokemon items are resolved from TCGdex internet data',()=>{
  assert.match(catalog,/api\.tcgdex\.net\/v2\/fr/);
  assert.match(catalog,/\/sets/);
  assert.match(catalog,/\/cards/);
  assert.match(catalog,/Dresseur \/ Supporter/);
  assert.match(catalog,/Objet \/ Stade/);
  assert.match(sellerRoutes,/energy-catalog\/resolve/);
  assert.match(controls,/Rechercher les énergies/);
});

test('French EV shorthand maps to Scarlet Violet catalog ids',()=>{
  assert.match(catalog,/\^ev/);
  assert.match(catalog,/return"sv"/);
});

test('backend generates unique energy spots for every game',()=>{
  assert.match(actions,/`Jeu \$\{i\+1\} — \$\{spot\}`/);
  assert.match(actions,/spotLabels:labels/);
  assert.match(checkout,/assertEnergySpotAvailable/);
  assert.match(saleRules,/spotLabels/);
});

test('admin and seller energy-game routes await catalog resolution',()=>{
  assert.match(adminRoutes,/await startEnergyGame/);
  assert.match(sellerRoutes,/await startEnergyGame/);
});

test('virtual energy spots still use the existing checkout and shipping flow',()=>{
  assert.match(checkout,/productOverride:product/);
  assert.match(checkout,/shippingUnitWeightGrams/);
  assert.match(checkout,/assertSaleProvider/);
});

test('spectator still buys a named energy spot',()=>{
  assert.match(spectator,/data-buy-energy/);
  assert.match(spectator,/spotLabel:spotLabel/);
});

test('runtime mirrors stay byte-identical',()=>{
  assert.equal(controls,controlsMirror);
});

test('follow giveaway stays hidden while paid-buyer giveaway is enabled for admin',()=>{
  assert.match(controls,/follow\.hidden=true/);
  assert.match(controls,/buyer\.onclick=startBuyerGiveaway/);
  assert.match(controls,/giveaway\/buyer\/start/);
  assert.match(adminRoutes,/giveaway\/buyer\/start/);
});

test('no MutationObserver loop is reintroduced',()=>{
  assert.doesNotMatch(controls,/new MutationObserver/);
  assert.match(controls,/setInterval\(decorate,1000\)/);
});
