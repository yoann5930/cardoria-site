import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("css/home-reference.css","utf8");

const required=[
  ["/","Accueil"],
  ["/boutique.html","Boutique"],
  ["/marketplace.html","Marketplace"],
  ["/estimation.html","Estimation"],
  ["/live.html","Live"],
  ["/client-login.html","Connexion"],
  ["/pages/contact/","Contact"],
  ["/admin-login.html","Admin"]
];

test("homepage exposes explicit mobile navigation for all primary destinations",()=>{
  assert.match(html,/class="home-mobile-nav"/);
  assert.match(html,/aria-current="page"/);
  for(const [href,label] of required){
    assert.ok(html.includes(`href="${href}"`),`missing ${label} -> ${href}`);
  }
});

test("mobile navigation is touch friendly and responsive",()=>{
  assert.match(css,/\.home-mobile-nav\{display:none\}/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.home-mobile-nav\{[^}]*display:grid/);
  assert.match(css,/\.home-mobile-nav a\{[^}]*min-height:44px/);
  assert.match(css,/@media\(max-width:420px\)[\s\S]*grid-template-columns:1fr/);
});

test("homepage primary navigation targets exist in repository",()=>{
  const localTargets=[
    "boutique.html",
    "marketplace.html",
    "estimation.html",
    "live.html",
    "client-login.html",
    "pages/contact/index.html",
    "admin-login.html"
  ];
  for(const file of localTargets) assert.ok(fs.existsSync(file),`missing target ${file}`);
});

test("runtime mirror contains same homepage navigation after sync",()=>{
  const runtime=fs.readFileSync("backend/public/index.html","utf8");
  assert.equal(runtime,html);
});
