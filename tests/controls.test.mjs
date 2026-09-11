import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlBus,
  DEFAULT_PROFILE,
  cloneProfile,
  detectMovedAxis,
  detectPressedButton,
  mappingChecklist,
  migrateThrottleAxis,
  pinThrottleLever,
  readButton,
  THROTTLE_LEVER_AXIS,
  snapshotPad,
  stickNorm,
  throttle01,
  looksLikeX52,
} from "../src/controls.mjs";

function fakePad({ axes = [0, 0, 0, 0], buttons = [], id = "Saitek X52 Flight Control System", index = 0 } = {}) {
  return {
    id,
    index,
    axes,
    buttons: buttons.map((pressed) => ({ pressed: !!pressed, value: pressed ? 1 : 0 })),
  };
}

test("default X-52 throttle is the push/pull lever (HID Z / axis 2), not the Rx thumb wheel (axis 3)", () => {
  assert.equal(THROTTLE_LEVER_AXIS, 2);
  assert.equal(DEFAULT_PROFILE.throttle.axis, 2);
  assert.equal(DEFAULT_PROFILE.throttle.invert, true);
  assert.equal(migrateThrottleAxis({ throttle: { axis: 3, invert: false } }).throttle.axis, 2);
  assert.equal(migrateThrottleAxis({ throttle: { axis: 3, invert: false } }).throttle.invert, true);
  assert.equal(pinThrottleLever({ axis: 3, invert: false }).axis, 2);
  assert.equal(pinThrottleLever({ axis: 3, invert: false }).invert, true);
});

test("X-52 id detection", () => {
  assert.equal(looksLikeX52("Saitek X52 Flight Control System"), true);
  assert.equal(looksLikeX52("Logitech X52 Professional HOTAS"), true);
  assert.equal(looksLikeX52("Xbox Wireless Controller"), false);
});

test("stickNorm applies invert and deadzone", () => {
  const spec = { min: -1, max: 1, invert: true, deadzone: 0.1 };
  assert.ok(Math.abs(stickNorm(0, spec)) < 1e-9);
  // raw +1 with invert → visual down, which is n = -1 after 0..1 invert
  assert.ok(stickNorm(1, spec) < -0.9);
  assert.ok(stickNorm(-1, spec) > 0.9);
});

test("throttle01 maps rest-to-max into 0..1", () => {
  const spec = { min: -1, max: 1, invert: false, deadzone: 0.02 };
  assert.ok(throttle01(-1, spec) < 0.05);
  assert.ok(throttle01(1, spec) > 0.95);
  const inverted = { ...spec, invert: true };
  assert.ok(throttle01(-1, inverted) > 0.95);
});

test("detectMovedAxis picks the axis that actually traveled", () => {
  const rest = fakePad({ axes: [0, 0, 0, -0.2] });
  const live = fakePad({ axes: [0, 0, 0, 0.8] });
  const hit = detectMovedAxis(rest, live, { wantPositive: true, minDelta: 0.18 });
  assert.equal(hit.axis, 3);
  assert.equal(hit.invert, false);
});

test("detectMovedAxis sets invert when the axis went the other way", () => {
  const rest = fakePad({ axes: [0, 0] });
  const live = fakePad({ axes: [0, -0.9] });
  const hit = detectMovedAxis(rest, live, { wantPositive: true });
  assert.equal(hit.axis, 1);
  assert.equal(hit.invert, true);
});

test("detectPressedButton returns the first newly-down index", () => {
  const rest = fakePad({ buttons: [false, false, false] });
  const live = fakePad({ buttons: [false, true, false] });
  assert.equal(detectPressedButton(rest, live), 1);
  assert.equal(detectPressedButton(live, live), null);
});

test("ControlBus emits DLT edges, not levels", () => {
  const bus = new ControlBus(cloneProfile(DEFAULT_PROFILE));
  const held = [true, false, false, false, false, false, false];
  const pad = fakePad({ axes: [0, 0, 0, 0], buttons: held });
  const a = bus.poll([pad]);
  const b = bus.poll([pad]);
  assert.equal(a.dlt, "STICK");
  assert.equal(b.dlt, null);
});

test("ControlBus throttle thumb is DLT THROTTLE on the default X-52 D button", () => {
  const bus = new ControlBus(cloneProfile(DEFAULT_PROFILE));
  const buttons = Array(8).fill(false);
  buttons[6] = true;
  const a = bus.poll([fakePad({ buttons })]);
  assert.equal(a.dlt, "THROTTLE");
});

test("keyboard fallback drives stick, throttle, and both DLT buttons", () => {
  const bus = new ControlBus(cloneProfile(DEFAULT_PROFILE));
  bus.keys.add("ArrowRight");
  bus.keys.add("KeyW");
  const rest = bus.poll([]);
  assert.ok(rest.nx > 0.5);
  assert.ok(rest.ny < -0.5);
  bus.keys.clear();
  bus.keys.add("Space");
  assert.equal(bus.poll([]).dlt, "STICK");
  bus.keys.clear();
  bus.keys.add("ShiftLeft");
  assert.equal(bus.poll([]).dlt, "THROTTLE");
});

test("emergency T-keys fire once per press", () => {
  const bus = new ControlBus(cloneProfile(DEFAULT_PROFILE));
  const buttons = Array(14).fill(false);
  buttons[8] = true;
  const a = bus.poll([fakePad({ buttons })]);
  const b = bus.poll([fakePad({ buttons })]);
  assert.deepEqual(a.emergencies, ["T1"]);
  assert.deepEqual(b.emergencies, []);
});

test("mapping checklist is red until audio and device probes pass", () => {
  const r = mappingChecklist(DEFAULT_PROFILE, {});
  assert.equal(r.ready, false);
  const ok = mappingChecklist(DEFAULT_PROFILE, {
    device: true,
    audioL: true,
    audioR: true,
    speechL: true,
    speechR: true,
  });
  assert.equal(ok.ready, true);
  assert.equal(ok.passed, ok.total);
});

test("readButton understands both object and boolean forms", () => {
  assert.equal(readButton(fakePad({ buttons: [true] }), 0), true);
  assert.equal(readButton({ buttons: [false] }, 0), false);
  assert.equal(readButton({ buttons: [1] }, 0), true);
});

test("snapshotPad is JSON-serializable", () => {
  const s = snapshotPad(fakePad({ axes: [0.2], buttons: [true] }));
  assert.equal(JSON.parse(JSON.stringify(s)).axes[0], 0.2);
});
