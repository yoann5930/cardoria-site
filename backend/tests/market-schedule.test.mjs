import test from "node:test";
import assert from "node:assert/strict";
import { nextParisNoon } from "../lib/engine/market-schedule.js";

function iso(value) { return nextParisNoon(new Date(value)).toISOString(); }

test("summer schedule targets 12:00 Europe/Paris", () => {
  assert.equal(iso("2026-08-27T08:00:00.000Z"), "2026-08-27T10:00:00.000Z");
});

test("after Paris noon it targets next day", () => {
  assert.equal(iso("2026-08-27T10:30:00.000Z"), "2026-08-28T10:00:00.000Z");
});

test("winter schedule targets 12:00 Europe/Paris", () => {
  assert.equal(iso("2026-12-15T08:00:00.000Z"), "2026-12-15T11:00:00.000Z");
});

test("DST change keeps local noon stable", () => {
  assert.equal(iso("2026-10-24T11:30:00.000Z"), "2026-10-25T11:00:00.000Z");
});
