import assert from "node:assert/strict";
import test from "node:test";
import { interleaveStereo, isolationRatio, splitStereo, tokenUrl } from "../src/audio-mix.mjs";

test("left-only stream has no right-channel energy", () => {
  const left = new Float32Array([0.5, -0.4, 0.3]);
  const right = new Float32Array([0, 0, 0]);
  const stereo = interleaveStereo(left, right);
  const split = splitStereo(stereo);
  const iso = isolationRatio(split.left, split.right);
  assert.ok(iso.leftPeak > 0.4);
  assert.equal(iso.rightPeak, 0);
  assert.ok(iso.leftIsolation > 100);
});

test("right-only stream has no left-channel energy", () => {
  const stereo = interleaveStereo([0, 0, 0], [0.8, -0.7, 0.1]);
  const split = splitStereo(stereo);
  const iso = isolationRatio(split.left, split.right);
  assert.equal(iso.leftPeak, 0);
  assert.ok(iso.rightPeak > 0.7);
});

test("token URLs point at generated assets", () => {
  assert.equal(tokenUrl("8"), "assets/audio/digit-8.wav");
  assert.equal(tokenUrl("R"), "assets/audio/letter-R.wav");
});
