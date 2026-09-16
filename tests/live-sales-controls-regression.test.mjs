import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const actions = read('backend/lib/live/actions.js');
const checkout = read('backend/lib/live/checkout.js');
const saleRules = read('backend/lib/live/sale-rules.js');
const adminRoutes = read('backend/routes/live-admin-studio.js');
const sellerRoutes = read('backend/routes/live-actions.js');
const liveRoutes = read('backend/routes/live.js');
const controls = read('js/live-studio-sales-controls.js');
const controlsMirror = read('backend/public/js/live-studio-sales-controls.js');
const energyPublic = read('js/live-energy-spots.js');
const energyPublicMirror = read('backend/public/js/live-energy-spots.js');
const adminHtml = read('admin-live.html');
const adminHtmlMirror = read('backend/public/admin-live.html');
const sellerHtml = read('live-vendeur.html');
const sellerHtmlMirror = read('backend/public/live-vendeur.html');
const liveHtml = read('live.html');
const liveHtmlMirror = read('backend/public/live.html');

test('Box Break and energy game are explicit live break modes', () => {
  assert.match(actions, /\["break","box_break","energy_game"\]/);
  assert.match(actions, /type==="box_break"\?"Box Break"/);
  assert.match(controls, /id="lasBoxBreak"|id='lasBoxBreak'|id=\"lasBoxBreak\"/);
  assert.match(controls, /Jeu de l’énergie/);
});

test('energy game spots come from the selected item configuration, never the full hardcoded list', () => {
  assert.match(actions, /energyTypesByProduct/);
  assert.match(actions, /setLiveProductEnergyTypes/);
  assert.match(actions, /const configured=normalizeEnergyTypes\(state\.energyTypesByProduct\?\.\[product\.id\]\)/);
  assert.match(actions, /type==="energy_game"\?configured/);
  assert.doesNotMatch(actions, /type==="energy_game"\?\[\.\.\.ENERGY_SPOTS\]/);
  assert.match(controls, /state\.energyTypesByProduct&&state\.energyTypesByProduct\[c\.productId\]/);
  assert.match(controls, /Spots générés automatiquement depuis l’item/);
});

test('only known Cardoria energy categories can be stored for an item', () => {
  for (const label of ['Plante','Feu','Eau','Électrique','Psy','Combat','Obscurité','Métal','Dragon','Incolore','Dresseur / Supporter','Objet / Stade']) {
    assert.ok(actions.includes(label), `missing energy category ${label}`);
  }
  assert.match(actions, /if\(!types\.length\)throw/);
});

test('admin and seller expose protected item energy configuration routes', () => {
  assert.match(adminRoutes, /actions\/energy-config/);
  assert.match(adminRoutes, /setLiveProductEnergyTypes/);
  assert.match(sellerRoutes, /seller\/:liveId\/energy-config/);
  assert.match(sellerRoutes, /assertSellerOwner/);
});

test('named energy spot is carried and reserved by checkout', () => {
  assert.match(saleRules, /breakType/);
  assert.match(saleRules, /spotLabels/);
  assert.match(checkout, /assertEnergySpotAvailable/);
  assert.match(checkout, /spotLabel:selectedSpot/);
  assert.match(checkout, /Le spot \$\{canonical\} est déjà réservé ou vendu/);
  assert.match(checkout, /\["planned","pending","paid","completed","authorized","authorised"\]/);
  assert.match(liveRoutes, /spotLabel: body\.spotLabel/);
});

test('spectator gets one purchase button per energy spot', () => {
  assert.match(energyPublic, /data-buy-energy/);
  assert.match(energyPublic, /spotLabel:spotLabel/);
  assert.match(energyPublic, /Jeu de l’énergie — choisissez votre spot/);
  assert.match(energyPublic, /x\.hidden=true/);
});

test('new live runtimes are loaded on admin, seller and spectator pages', () => {
  assert.match(adminHtml, /live-studio-sales-controls\.js/);
  assert.match(sellerHtml, /live-studio-sales-controls\.js/);
  assert.match(liveHtml, /live-energy-spots\.js/);
});

test('runtime mirrors stay byte-identical', () => {
  assert.equal(controls, controlsMirror);
  assert.equal(energyPublic, energyPublicMirror);
  assert.equal(adminHtml, adminHtmlMirror);
  assert.equal(sellerHtml, sellerHtmlMirror);
  assert.equal(liveHtml, liveHtmlMirror);
});

test('unimplemented social eligibility giveaways are not exposed as fake working controls', () => {
  assert.match(controls, /lasGiveFollow/);
  assert.match(controls, /follow\.hidden=true/);
  assert.match(controls, /lasGiveBuyer/);
  assert.match(controls, /buyer\.hidden=true/);
});
