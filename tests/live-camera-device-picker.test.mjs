import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin Live exposes visible camera input selectors and permission refresh", () => {
  const page = read("admin-live.html");
  const runtimePage = read("backend/public/admin-live.html");
  const picker = read("js/cardoria-live-device-picker.js");
  const runtimePicker = read("backend/public/js/cardoria-live-device-picker.js");

  assert.equal(runtimePage, page);
  assert.equal(runtimePicker, picker);
  assert.match(page, /cardoria-live-device-picker\.js/);
  assert.match(picker, /Entrée vidéo Caméra 1/);
  assert.match(picker, /Entrée vidéo Caméra 2/);
  assert.match(picker, /Autoriser \/ actualiser les caméras/);
  assert.match(picker, /getUserMedia\(\{ video: true, audio: false \}\)/);
  assert.match(picker, /enumerateDevices\(\)/);
  assert.match(picker, /device\.kind === "videoinput"/);
  assert.match(picker, /liveCameraSelect1/);
  assert.match(picker, /liveCameraSelect2/);
  assert.match(picker, /cardoria_live_camera_primary/);
  assert.match(picker, /cardoria_live_camera_secondary/);
  assert.match(picker, /devicechange/);
});
