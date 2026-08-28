import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const corePath = "js/admin/admin-core.js";
const core = fs.readFileSync(corePath, "utf8");

function navItems() {
  const rows = [];
  const re = /\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*page:\s*"([^"]+)"\s*\}/g;
  let match;
  while ((match = re.exec(core))) rows.push({ href: match[1], label: match[2], page: match[3] });
  return rows;
}

function adminScripts(html) {
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1].split("?")[0].replace(/^\//, ""))
    .filter((p) => p.startsWith("js/admin/") && p !== corePath);
}

function renderedPageIds(scriptSource) {
  return new Set([...scriptSource.matchAll(/\.renderShell\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
}

function dynamicallyRendersPage(scriptSource, pageId) {
  if (!scriptSource.includes(pageId)) return false;
  return /\.renderShell\(\s*(?:page|activePage|viewPage)\s*,/.test(scriptSource);
}

test("admin navigation has unique page ids and no dashboard entry", () => {
  const items = navItems();
  assert.ok(items.length >= 20, `navigation unexpectedly small: ${items.length}`);
  assert.equal(items.some((item) => item.href === "admin.html" || item.page === "dashboard"), false);
  const ids = items.map((item) => item.page);
  assert.equal(new Set(ids).size, ids.length, "duplicate page id in admin navigation");
});

test("every admin navigation target exists and loads the shared admin core", () => {
  for (const item of navItems()) {
    assert.ok(fs.existsSync(item.href), `${item.label}: missing ${item.href}`);
    const html = fs.readFileSync(item.href, "utf8");
    assert.match(html, /\/js\/admin\/admin-core\.js(?:\?[^"']*)?/, `${item.href}: admin-core.js missing`);
    assert.ok(adminScripts(html).length > 0, `${item.href}: no page admin script loaded`);
  }
});

test("every navigation page id is rendered by the scripts loaded on its target page", () => {
  for (const item of navItems()) {
    const html = fs.readFileSync(item.href, "utf8");
    const scripts = adminScripts(html);
    const sources = scripts.map((script) => {
      assert.ok(fs.existsSync(script), `${item.href}: missing script ${script}`);
      return fs.readFileSync(script, "utf8");
    }).join("\n");
    const ids = renderedPageIds(sources);
    const valid = ids.has(item.page) || dynamicallyRendersPage(sources, item.page);
    assert.ok(valid, `${item.href}: nav expects ${item.page}, rendered ids are ${[...ids].join(", ") || "none"}`);
  }
});

test("legacy admin dashboard redirects to Stock and is not a second navigation root", () => {
  const html = fs.readFileSync("admin.html", "utf8");
  assert.match(html, /admin-stock\.html/);
  assert.doesNotMatch(html, /admin-dashboard\.js/);
});
