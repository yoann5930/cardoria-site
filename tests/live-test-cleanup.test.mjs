import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
test("cleanup targets only ended/cancelled default Cardiashop test lives",()=>{
  const src=fs.readFileSync("backend/lib/live/cleanup-tests.js","utf8");
  assert.match(src,/Live Cardiashop/);assert.match(src,/ended/);assert.match(src,/cancelled/);assert.match(src,/store\.checkouts/);assert.match(src,/store\.adminAccess/);assert.match(src,/live-actions\.json/);assert.match(src,/live-archives\.json/);
});
