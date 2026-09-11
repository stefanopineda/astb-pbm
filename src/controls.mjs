/**
 * X-52 / generic HOTAS mapping. Pure functions plus a small stateful mapper
 * that can run in the browser against navigator.getGamepads() or in tests
 * against a fake pad.
 */

export const DEFAULT_PROFILE = {
  id: "x52",
  name: "Saitek / Logitech X-52",
  stickPad: 0,
  throttlePad: 0,
  stickX: { axis: 0, min: -1, max: 1, invert: false, deadzone: 0.06 },
  stickY: { axis: 1, min: -1, max: 1, invert: true, deadzone: 0.06 },
  // Chrome on Mac indexes Gamepad axes by HID usage (usage - 0x30):
  //   0=X stick, 1=Y stick, 2=Z throttle LEVER, 3=Rx thumb rotary.
  // VTT is always the lever. Invert so push-forward raises the pip.
  throttle: { axis: 2, min: -1, max: 1, invert: true, deadzone: 0.02 },
  stickTrigger: { pad: 0, button: 0 },
  throttleThumb: { pad: 0, button: 6 },
  emergencies: {
    T1: { pad: 0, button: 8 },
    T2: { pad: 0, button: 9 },
    T3: { pad: 0, button: 10 },
    T4: { pad: 0, button: 11 },
    T5: { pad: 0, button: 12 },
    T6: { pad: 0, button: 13 },
  },
  swapEars: false,
};

export const KEYBOARD_PROFILE = {
  ...DEFAULT_PROFILE,
  id: "keyboard",
  name: "Keyboard fallback",
};

const STORAGE_KEY = "astb-pbm-mapping-v1";

export function cloneProfile(p) {
  return JSON.parse(JSON.stringify(p));
}

/** X-52 push/pull throttle lever (HID Z). Not the Rx thumb rotary (axis 3). */
export const THROTTLE_LEVER_AXIS = 2;

export function pinThrottleLever(throttle = {}) {
  return {
    ...DEFAULT_PROFILE.throttle,
    ...throttle,
    axis: THROTTLE_LEVER_AXIS,
    invert: true,
    min: -1,
    max: 1,
  };
}

export function migrateThrottleAxis(profile) {
  const p = cloneProfile(profile);
  if (p.throttle) p.throttle = pinThrottleLever(p.throttle);
  return p;
}

export function loadProfile() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return cloneProfile(DEFAULT_PROFILE);
    const parsed = JSON.parse(raw);
    const merged = {
      ...cloneProfile(DEFAULT_PROFILE),
      ...parsed,
      stickX: { ...DEFAULT_PROFILE.stickX, ...(parsed.stickX || {}) },
      stickY: { ...DEFAULT_PROFILE.stickY, ...(parsed.stickY || {}) },
      throttle: { ...DEFAULT_PROFILE.throttle, ...(parsed.throttle || {}) },
      stickTrigger: { ...DEFAULT_PROFILE.stickTrigger, ...(parsed.stickTrigger || {}) },
      throttleThumb: { ...DEFAULT_PROFILE.throttleThumb, ...(parsed.throttleThumb || {}) },
      emergencies: { ...DEFAULT_PROFILE.emergencies, ...(parsed.emergencies || {}) },
    };
    const migrated = migrateThrottleAxis(merged);
    if (
      migrated.throttle.axis !== merged.throttle.axis ||
      migrated.throttle.invert !== merged.throttle.invert ||
      migrated.throttle.min !== merged.throttle.min ||
      migrated.throttle.max !== merged.throttle.max
    ) {
      saveProfile(migrated);
    }
    return migrated;
  } catch {
    return cloneProfile(DEFAULT_PROFILE);
  }
}

export function saveProfile(profile) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readAxis(pad, index) {
  if (!pad || !pad.axes || index == null || index < 0) return 0;
  const v = pad.axes[index];
  return Number.isFinite(v) ? v : 0;
}

export function readButton(pad, index) {
  if (!pad || !pad.buttons || index == null || index < 0) return false;
  const b = pad.buttons[index];
  if (typeof b === "object") return !!(b.pressed || (b.value ?? 0) > 0.5);
  return !!b;
}

export function listPads(gamepads) {
  const out = [];
  if (!gamepads) return out;
  for (let i = 0; i < gamepads.length; i++) {
    const g = gamepads[i];
    if (!g) continue;
    out.push({
      index: i,
      id: g.id || `pad-${i}`,
      axes: g.axes?.length ?? 0,
      buttons: g.buttons?.length ?? 0,
    });
  }
  return out;
}

export function looksLikeX52(id) {
  const s = (id || "").toLowerCase();
  return s.includes("x52") || s.includes("saitek") || s.includes("logitech") && s.includes("flight");
}

export function axisSpan(samples) {
  if (!samples.length) return { min: 0, max: 0, range: 0, mean: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, range: max - min, mean: sum / samples.length };
}

/**
 * Given a rest snapshot and a live snapshot, find the axis that moved the most
 * in the requested direction. `wantSign` is +1 if we asked the user to push
 * the control toward its positive physical direction.
 */
export function detectMovedAxis(restPad, livePad, { wantPositive = true, minDelta = 0.18 } = {}) {
  if (!restPad || !livePad) return null;
  const n = Math.min(restPad.axes.length, livePad.axes.length);
  let best = null;
  for (let i = 0; i < n; i++) {
    const delta = livePad.axes[i] - restPad.axes[i];
    const mag = Math.abs(delta);
    if (mag < minDelta) continue;
    if (!best || mag > best.mag) {
      best = { axis: i, delta, mag, invert: wantPositive ? delta < 0 : delta > 0 };
    }
  }
  return best;
}

export function detectPressedButton(restPad, livePad) {
  if (!livePad?.buttons) return null;
  for (let i = 0; i < livePad.buttons.length; i++) {
    const now = readButton(livePad, i);
    const was = restPad ? readButton(restPad, i) : false;
    if (now && !was) return i;
  }
  return null;
}

export function snapshotPad(pad) {
  if (!pad) return null;
  return {
    index: pad.index,
    id: pad.id,
    axes: Array.from(pad.axes || []),
    buttons: Array.from(pad.buttons || []).map((b) => ({
      pressed: !!(b.pressed || (b.value ?? 0) > 0.5),
      value: typeof b === "object" ? b.value ?? 0 : b ? 1 : 0,
    })),
  };
}

export function throttle01(raw, spec) {
  const span = spec.max - spec.min || 1;
  let t = (raw - spec.min) / span;
  if (spec.invert) t = 1 - t;
  if (t < spec.deadzone) t = 0;
  if (t > 1 - spec.deadzone) t = 1;
  return Math.max(0, Math.min(1, t));
}

export function stickNorm(raw, spec) {
  const span = spec.max - spec.min || 1;
  let t = (raw - spec.min) / span; // 0..1
  if (spec.invert) t = 1 - t;
  let n = t * 2 - 1;
  const dz = spec.deadzone ?? 0.06;
  if (Math.abs(n) < dz) return 0;
  const sign = Math.sign(n);
  return sign * (Math.abs(n) - dz) / (1 - dz);
}

export class ControlBus {
  constructor(profile = loadProfile()) {
    this.profile = profile;
    this.keys = new Set();
    this.prevStickTrigger = false;
    this.prevThrottleThumb = false;
    this.prevEmerg = {};
    this.keyboardStick = { x: 0, y: 0 };
    this.keyboardThrottle = 0.5;
    this.lastPads = [];
  }

  attachKeyboard(target = globalThis) {
    this._down = (e) => {
      this.keys.add(e.code);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    };
    this._up = (e) => this.keys.delete(e.code);
    target.addEventListener?.("keydown", this._down);
    target.addEventListener?.("keyup", this._up);
  }

  detachKeyboard(target = globalThis) {
    if (this._down) target.removeEventListener?.("keydown", this._down);
    if (this._up) target.removeEventListener?.("keyup", this._up);
  }

  poll(gamepads) {
    this.lastPads = gamepads || [];
    const p = this.profile;
    const stickPad = this.lastPads[p.stickPad] || this.lastPads[0] || null;
    const thrPad = this.lastPads[p.throttlePad] || stickPad;

    let nx = 0;
    let ny = 0;
    let thr = this.keyboardThrottle;
    let stickTrigger = false;
    let throttleThumb = false;

    if (stickPad) {
      nx = stickNorm(readAxis(stickPad, p.stickX.axis), p.stickX);
      ny = stickNorm(readAxis(stickPad, p.stickY.axis), p.stickY);
      stickTrigger = readButton(this.lastPads[p.stickTrigger.pad] || stickPad, p.stickTrigger.button);
    }
    if (thrPad) {
      thr = throttle01(readAxis(thrPad, p.throttle.axis), p.throttle);
      throttleThumb = readButton(this.lastPads[p.throttleThumb.pad] || thrPad, p.throttleThumb.button);
    }

    // Keyboard overlay — always available so the bench and drills can be
    // verified without hardware.
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) nx -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) nx += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) ny -= 1;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) ny += 1;
    if (this.keys.has("KeyQ") || this.keys.has("PageUp")) this.keyboardThrottle = Math.min(1, this.keyboardThrottle + 0.02);
    if (this.keys.has("KeyE") || this.keys.has("PageDown")) this.keyboardThrottle = Math.max(0, this.keyboardThrottle - 0.02);
    if (this.keys.has("KeyR")) this.keyboardThrottle = Math.min(1, this.keyboardThrottle + 0.02);
    if (this.keys.has("KeyF")) this.keyboardThrottle = Math.max(0, this.keyboardThrottle - 0.02);
    nx = Math.max(-1, Math.min(1, nx));
    ny = Math.max(-1, Math.min(1, ny));
    if (!stickPad) {
      thr = this.keyboardThrottle;
    } else if (this.keys.has("KeyQ") || this.keys.has("KeyE") || this.keys.has("KeyR") || this.keys.has("KeyF")) {
      thr = this.keyboardThrottle;
    }

    const keyStickTrig = this.keys.has("Space") || this.keys.has("ShiftRight");
    const keyThrThumb = this.keys.has("ShiftLeft") || this.keys.has("ControlLeft");
    stickTrigger = stickTrigger || keyStickTrig;
    throttleThumb = throttleThumb || keyThrThumb;

    const stickEdge = stickTrigger && !this.prevStickTrigger;
    const thumbEdge = throttleThumb && !this.prevThrottleThumb;
    this.prevStickTrigger = stickTrigger;
    this.prevThrottleThumb = throttleThumb;

    const emergDown = [];
    for (const [name, spec] of Object.entries(p.emergencies || {})) {
      const pad = this.lastPads[spec.pad] || stickPad;
      const down = readButton(pad, spec.button) || this.keys.has(`Digit${name.slice(1)}`) || this.keys.has(`Numpad${name.slice(1)}`);
      if (down && !this.prevEmerg[name]) emergDown.push(name);
      this.prevEmerg[name] = down;
    }

    let dlt = null;
    if (stickEdge) dlt = "STICK";
    else if (thumbEdge) dlt = "THROTTLE";

    return {
      nx,
      ny,
      throttle: thr,
      stickTrigger,
      throttleThumb,
      dlt,
      emergencies: emergDown,
      connected: !!stickPad,
      padCount: listPads(this.lastPads).length,
    };
  }
}

export function mappingChecklist(profile, probes) {
  const items = [
    { id: "device", label: "HOTAS visible to the browser", ok: !!probes.device },
    { id: "stickX", label: "Stick X (aileron) mapped", ok: Number.isInteger(profile.stickX.axis) },
    { id: "stickY", label: "Stick Y (elevator) mapped", ok: Number.isInteger(profile.stickY.axis) },
    { id: "throttle", label: "Throttle axis mapped", ok: Number.isInteger(profile.throttle.axis) },
    { id: "trigger", label: "Stick trigger mapped (even numbers)", ok: Number.isInteger(profile.stickTrigger.button) },
    { id: "thumb", label: "Throttle thumb mapped (odd numbers)", ok: Number.isInteger(profile.throttleThumb.button) },
    { id: "audioL", label: "Left-ear tone heard in LEFT cup", ok: !!probes.audioL },
    { id: "audioR", label: "Right-ear tone heard in RIGHT cup", ok: !!probes.audioR },
    { id: "speechL", label: "Spoken token isolated to LEFT", ok: !!probes.speechL },
    { id: "speechR", label: "Spoken token isolated to RIGHT", ok: !!probes.speechR },
  ];
  const passed = items.filter((i) => i.ok).length;
  return { items, passed, total: items.length, ready: items.every((i) => i.ok) };
}
