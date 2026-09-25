import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("admin orders page uses a fresh cache-busted runtime asset", () => {
  for (const path of ["admin-commandes.html", "backend/public/admin-commandes.html"]) {
    const html = read(path);
    assert.match(html, /admin-orders\.js\?v=20260925-preparing-label-2/);
    assert.doesNotMatch(html, /admin-orders\.js\?v=20260921-shipping-1/);
  }
});

test("all admin HTML, JS and CSS surfaces are served no-store", () => {
  const server = read("backend/server.js");
  assert.match(server, /requestPath\.startsWith\("\/admin-"\)/);
  assert.match(server, /requestPath\.startsWith\("\/js\/admin\/"\)/);
  assert.match(server, /requestPath\.startsWith\("\/css\/admin"\)/);
  assert.match(server, /no-store, no-cache, must-revalidate, max-age=0/);
});
