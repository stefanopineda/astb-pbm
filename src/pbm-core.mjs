/**
 * Pure ASTB-E PBM logic. No DOM. Safe to import from Node tests and the browser.
 *
 * Task model is taken from the public research literature on the Navy PBM
 * (Phillips 2011, Walker 2007, Draheim et al. 2025), not from the proprietary
 * scoring key. Practice scores are therefore training metrics, not predicted
 * PFAR/FOFAR values.
 */

export const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
export const LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "J", "K",
  "L", "M", "N", "P", "R", "S", "T", "W", "X", "Y", "Z",
];

export const EMERGENCIES = [
  { id: "engine-fire", label: "ENGINE FIRE", utterance: "engine fire", button: "T1" },
  { id: "hyd-fail", label: "HYDRAULIC FAILURE", utterance: "hydraulic failure", button: "T2" },
  { id: "elec-fail", label: "ELECTRICAL FAILURE", utterance: "electrical failure", button: "T3" },
  { id: "cabin-press", label: "CABIN PRESSURE", utterance: "cabin pressure", button: "T4" },
  { id: "engine-fail", label: "ENGINE FAILURE", utterance: "engine failure", button: "T5" },
  { id: "fuel-leak", label: "FUEL LEAK", utterance: "fuel leak", button: "T6" },
];

export const SPEED_SCHEDULES = {
  vtt: { duration: 60, steps: [0, 20, 40], speeds: [95, 145, 195] },
  att: { duration: 60, steps: [0, 20, 40], speeds: [110, 170, 235] },
  avtt: { duration: 120, steps: [0, 40, 80], speeds: [105, 165, 225] },
  multi: { duration: 180, steps: [0, 60, 120], speeds: [100, 155, 205] },
  emergency: { duration: 120, steps: [0, 40, 80], speeds: [105, 155, 200] },
  dlt: { duration: 120, steps: [0], speeds: [0] },
};

export const DLT_ISI_MS = 850;
export const DLT_WINDOW_MS = 800;
export const ON_TARGET_HOLD_S = 0.9;
export const RETICLE_LAG_S = 0.05;
export const DEFAULT_HIT_RADIUS = 22;

export function isDigit(token) {
  return typeof token === "string" && /^\d$/.test(token);
}

export function isEvenDigit(token) {
  if (!isDigit(token)) return null;
  return Number(token) % 2 === 0;
}

/**
 * Official DLT mapping (public descriptions):
 *   even number in the attended ear → stick trigger (right hand)
 *   odd number in the attended ear  → throttle thumb (left hand)
 *   letters, and everything in the ignored ear, are distractors
 */
export function expectedDltResponse(targetEar, leftToken, rightToken) {
  const token = targetEar === "L" ? leftToken : rightToken;
  const even = isEvenDigit(token);
  if (even === null) return null;
  return even ? "STICK" : "THROTTLE";
}

export function gradeDltResponse(expected, actual, rtMs, windowMs = DLT_WINDOW_MS) {
  if (expected === null) {
    return actual ? "FALSE_ALARM" : "CORRECT_REJECTION";
  }
  if (!actual) return "MISS";
  if (rtMs > windowMs) return actual === expected ? "LATE" : "WRONG_BUTTON";
  if (actual !== expected) return "WRONG_BUTTON";
  return "HIT";
}

export function randomToken(rng, { digitChance = 0.42 } = {}) {
  const r = rng();
  if (r < digitChance) return DIGITS[Math.floor(rng() * DIGITS.length)];
  return LETTERS[Math.floor(rng() * LETTERS.length)];
}

export function makePair(rng, opts) {
  let left = randomToken(rng, opts);
  let right = randomToken(rng, opts);
  // Guarantee the two ears are never identical — matches the "distinct strings" description.
  let guard = 0;
  while (right === left && guard++ < 8) {
    right = randomToken(rng, opts);
  }
  return { left, right };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function speedAt(elapsedS, schedule) {
  const { steps, speeds } = schedule;
  let idx = 0;
  for (let i = 0; i < steps.length; i++) {
    if (elapsedS >= steps[i]) idx = i;
  }
  return speeds[Math.min(idx, speeds.length - 1)];
}

const CARDINALS = [0, 45, 90, 135, 180, 225, 270, 315].map((d) => (d * Math.PI) / 180);

export function headingVector(rad) {
  return { vx: Math.sin(rad), vy: -Math.cos(rad) };
}

export function pickHeading(rng, axis) {
  if (axis === "y") return rng() < 0.5 ? 0 : Math.PI;
  return CARDINALS[Math.floor(rng() * CARDINALS.length)];
}

export function createTarget({ axis, x, y, speed, rng }) {
  const heading = pickHeading(rng, axis);
  const v = headingVector(heading);
  return {
    axis,
    x,
    y,
    heading,
    vx: axis === "y" ? 0 : v.vx,
    vy: v.vy,
    speed,
    onTargetFor: 0,
  };
}

export function stepTarget(target, dt, { width, height, pad, speed, rng, onTarget }) {
  const next = { ...target, speed };
  if (onTarget) next.onTargetFor += dt;
  else next.onTargetFor = 0;

  const bounce = next.onTargetFor >= ON_TARGET_HOLD_S;
  if (bounce) {
    next.onTargetFor = 0;
    next.heading = pickHeading(rng, next.axis);
    const v = headingVector(next.heading);
    next.vx = next.axis === "y" ? 0 : v.vx;
    next.vy = v.vy;
  }

  next.x += next.vx * next.speed * dt;
  next.y += next.vy * next.speed * dt;

  const minX = pad;
  const maxX = width - pad;
  const minY = pad;
  const maxY = height - pad;

  if (next.axis !== "y") {
    if (next.x < minX) {
      next.x = minX;
      next.vx = Math.abs(next.vx);
      next.heading = Math.atan2(next.vx, -next.vy);
    } else if (next.x > maxX) {
      next.x = maxX;
      next.vx = -Math.abs(next.vx);
      next.heading = Math.atan2(next.vx, -next.vy);
    }
  }
  if (next.y < minY) {
    next.y = minY;
    next.vy = Math.abs(next.vy);
    if (next.axis === "y") next.heading = Math.PI;
    else next.heading = Math.atan2(next.vx, -next.vy);
  } else if (next.y > maxY) {
    next.y = maxY;
    next.vy = -Math.abs(next.vy);
    if (next.axis === "y") next.heading = 0;
    else next.heading = Math.atan2(next.vx, -next.vy);
  }
  return next;
}

export function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

export function isOnTarget(reticle, target, radius = DEFAULT_HIT_RADIUS) {
  if (target.axis === "y") return Math.abs(reticle.y - target.y) <= radius;
  return dist(reticle.x, reticle.y, target.x, target.y) <= radius;
}

export function lagToward(current, desired, dt, tau = RETICLE_LAG_S) {
  const a = 1 - Math.exp(-dt / Math.max(0.001, tau));
  return current + (desired - current) * a;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function normalizeAxis(value, { min, max, invert, deadzone = 0.04 } = {}) {
  if (!Number.isFinite(value)) return 0;
  const span = max - min || 1;
  let t = (value - min) / span; // 0..1
  t = clamp(t, 0, 1);
  if (invert) t = 1 - t;
  let centered = t * 2 - 1; // -1..1
  if (Math.abs(centered) < deadzone) {
    const s = deadzone === 0 ? 1 : (Math.abs(centered) / deadzone);
    centered = 0 * s;
  } else {
    const sign = Math.sign(centered);
    centered = sign * (Math.abs(centered) - deadzone) / (1 - deadzone);
  }
  return clamp(centered, -1, 1);
}

/** Map a 0..1 throttle (after invert) onto a vertical pixel coordinate. */
export function throttleToY(throttle01, height, pad) {
  return lerp(height - pad, pad, clamp(throttle01, 0, 1));
}

export function stickToPoint(nx, ny, width, height, pad) {
  return {
    x: lerp(pad, width - pad, (nx + 1) / 2),
    y: lerp(pad, height - pad, (ny + 1) / 2),
  };
}

export function createTrackingStats() {
  return {
    samples: 0,
    onTarget: 0,
    errorSum: 0,
    errorSq: 0,
    maxError: 0,
  };
}

export function pushTrackingSample(stats, error, onTarget) {
  stats.samples += 1;
  if (onTarget) stats.onTarget += 1;
  stats.errorSum += error;
  stats.errorSq += error * error;
  if (error > stats.maxError) stats.maxError = error;
}

export function summarizeTracking(stats) {
  const n = stats.samples || 1;
  const mean = stats.errorSum / n;
  const rms = Math.sqrt(stats.errorSq / n);
  const pct = (100 * stats.onTarget) / n;
  return {
    samples: stats.samples,
    pctOnTarget: pct,
    meanError: mean,
    rmsError: rms,
    maxError: stats.maxError,
    score: trackingScore(pct, rms),
  };
}

/** Practice score 0–100. Heavily weighted toward time-on-target, as the literature reports. */
export function trackingScore(pctOnTarget, rmsError) {
  const rmsTerm = clamp(1 - rmsError / 120, 0, 1);
  return clamp(0.8 * pctOnTarget + 20 * rmsTerm, 0, 100);
}

export function createDltStats() {
  return {
    trials: 0,
    hits: 0,
    misses: 0,
    falseAlarms: 0,
    wrongButton: 0,
    late: 0,
    correctRejections: 0,
    rtSum: 0,
    rtHits: 0,
  };
}

export function pushDltGrade(stats, grade, rtMs) {
  stats.trials += 1;
  if (grade === "HIT") {
    stats.hits += 1;
    if (Number.isFinite(rtMs)) {
      stats.rtSum += rtMs;
      stats.rtHits += 1;
    }
  } else if (grade === "MISS") stats.misses += 1;
  else if (grade === "FALSE_ALARM") stats.falseAlarms += 1;
  else if (grade === "WRONG_BUTTON") stats.wrongButton += 1;
  else if (grade === "LATE") stats.late += 1;
  else if (grade === "CORRECT_REJECTION") stats.correctRejections += 1;
}

export function summarizeDlt(stats) {
  const actionable = stats.hits + stats.misses + stats.wrongButton + stats.late;
  const accuracy = actionable === 0 ? 0 : (100 * stats.hits) / actionable;
  const meanRt = stats.rtHits ? stats.rtSum / stats.rtHits : 0;
  const faPenalty = stats.falseAlarms * 4;
  const score = clamp(accuracy - faPenalty * (100 / Math.max(20, stats.trials)), 0, 100);
  return {
    ...stats,
    accuracy,
    meanRt,
    score,
  };
}

export function summarizeEmergency(stats) {
  const n = stats.trials || 1;
  const accuracy = (100 * stats.hits) / n;
  const meanRt = stats.rtHits ? stats.rtSum / stats.rtHits : 0;
  return { ...stats, accuracy, meanRt, score: accuracy };
}

export function compositeScore({ att, vtt, dlt, emergency }) {
  const parts = [];
  if (att) parts.push([att.score, 0.35]);
  if (vtt) parts.push([vtt.score, 0.25]);
  if (dlt) parts.push([dlt.score, 0.3]);
  if (emergency) parts.push([emergency.score, 0.1]);
  const w = parts.reduce((s, p) => s + p[1], 0) || 1;
  const raw = parts.reduce((s, p) => s + p[0] * p[1], 0) / w;
  return clamp(raw, 0, 100);
}

export const MODES = {
  bench: { id: "bench", title: "Hardware bench", duration: 0 },
  vtt: { id: "vtt", title: "Vertical tracking (throttle)", duration: 60, schedule: "vtt" },
  att: { id: "att", title: "Airplane tracking (stick)", duration: 60, schedule: "att" },
  avtt: { id: "avtt", title: "Dual tracking", duration: 120, schedule: "avtt" },
  dlt: { id: "dlt", title: "Dichotic listening", duration: 120, schedule: "dlt" },
  multi: { id: "multi", title: "Multitrack (stick + throttle + ears)", duration: 180, schedule: "multi" },
  emergency: { id: "emergency", title: "Emergency stack", duration: 120, schedule: "emergency" },
};

export const BATTERY = [
  { mode: "dlt", ear: "L", duration: 120, label: "DLT · attend LEFT" },
  { mode: "dlt", ear: "R", duration: 120, label: "DLT · attend RIGHT" },
  { mode: "vtt", duration: 60, label: "VTT · throttle only" },
  { mode: "att", duration: 60, label: "ATT · stick only" },
  { mode: "avtt", duration: 120, label: "AVTT · stick + throttle" },
  { mode: "multi", ear: "L", duration: 180, label: "Multitrack · attend LEFT" },
  { mode: "emergency", ear: "R", duration: 120, label: "Emergency stack · attend RIGHT" },
];

export function formatSeconds(s) {
  const t = Math.max(0, Math.ceil(s));
  const m = Math.floor(t / 60);
  const r = t % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function formatScore(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}
