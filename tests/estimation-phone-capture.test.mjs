// Camera UI regression: QR page must stay dark, branded and full-screen.
// Direct-camera QR regression: getUserMedia remains the primary mobile capture path.
// Regression tests for mandatory estimation photos and PC-to-phone QR capture.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateEstimationPayload } from "../backend/routes/estimation.js";
import {
  addCapturePhotos,
  createCaptureSession,
  deleteCaptureSession,
  getCapturePhotos,
  getCaptureStatus
} from "../backend/lib/estimation/capture-sessions.js";

const SAMPLE = "data:image/jpeg;base64,AA==";

test("estimation rejects requests without a photo", () => {
  const result = validateEstimationPayload({ cardName: "Pikachu", imagesBase64: [] });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /photo/i);
});

test("estimation accepts a valid image data URL", () => {
  const result = validateEstimationPayload({ cardName: "Pikachu", imagesBase64: [SAMPLE] });
  assert.equal(result.ok, true);
  assert.equal(result.body.imagesBase64.length, 1);
});

test("temporary phone capture session stores and returns photos", () => {
  const session = createCaptureSession({ origin: "https://www.cardoriashop.fr" });
  assert.ok(session.sessionId);
  assert.match(session.captureUrl, /estimation-photo\.html\?session=/);

  const before = getCaptureStatus(session.sessionId);
  assert.equal(before.count, 0);

  const added = addCapturePhotos(session.sessionId, [SAMPLE]);
  assert.equal(added.ok, true);
  assert.equal(added.count, 1);

  const duplicate = addCapturePhotos(session.sessionId, [SAMPLE]);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.count, 1);

  const photos = getCapturePhotos(session.sessionId);
  assert.deepEqual(photos.imagesBase64, [SAMPLE]);

  assert.equal(deleteCaptureSession(session.sessionId), true);
  assert.equal(getCaptureStatus(session.sessionId), null);
});

test("desktop and mirrored estimation pages stay synchronized", () => {
  const root = fs.readFileSync(new URL("../estimation.html", import.meta.url), "utf8");
  const mirror = fs.readFileSync(new URL("../backend/public/estimation.html", import.meta.url), "utf8");
  assert.equal(root, mirror);
  assert.match(root, /id="estimateSubmit"[^>]*disabled/);
  assert.match(root, /id="phoneCaptureQr"/);
  assert.match(root, /estimation-phone-capture\.js/);
});

test("mobile capture page opens a direct camera preview with fallback only", () => {
  const root = fs.readFileSync(new URL("../estimation-photo.html", import.meta.url), "utf8");
  const mirror = fs.readFileSync(new URL("../backend/public/estimation-photo.html", import.meta.url), "utf8");
  const script = fs.readFileSync(new URL("../js/estimation-phone.js", import.meta.url), "utf8");
  const scriptMirror = fs.readFileSync(new URL("../backend/public/js/estimation-phone.js", import.meta.url), "utf8");

  assert.equal(root, mirror);
  assert.equal(script, scriptMirror);
  assert.match(root, /noindex,nofollow/);
  assert.match(root, /class="estimation-camera-body"/);
  assert.match(root, /class="camera-app"/);
  assert.match(root, /id="phoneCameraPreview"/);
  assert.match(root, /id="phoneCameraShot"[^>]*camera-shot/);
  assert.match(root, /id="phoneCameraFlash"/);
  assert.match(root, /background:#050608!important/);
  assert.match(root, /id="phoneCameraFallback"[^>]*hidden/);
  assert.match(script, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(script, /facingMode:\s*\{\s*ideal:\s*"environment"/);
  assert.match(script, /videoFrameToDataUrl/);
  assert.match(root, /id="phoneCameraFile"[^>]*capture="environment"/);
});


test("OVH exposes a safe production estimation capture diagnostic", () => {
  const ops = fs.readFileSync(new URL("../oracle/cardoria-ops.sh", import.meta.url), "utf8");
  const wrapper = fs.readFileSync(new URL("../oracle/cardoria-ops-ssh-wrapper.sh", import.meta.url), "utf8");
  const sudoers = fs.readFileSync(new URL("../oracle/sudoers-cardoria-ops", import.meta.url), "utf8");
  assert.match(ops, /cmd_estimation_capture_check\(\)/);
  assert.match(ops, /capture_create_http/);
  assert.match(ops, /capture_upload_http/);
  assert.match(ops, /capture_fetch_http/);
  assert.match(ops, /ESTIMATION CAPTURE CHECK OK/);
  assert.match(wrapper, /cardoria-ops estimation-capture-check/);
  assert.match(sudoers, /cardoria-ops estimation-capture-check/);
});
