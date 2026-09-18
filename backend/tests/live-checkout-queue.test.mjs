import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCheckoutQueue } from "../lib/live/checkout-queue.js";

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test("two buyers in one live receive their own results in FIFO order", async () => {
  const run = createCheckoutQueue(), gate = deferred(), entered = deferred(), calls = [];
  const alice = run("live-1", async () => { calls.push("alice"); entered.resolve(); await gate.promise; return { buyer: "alice", checkout: "A" }; });
  await entered.promise;
  const bob = run("live-1", async () => { calls.push("bob"); return { buyer: "bob", checkout: "B" }; });
  assert.notEqual(alice, bob);
  assert.deepEqual(calls, ["alice"]);
  gate.resolve();
  assert.deepEqual(await alice, { buyer: "alice", checkout: "A" });
  assert.deepEqual(await bob, { buyer: "bob", checkout: "B" });
  assert.deepEqual(calls, ["alice", "bob"]);
});

test("a failed request does not block or substitute the following buyer", async () => {
  const run = createCheckoutQueue();
  const first = run("live-1", () => { throw new Error("provider unavailable"); });
  const second = run("live-1", () => "second buyer");
  await assert.rejects(first, /provider unavailable/);
  assert.equal(await second, "second buyer");
});

test("independent lives are not blocked by each other", async () => {
  const run = createCheckoutQueue(), gate = deferred();
  const first = run("live-1", async () => { await gate.promise; return "first"; });
  assert.equal(await run("live-2", () => "other live"), "other live");
  gate.resolve();
  assert.equal(await first, "first");
});

test("a settled live can accept another operation", async () => {
  const run = createCheckoutQueue();
  assert.equal(await run("live-1", () => 1), 1);
  assert.equal(await run("live-1", () => 2), 2);
});

test("invalid calls reject rather than silently share a global queue", async () => {
  const run = createCheckoutQueue();
  await assert.rejects(run("", () => 1), TypeError);
  await assert.rejects(run("live", null), TypeError);
});

test("checkout uses FIFO, not cross-buyer promise deduplication", () => {
  const source = fs.readFileSync(new URL("../lib/live/checkout.js", import.meta.url), "utf8");
  assert.match(source, /import \{ runLiveCheckoutTask \} from "\.\/checkout-queue\.js"/);
  assert.match(source, /return runLiveCheckoutTask\("shipping-live:"/);
  assert.doesNotMatch(source, /withLiveLock\("shipping-live:/);
});
