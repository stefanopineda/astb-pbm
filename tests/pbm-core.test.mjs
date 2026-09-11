import assert from "node:assert/strict";
import test from "node:test";
import {
  BATTERY,
  expectedDltResponse,
  gradeDltResponse,
  isEvenDigit,
  makePair,
  mulberry32,
  speedAt,
  SPEED_SCHEDULES,
  createTarget,
  stepTarget,
  isOnTarget,
  lagToward,
  throttleToY,
  stickToPoint,
  createTrackingStats,
  pushTrackingSample,
  summarizeTracking,
  createDltStats,
  pushDltGrade,
  summarizeDlt,
  compositeScore,
  clamp,
} from "../src/pbm-core.mjs";

test("even digits are stick, odd digits are throttle, letters are ignored", () => {
  assert.equal(isEvenDigit("8"), true);
  assert.equal(isEvenDigit("2"), true);
  assert.equal(isEvenDigit("0"), true);
  assert.equal(isEvenDigit("7"), false);
  assert.equal(isEvenDigit("A"), null);
  assert.equal(expectedDltResponse("L", "8", "7"), "STICK");
  assert.equal(expectedDltResponse("L", "7", "8"), "THROTTLE");
  assert.equal(expectedDltResponse("R", "7", "8"), "STICK");
  assert.equal(expectedDltResponse("L", "A", "8"), null);
  assert.equal(expectedDltResponse("R", "A", "B"), null);
});

test("DLT grades hits, misses, false alarms, wrong button, late", () => {
  assert.equal(gradeDltResponse("STICK", "STICK", 220), "HIT");
  assert.equal(gradeDltResponse("STICK", "THROTTLE", 180), "WRONG_BUTTON");
  assert.equal(gradeDltResponse("STICK", null, 0), "MISS");
  assert.equal(gradeDltResponse(null, "STICK", 100), "FALSE_ALARM");
  assert.equal(gradeDltResponse(null, null, 0), "CORRECT_REJECTION");
  assert.equal(gradeDltResponse("STICK", "STICK", 950, 800), "LATE");
});

test("ignored-ear digits must not demand a response", () => {
  // Left ear has 4 (even), but we are attending RIGHT which has a letter.
  assert.equal(expectedDltResponse("R", "4", "M"), null);
  assert.equal(gradeDltResponse(null, "STICK", 90), "FALSE_ALARM");
});

test("token pairs are never identical", () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 200; i++) {
    const p = makePair(rng);
    assert.notEqual(p.left, p.right);
  }
});

test("speed schedule steps at published intervals", () => {
  const s = SPEED_SCHEDULES.vtt;
  assert.equal(speedAt(0, s), s.speeds[0]);
  assert.equal(speedAt(19.9, s), s.speeds[0]);
  assert.equal(speedAt(20, s), s.speeds[1]);
  assert.equal(speedAt(40, s), s.speeds[2]);
  assert.equal(SPEED_SCHEDULES.multi.duration, 180);
  assert.equal(SPEED_SCHEDULES.att.duration, 60);
});

test("VTT target only moves on Y and bounces at the pad", () => {
  const rng = mulberry32(1);
  let t = createTarget({ axis: "y", x: 40, y: 40, speed: 200, rng });
  t.heading = 0;
  t.vy = -1;
  t.vx = 0;
  const x0 = t.x;
  for (let i = 0; i < 40; i++) {
    t = stepTarget(t, 0.016, { width: 120, height: 400, pad: 30, speed: 200, rng, onTarget: false });
  }
  assert.equal(t.x, x0);
  assert.ok(t.y >= 30);
});

test("ATT target redirects after a sustained on-target hold", () => {
  const rng = mulberry32(3);
  let t = createTarget({ axis: "xy", x: 200, y: 200, speed: 80, rng });
  const heading0 = t.heading;
  for (let i = 0; i < 70; i++) {
    t = stepTarget(t, 0.016, {
      width: 400,
      height: 400,
      pad: 20,
      speed: 80,
      rng,
      onTarget: true,
    });
  }
  assert.notEqual(t.heading, heading0);
});

test("on-target uses Y-only for VTT and 2D radius for ATT", () => {
  assert.equal(isOnTarget({ x: 0, y: 100 }, { axis: "y", x: 40, y: 110 }, 22), true);
  assert.equal(isOnTarget({ x: 0, y: 100 }, { axis: "y", x: 40, y: 160 }, 22), false);
  assert.equal(isOnTarget({ x: 100, y: 100 }, { axis: "xy", x: 110, y: 108 }, 22), true);
  assert.equal(isOnTarget({ x: 100, y: 100 }, { axis: "xy", x: 160, y: 160 }, 22), false);
});

test("reticle lag damps step inputs so over-correction overshoots", () => {
  let y = 0;
  y = lagToward(y, 100, 0.05, 0.05);
  assert.ok(y > 0 && y < 100);
  for (let i = 0; i < 40; i++) y = lagToward(y, 100, 0.05, 0.05);
  assert.ok(y > 99);
});

test("throttle 0 is bottom of the lane, 1 is top", () => {
  assert.equal(throttleToY(0, 400, 20), 380);
  assert.equal(throttleToY(1, 400, 20), 20);
});

test("stick center maps to canvas center", () => {
  const p = stickToPoint(0, 0, 400, 300, 0);
  assert.equal(p.x, 200);
  assert.equal(p.y, 150);
});

test("tracking summary is percent-on-target weighted", () => {
  const s = createTrackingStats();
  for (let i = 0; i < 80; i++) pushTrackingSample(s, 8, true);
  for (let i = 0; i < 20; i++) pushTrackingSample(s, 40, false);
  const sum = summarizeTracking(s);
  assert.equal(sum.pctOnTarget, 80);
  assert.ok(sum.score > 70);
  assert.ok(sum.rmsError > 0);
});

test("DLT false alarms drag the practice score down", () => {
  const clean = createDltStats();
  for (let i = 0; i < 20; i++) pushDltGrade(clean, "HIT", 250);
  const dirty = createDltStats();
  for (let i = 0; i < 20; i++) pushDltGrade(dirty, "HIT", 250);
  for (let i = 0; i < 8; i++) pushDltGrade(dirty, "FALSE_ALARM", 100);
  assert.ok(summarizeDlt(clean).score > summarizeDlt(dirty).score);
});

test("full battery order matches the published PBM sequence", () => {
  assert.deepEqual(
    BATTERY.map((b) => b.mode),
    ["dlt", "dlt", "vtt", "att", "avtt", "multi", "emergency"],
  );
  assert.equal(BATTERY[0].ear, "L");
  assert.equal(BATTERY[1].ear, "R");
});

test("composite ignores missing modules", () => {
  const n = compositeScore({ att: { score: 80 }, vtt: { score: 60 } });
  assert.ok(n > 60 && n < 80);
  assert.equal(clamp(120, 0, 100), 100);
});
