import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const required = [
  "index.html",
  "src/app.js",
  "src/pbm-core.mjs",
  "src/controls.mjs",
  "src/audio.js",
  "src/audio-mix.mjs",
  "src/render.js",
  "css/app.css",
];

const tokens = [
  "digit-0.wav", "digit-8.wav", "digit-7.wav",
  "letter-A.wav", "letter-R.wav",
  "attend-left.wav", "attend-right.wav",
  "tone-left.wav", "tone-right.wav",
  "engine-fire.wav",
];

test("trainer files are present", () => {
  for (const f of required) {
    assert.equal(existsSync(join(root, f)), true, f);
  }
});

test("dichotic wav tokens exist and are real WAVE files", () => {
  for (const f of tokens) {
    const p = join(root, "assets/audio", f);
    assert.equal(existsSync(p), true, f);
    const buf = readFileSync(p);
    assert.equal(buf.slice(0, 4).toString(), "RIFF");
    assert.ok(buf.length > 400, `${f} too small`);
  }
});
