import {
  BATTERY,
  DLT_ISI_MS,
  DLT_WINDOW_MS,
  EMERGENCIES,
  MODES,
  SPEED_SCHEDULES,
  compositeScore,
  createDltStats,
  createTarget,
  createTrackingStats,
  dist,
  expectedDltResponse,
  formatScore,
  formatSeconds,
  gradeDltResponse,
  isOnTarget,
  lagToward,
  makePair,
  mulberry32,
  pushDltGrade,
  pushTrackingSample,
  speedAt,
  stepTarget,
  stickToPoint,
  summarizeDlt,
  summarizeEmergency,
  summarizeTracking,
  throttleToY,
} from "./pbm-core.mjs";
import {
  ControlBus,
  detectMovedAxis,
  detectPressedButton,
  listPads,
  loadProfile,
  looksLikeX52,
  mappingChecklist,
  pinThrottleLever,
  saveProfile,
  snapshotPad,
  THROTTLE_LEVER_AXIS,
} from "./controls.mjs";
import { DichoticEngine, listOutputDevices, pickOutputDevice } from "./audio.js";
import { drawFrame, layoutFor, resizeCanvas } from "./render.js";

const $ = (id) => document.getElementById(id);

const audio = new DichoticEngine();
const bus = new ControlBus(loadProfile());
bus.attachKeyboard(window);

const S = {
  view: "home",
  mode: "att",
  running: false,
  paused: false,
  examAids: true,
  elapsed: 0,
  duration: 60,
  lastTs: 0,
  rng: mulberry32(1),
  vttTarget: null,
  attTarget: null,
  vttReticle: null,
  attReticle: null,
  vttOn: false,
  attOn: false,
  vttStats: createTrackingStats(),
  attStats: createTrackingStats(),
  dltStats: createDltStats(),
  emStats: createDltStats(),
  dltLive: { ear: "L", left: "·", right: "·" },
  dltWindow: null,
  nextDltAt: 1.8,
  nextEmAt: 8,
  emLive: null,
  ear: "L",
  battery: null,
  batteryIndex: 0,
  lastMode: "att",
  probes: JSON.parse(localStorage.getItem("astb-pbm-probes") || "{}"),
  benchStep: 0,
  restSnap: null,
  earFlash: { L: 0, R: 0 },
};

const STEPS = [
  { id: "audio", title: "Enable audio and pick the headset", body: "Click Enable audio, then Choose headphones. Confirm the Mac is routing to the segregated headset, not the laptop speakers." },
  { id: "toneL", title: "Left-ear tone", body: "You should hear a lower tone in the LEFT cup only. If it is in the right cup, hit Swap ears." },
  { id: "toneR", title: "Right-ear tone", body: "Higher tone in the RIGHT cup only." },
  { id: "speechL", title: "Spoken LEFT token", body: "You should hear “eight” in the left cup, silence on the right." },
  { id: "speechR", title: "Spoken RIGHT token", body: "You should hear “seven” in the right cup, silence on the left." },
  { id: "device", title: "Detect the X-52", body: "Click anywhere on this page first. Chrome only exposes gamepads after a user click (browser security); without it the HOTAS pill says “not seen” even when the stick is plugged in and registered at the OS. Then plug in the HOTAS, allow the accessory if macOS prompts, and Rescan." },
  { id: "stickX", title: "Push the stick RIGHT and hold", body: "Keep it deflected, then Confirm. This maps aileron." },
  { id: "stickY", title: "Push the stick FORWARD (away from you) and hold", body: "Forward will move the ATT cursor down (aircraft elevator)." },
  { id: "throttle", title: "Push the throttle LEVER to MAX (forward) and hold", body: "VTT follows the push/pull handle, not the thumb wheel. Forward raises the pip." },
  { id: "trigger", title: "Pull the stick trigger", body: "This is the EVEN-number response." },
  { id: "thumb", title: "Press the throttle thumb button (D / i)", body: "This is the ODD-number response." },
];

function show(view) {
  S.view = view;
  for (const el of document.querySelectorAll(".view")) el.classList.remove("active");
  const node = document.getElementById(`view-${view === "home" ? "home" : view}`);
  if (view === "home") $("view-home").classList.add("active");
  else if (view === "bench") $("view-bench").classList.add("active");
  else if (view === "play") $("view-play").classList.add("active");
  else if (view === "debrief") $("view-debrief").classList.add("active");
  node?.classList.add("active");
}

function saveProbes() {
  localStorage.setItem("astb-pbm-probes", JSON.stringify(S.probes));
}

function updatePills() {
  const pads = listPads(navigator.getGamepads?.() || []);
  const x52 = pads.find((p) => looksLikeX52(p.id));
  const padEl = $("padPill");
  if (x52 || pads.length) {
    padEl.textContent = x52 ? `HOTAS ${x52.id.split("(")[0].trim()}` : `Pad ×${pads.length}`;
    padEl.className = "pill ok";
  } else {
    padEl.textContent = "HOTAS not seen";
    padEl.className = "pill warn";
  }
  const hp = $("hpPill");
  hp.textContent = audio.sinkId ? "Headset selected" : (audio.ctx ? "Audio on (default)" : "Headset —");
  hp.className = audio.ctx ? "pill ok" : "pill warn";
  const check = mappingChecklist(bus.profile, { device: pads.length > 0, ...S.probes });
  const mp = $("mapPill");
  mp.textContent = `Map ${check.passed}/${check.total}`;
  mp.className = check.ready ? "pill ok" : "pill warn";
}

function renderChecklist() {
  const pads = listPads(navigator.getGamepads?.() || []);
  const check = mappingChecklist(bus.profile, { device: pads.length > 0, ...S.probes });
  $("checklist").innerHTML = check.items
    .map((i) => `<li>${i.label}<span class="${i.ok ? "pass" : "fail"}">${i.ok ? "PASS" : "FAIL"}</span></li>`)
    .join("");
}

function renderSteps() {
  $("steps").innerHTML = STEPS.map((s, i) => {
    const current = i === S.benchStep;
    const done = i < S.benchStep;
    const actions = {
      audio: `<button class="btn" data-step-act="unlock">Enable audio</button>
              <button class="btn" data-step-act="pick">Choose headphones</button>`,
      toneL: `<button class="btn primary" data-step-act="toneL">Play LEFT tone</button>
              <button class="btn" data-step-act="pass:audioL">Heard left</button>
              <button class="btn" data-step-act="swap">Swap ears</button>`,
      toneR: `<button class="btn primary" data-step-act="toneR">Play RIGHT tone</button>
              <button class="btn" data-step-act="pass:audioR">Heard right</button>`,
      speechL: `<button class="btn primary" data-step-act="speechL">Speak LEFT</button>
                <button class="btn" data-step-act="pass:speechL">Isolated left</button>`,
      speechR: `<button class="btn primary" data-step-act="speechR">Speak RIGHT</button>
                <button class="btn" data-step-act="pass:speechR">Isolated right</button>`,
      device: `<button class="btn primary" data-step-act="scan">Rescan HOTAS</button>
               <button class="btn" data-step-act="pass:device">I see it</button>`,
      stickX: `<button class="btn" data-step-act="rest">Capture rest</button>
               <button class="btn primary" data-step-act="map:stickX">Confirm RIGHT</button>`,
      stickY: `<button class="btn" data-step-act="rest">Capture rest</button>
               <button class="btn primary" data-step-act="map:stickY">Confirm FORWARD</button>`,
      throttle: `<button class="btn" data-step-act="rest">Capture rest</button>
                 <button class="btn primary" data-step-act="map:throttle">Confirm MAX</button>`,
      trigger: `<button class="btn primary" data-step-act="map:trigger">Capture trigger</button>`,
      thumb: `<button class="btn primary" data-step-act="map:thumb">Capture thumb</button>`,
    }[s.id];
    return `<article class="step ${current ? "current" : ""} ${done ? "done" : ""}">
      <div class="n">STEP ${String(i + 1).padStart(2, "0")}</div>
      <h2 style="margin:6px 0 8px;font-size:16px">${s.title}</h2>
      <p class="tiny">${s.body}</p>
      <div class="row" style="margin-top:10px">${actions || ""}
        ${current ? `<button class="btn ghost" data-step-act="next">Skip</button>` : ""}
      </div>
    </article>`;
  }).join("");
}

function flashEar(side, text) {
  S.earFlash[side] = performance.now() + 700;
  const el = side === "L" ? $("earLtok") : $("earRtok");
  const box = side === "L" ? $("earL") : $("earR");
  if (el) el.textContent = text;
  box?.classList.add(side === "L" ? "active-L" : "active-R");
  setTimeout(() => box?.classList.remove("active-L", "active-R"), 700);
}

async function ensureAudio() {
  await audio.unlock();
  const loaded = await audio.loadAll();
  if (loaded.missing.length) {
    console.warn("Missing audio assets", loaded.missing);
  }
  refreshOutputs();
  updatePills();
  return loaded;
}

async function refreshOutputs() {
  const sel = $("outputSelect");
  if (!sel) return;
  try {
    const devices = await listOutputDevices();
    const current = sel.value;
    sel.innerHTML = `<option value="">Default output</option>` +
      devices.map((d) => `<option value="${d.deviceId}">${d.label || "Output"}</option>`).join("");
    if (current) sel.value = current;
  } catch {
    /* permission not yet granted */
  }
}

function snapshotAllPads() {
  const pads = navigator.getGamepads?.() || [];
  const out = [];
  for (let i = 0; i < pads.length; i++) {
    const s = snapshotPad(pads[i]);
    if (s) out.push(s);
  }
  return out;
}

function detectAcrossPads(restList, liveList, opts) {
  for (const live of liveList) {
    const rest = (restList || []).find((r) => r.index === live.index) || {
      axes: live.axes.map(() => 0),
      buttons: live.buttons.map(() => ({ pressed: false })),
    };
    const hit = detectMovedAxis(rest, live, opts);
    if (hit) return { ...hit, pad: live.index, rest, live };
  }
  return null;
}

function applyStepAction(act) {
  const profile = bus.profile;
  if (act === "unlock") return ensureAudio();
  if (act === "pick") {
    return pickOutputDevice().then(async (dev) => {
      if (dev?.deviceId) {
        await audio.setSink(dev.deviceId);
        S.probes.audioOut = true;
        saveProbes();
      }
      refreshOutputs();
      updatePills();
    }).catch(() => {});
  }
  if (act === "swap") {
    audio.swapEars = !audio.swapEars;
    profile.swapEars = audio.swapEars;
    saveProfile(profile);
    return;
  }
  if (act === "toneL") {
    ensureAudio().then(() => {
      audio.playTone("L");
      flashEar("L", "440 Hz");
    });
    return;
  }
  if (act === "toneR") {
    ensureAudio().then(() => {
      audio.playTone("R");
      flashEar("R", "554 Hz");
    });
    return;
  }
  if (act === "speechL") {
    ensureAudio().then(() => {
      audio.playMono("8", "L");
      flashEar("L", "EIGHT");
    });
    return;
  }
  if (act === "speechR") {
    ensureAudio().then(() => {
      audio.playMono("7", "R");
      flashEar("R", "SEVEN");
    });
    return;
  }
  if (act.startsWith("pass:")) {
    const key = act.slice(5);
    S.probes[key] = true;
    if (key === "device") S.probes.device = true;
    saveProbes();
    S.benchStep = Math.min(S.benchStep + 1, STEPS.length - 1);
    renderSteps();
    renderChecklist();
    updatePills();
    return;
  }
  if (act === "next") {
    S.benchStep = Math.min(S.benchStep + 1, STEPS.length - 1);
    renderSteps();
    return;
  }
  if (act === "scan") {
    updatePills();
    const pads = listPads(navigator.getGamepads?.() || []);
    $("deviceList").textContent = pads.length
      ? pads.map((p) => `#${p.index} ${p.id} · ${p.axes} axes · ${p.buttons} buttons`).join("\n")
      : "Still no gamepad. Click the page, wiggle the stick, check System Settings → USB.";
    if (pads.length) {
      S.probes.device = true;
      saveProbes();
    }
    renderChecklist();
    return;
  }
  if (act === "rest") {
    S.restSnap = snapshotAllPads();
    $("deviceList").textContent = `Rest captured on ${S.restSnap.length} device(s). Now deflect / press, then Confirm.`;
    return;
  }
  if (act === "map:stickX" || act === "map:stickY" || act === "map:throttle") {
    const liveList = snapshotAllPads();
    const restList = Array.isArray(S.restSnap) ? S.restSnap : snapshotAllPads();
    const hit = detectAcrossPads(restList, liveList, { wantPositive: true, minDelta: 0.12 });
    if (!hit) {
      $("deviceList").textContent = "No axis moved enough. Hold the deflection, then Confirm again. If this is the throttle, make sure both X-52 USB devices are listed above.";
      return;
    }
    if (act === "map:stickX") {
      profile.stickX.axis = hit.axis;
      profile.stickX.invert = hit.invert;
      profile.stickPad = hit.pad;
    } else if (act === "map:stickY") {
      profile.stickY.axis = hit.axis;
      profile.stickY.invert = hit.invert;
      profile.stickPad = hit.pad;
    } else {
      // Never bind VTT to the thumb rotary. Axis 2 is the push/pull lever;
      // invert is fixed so forward raises the pip.
      let leverPad = hit.pad;
      let leverDelta = 0;
      for (const live of liveList) {
        const rest = restList.find((r) => r.index === live.index);
        if (!rest || live.axes.length <= THROTTLE_LEVER_AXIS) continue;
        const delta = Math.abs((live.axes[THROTTLE_LEVER_AXIS] ?? 0) - (rest.axes[THROTTLE_LEVER_AXIS] ?? 0));
        if (delta > leverDelta) {
          leverDelta = delta;
          leverPad = live.index;
        }
      }
      profile.throttle = pinThrottleLever(profile.throttle);
      profile.throttlePad = leverPad;
    }
    saveProfile(profile);
    S.benchStep = Math.min(S.benchStep + 1, STEPS.length - 1);
    renderSteps();
    const mapped = act === "map:throttle"
      ? `Mapped throttle lever → pad ${profile.throttlePad} axis ${THROTTLE_LEVER_AXIS} (not the thumb wheel)`
      : `Mapped ${act} → pad ${hit.pad} axis ${hit.axis} invert=${hit.invert}`;
    $("deviceList").textContent = mapped;
    return;
  }
  if (act === "map:trigger" || act === "map:thumb") {
    const liveList = snapshotAllPads();
    const restList = Array.isArray(S.restSnap) ? S.restSnap : [];
    let found = null;
    for (const live of liveList) {
      const rest = restList.find((r) => r.index === live.index) || { buttons: [] };
      const btn = detectPressedButton(rest, live);
      if (btn != null) {
        found = { pad: live.index, button: btn };
        break;
      }
    }
    if (!found) {
      $("deviceList").textContent = "No new button. Hold the button, then capture.";
      return;
    }
    if (act === "map:trigger") {
      profile.stickTrigger = found;
    } else {
      profile.throttleThumb = found;
    }
    saveProfile(profile);
    S.benchStep = Math.min(S.benchStep + 1, STEPS.length - 1);
    renderSteps();
    renderChecklist();
    $("deviceList").textContent = `Mapped ${act} → pad ${found.pad} button ${found.button}`;
  }
}

function drawBenchMeters() {
  const pads = navigator.getGamepads?.() || [];
  const input = bus.poll(pads);
  $("nxOut").textContent = input.nx.toFixed(2);
  $("nyOut").textContent = input.ny.toFixed(2);
  $("thrOut").textContent = input.throttle.toFixed(2);

  const present = [];
  for (let p = 0; p < pads.length; p++) if (pads[p]) present.push(pads[p]);
  if (!present.length) {
    $("axisMeters").innerHTML = "";
    $("buttonLeds").innerHTML = "";
    return;
  }
  $("axisMeters").innerHTML = present
    .map((pad) => {
      const axes = Array.from(pad.axes || []);
      const head = `<div class="tiny" style="margin:8px 0 4px">Pad ${pad.index} · ${pad.id}</div>`;
      const rows = axes
        .map((v, i) => {
          const isThr = pad.index === bus.profile.throttlePad && i === bus.profile.throttle.axis;
          const width = isThr ? ((v - -1) / 2) * 100 : Math.abs(v) * 50;
          const left = isThr ? 0 : v >= 0 ? 50 : 50 - width;
          return `<div class="meter"><span>P${pad.index}A${i}</span>
            <div class="track"><div class="fill ${isThr ? "thr" : ""}" style="left:${left}%;width:${Math.max(2, width)}%"></div></div>
            <span>${v.toFixed(2)}</span></div>`;
        })
        .join("");
      return head + rows;
    })
    .join("");
  $("buttonLeds").innerHTML = present
    .flatMap((pad) =>
      Array.from(pad.buttons || []).map((b, i) => {
        const on = b.pressed || (b.value ?? 0) > 0.5;
        return `<div class="btn-led ${on ? "on" : ""}">P${pad.index}B${i}</div>`;
      }),
    )
    .join("");
}

function legendFor(mode) {
  const bits = {
    vtt: "Throttle moves the red brackets. Keep them on the yellow aircraft. Small inputs.",
    att: "Stick moves the reticle. Forward = down. Stay on the aircraft without chasing hard.",
    avtt: "Left lane = throttle. Right field = stick. Do not drop one to save the other.",
    dlt: "Attend the cued ear. Even → stick trigger. Odd → throttle thumb. Ignore letters and the other ear.",
    multi: "All three channels. Tracking first, then the ear, then back. Never freeze the stick for a number.",
    emergency: "T1–T6 (or keys 1–6) match the shouted emergency. Hit it, then return to the pip.",
  };
  return bits[mode] || "";
}

function resetRun(mode, { ear, duration } = {}) {
  S.mode = mode;
  S.lastMode = mode;
  S.running = true;
  S.paused = false;
  S.elapsed = 0;
  S.lastTs = 0;
  S.duration = duration || MODES[mode]?.duration || 60;
  S.rng = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  S.vttTarget = null;
  S.attTarget = null;
  S.vttReticle = null;
  S.attReticle = null;
  S.vttStats = createTrackingStats();
  S.attStats = createTrackingStats();
  S.dltStats = createDltStats();
  S.emStats = createDltStats();
  S.ear = ear || (Math.random() < 0.5 ? "L" : "R");
  S.dltLive = { ear: S.ear, left: "·", right: "·" };
  S.dltWindow = null;
  S.nextDltAt = 1.8;
  S.nextEmAt = 7 + S.rng() * 4;
  S.emLive = null;
  bus.keyboardThrottle = 0.5;
  $("modeLabel").textContent = (MODES[mode]?.title || mode).toUpperCase();
  $("legend").textContent = legendFor(mode);
  $("dltTape").style.opacity = S.examAids ? "1" : "0.25";
  $("emGrid").innerHTML = EMERGENCIES.map(
    (e) => `<div class="em" data-em="${e.id}"><b>${e.button}</b> ${e.label}</div>`,
  ).join("");
  $("liveHint").textContent = usesDlt(mode) ? `ATTEND ${S.ear === "L" ? "LEFT" : "RIGHT"} EAR` : "";
}

function usesVtt(mode) {
  return mode === "vtt" || mode === "avtt" || mode === "multi" || mode === "emergency";
}
function usesAtt(mode) {
  return mode === "att" || mode === "avtt" || mode === "multi" || mode === "emergency";
}
function usesDlt(mode) {
  return mode === "dlt" || mode === "multi" || mode === "emergency";
}
function usesEm(mode) {
  return mode === "emergency";
}

function startMode(mode, opts = {}) {
  show("play");
  resetRun(mode, opts);
  ensureAudio().then(() => {
    if (usesDlt(mode)) {
      audio.playMono(S.ear === "L" ? "attend-left" : "attend-right", "C");
    }
  });
}

function startBattery() {
  S.battery = BATTERY;
  S.batteryIndex = 0;
  const first = BATTERY[0];
  startMode(first.mode, { ear: first.ear, duration: first.duration });
  $("modeLabel").textContent = first.label;
}

function closeDltWindow(missIfOpen = true) {
  const w = S.dltWindow;
  if (!w) return;
  if (!w.responded && missIfOpen) {
    const grade = gradeDltResponse(w.expected, null, 0);
    pushDltGrade(S.dltStats, grade, 0);
  }
  S.dltWindow = null;
}

function fireDltPair() {
  const pair = makePair(S.rng);
  S.dltLive = { ear: S.ear, left: pair.left, right: pair.right };
  $("tapeL").textContent = pair.left;
  $("tapeR").textContent = pair.right;
  const expected = expectedDltResponse(S.ear, pair.left, pair.right);
  closeDltWindow(true);
  S.dltWindow = { expected, t0: S.elapsed, responded: false };
  audio.playPair(pair.left, pair.right);
  flashEar("L", pair.left);
  flashEar("R", pair.right);
}

function fireEmergency() {
  const e = EMERGENCIES[Math.floor(S.rng() * EMERGENCIES.length)];
  S.emLive = { ...e, t0: S.elapsed, responded: false };
  audio.playMono(e.id, "C");
  for (const node of document.querySelectorAll(".em")) {
    node.classList.toggle("hot", node.getAttribute("data-em") === e.id);
  }
}

function gradeEmergency(name) {
  if (!S.emLive || S.emLive.responded) return;
  S.emLive.responded = true;
  const rt = (S.elapsed - S.emLive.t0) * 1000;
  const ok = name === S.emLive.button;
  pushDltGrade(S.emStats, ok ? "HIT" : "WRONG_BUTTON", rt);
}

function ensureWorld(lay) {
  const schedule = SPEED_SCHEDULES[S.mode] || SPEED_SCHEDULES.att;
  const spd = speedAt(S.elapsed, schedule);
  if (lay.vtt && !S.vttTarget) {
    S.vttTarget = createTarget({
      axis: "y",
      x: lay.vtt.x + lay.vtt.w / 2,
      y: lay.vtt.y + lay.vtt.h / 2,
      speed: spd,
      rng: S.rng,
    });
    S.vttReticle = { x: S.vttTarget.x, y: S.vttTarget.y };
  }
  if (lay.att && !S.attTarget) {
    S.attTarget = createTarget({
      axis: "xy",
      x: lay.att.x + lay.att.w / 2,
      y: lay.att.y + lay.att.h / 2,
      speed: spd,
      rng: S.rng,
    });
    S.attReticle = { x: S.attTarget.x, y: S.attTarget.y };
  }
}

function tick(ts) {
  requestAnimationFrame(tick);
  updatePills();
  if (S.view === "bench") drawBenchMeters();
  if (S.view !== "play" || !S.running) return;

  if (!S.lastTs) S.lastTs = ts;
  const dt = Math.min(0.05, (ts - S.lastTs) / 1000);
  S.lastTs = ts;
  if (S.paused) {
    drawPlay();
    return;
  }
  S.elapsed += dt;

  const pads = navigator.getGamepads?.() || [];
  const input = bus.poll(pads);
  const canvas = $("stage");
  const size = resizeCanvas(canvas);
  const lay = layoutFor(S.mode, size.w, size.h);
  ensureWorld(lay);
  const schedule = SPEED_SCHEDULES[S.mode] || SPEED_SCHEDULES.att;
  const spd = speedAt(S.elapsed, schedule);

  if (usesVtt(S.mode) && lay.vtt && S.vttTarget) {
    const y = throttleToY(input.throttle, lay.vtt.h, 28) + lay.vtt.y;
    S.vttReticle.y = lagToward(S.vttReticle.y ?? y, y, dt);
    S.vttReticle.x = lay.vtt.x + lay.vtt.w / 2;
    S.vttOn = isOnTarget(S.vttReticle, S.vttTarget, 20);
    S.vttTarget = stepTarget(S.vttTarget, dt, {
      width: lay.vtt.x + lay.vtt.w,
      height: lay.vtt.y + lay.vtt.h,
      pad: lay.vtt.y + 36,
      speed: spd * 0.85,
      rng: S.rng,
      onTarget: S.vttOn,
    });
    // Keep X pinned to lane center; clamp Y into lane.
    S.vttTarget.x = lay.vtt.x + lay.vtt.w / 2;
    S.vttTarget.y = Math.max(lay.vtt.y + 36, Math.min(lay.vtt.y + lay.vtt.h - 36, S.vttTarget.y));
    pushTrackingSample(S.vttStats, Math.abs(S.vttReticle.y - S.vttTarget.y), S.vttOn);
  }

  if (usesAtt(S.mode) && lay.att && S.attTarget) {
    const desired = stickToPoint(input.nx, input.ny, lay.att.w, lay.att.h, 32);
    desired.x += lay.att.x;
    desired.y += lay.att.y;
    S.attReticle.x = lagToward(S.attReticle.x ?? desired.x, desired.x, dt);
    S.attReticle.y = lagToward(S.attReticle.y ?? desired.y, desired.y, dt);
    S.attOn = isOnTarget(S.attReticle, S.attTarget, 22);
    S.attTarget = stepTarget(S.attTarget, dt, {
      width: lay.att.x + lay.att.w,
      height: lay.att.y + lay.att.h,
      pad: 40,
      speed: spd,
      rng: S.rng,
      onTarget: S.attOn,
    });
    S.attTarget.x = Math.max(lay.att.x + 40, Math.min(lay.att.x + lay.att.w - 40, S.attTarget.x));
    S.attTarget.y = Math.max(lay.att.y + 40, Math.min(lay.att.y + lay.att.h - 40, S.attTarget.y));
    pushTrackingSample(
      S.attStats,
      dist(S.attReticle.x, S.attReticle.y, S.attTarget.x, S.attTarget.y),
      S.attOn,
    );
  }

  if (usesDlt(S.mode)) {
    if (S.elapsed >= S.nextDltAt) {
      fireDltPair();
      S.nextDltAt = S.elapsed + DLT_ISI_MS / 1000;
    }
    if (S.dltWindow && !S.dltWindow.responded && input.dlt) {
      const rt = (S.elapsed - S.dltWindow.t0) * 1000;
      const grade = gradeDltResponse(S.dltWindow.expected, input.dlt, rt);
      pushDltGrade(S.dltStats, grade, rt);
      S.dltWindow.responded = true;
    }
    if (S.dltWindow && S.elapsed - S.dltWindow.t0 > DLT_WINDOW_MS / 1000) {
      closeDltWindow(true);
    }
  }

  if (usesEm(S.mode)) {
    if (S.elapsed >= S.nextEmAt) {
      if (S.emLive && !S.emLive.responded) pushDltGrade(S.emStats, "MISS", 0);
      fireEmergency();
      S.nextEmAt = S.elapsed + 9 + S.rng() * 6;
    }
    if (S.emLive && !S.emLive.responded && input.emergencies.length) {
      gradeEmergency(input.emergencies[0]);
    }
    if (S.emLive && S.elapsed - S.emLive.t0 > 2.8 && !S.emLive.responded) {
      pushDltGrade(S.emStats, "MISS", 0);
      S.emLive.responded = true;
    }
  }

  $("clock").textContent = formatSeconds(S.duration - S.elapsed);
  const attS = summarizeTracking(S.attStats);
  const vttS = summarizeTracking(S.vttStats);
  const dltS = summarizeDlt(S.dltStats);
  $("attPct").textContent = usesAtt(S.mode) ? `${attS.pctOnTarget.toFixed(0)}%` : "—";
  $("vttPct").textContent = usesVtt(S.mode) ? `${vttS.pctOnTarget.toFixed(0)}%` : "—";
  $("dltHits").textContent = usesDlt(S.mode) ? `${dltS.hits} / FA ${dltS.falseAlarms}` : "—";
  $("dltRt").textContent = usesDlt(S.mode) && dltS.rtHits ? `${dltS.meanRt.toFixed(0)} ms` : "—";
  $("emHits").textContent = usesEm(S.mode) ? `${S.emStats.hits}/${S.emStats.trials}` : "—";

  drawPlay();

  if (S.elapsed >= S.duration) finishRun();
}

function drawPlay() {
  const canvas = $("stage");
  const size = resizeCanvas(canvas);
  const ctx = canvas.getContext("2d");
  drawFrame(ctx, {
    w: size.w,
    h: size.h,
    mode: S.mode,
    vttTarget: S.vttTarget,
    attTarget: S.attTarget,
    vttReticle: S.vttReticle,
    attReticle: S.attReticle,
    vttOn: S.vttOn,
    attOn: S.attOn,
    dlt: S.dltLive,
  });
}

function finishRun() {
  S.running = false;
  closeDltWindow(true);
  const att = usesAtt(S.mode) ? summarizeTracking(S.attStats) : null;
  const vtt = usesVtt(S.mode) ? summarizeTracking(S.vttStats) : null;
  const dlt = usesDlt(S.mode) ? summarizeDlt(S.dltStats) : null;
  const emergency = usesEm(S.mode) ? summarizeEmergency(S.emStats) : null;
  const report = {
    mode: S.mode,
    duration: S.duration,
    ear: usesDlt(S.mode) ? S.ear : null,
    att,
    vtt,
    dlt,
    emergency,
    composite: compositeScore({ att, vtt, dlt, emergency }),
    at: new Date().toISOString(),
  };
  const hist = JSON.parse(localStorage.getItem("astb-pbm-history") || "[]");
  hist.unshift(report);
  localStorage.setItem("astb-pbm-history", JSON.stringify(hist.slice(0, 40)));

  if (S.battery && S.batteryIndex < S.battery.length - 1) {
    S.batteryIndex += 1;
    const next = S.battery[S.batteryIndex];
    startMode(next.mode, { ear: next.ear, duration: next.duration });
    $("modeLabel").textContent = next.label;
    return;
  }

  show("debrief");
  $("debriefTitle").textContent = S.battery ? "Battery complete" : `${MODES[S.mode]?.title || S.mode} complete`;
  $("debriefLede").textContent = "Practice metrics only — time-on-target and DLT hit/false-alarm rates. Not an official PFAR.";
  $("scAll").textContent = formatScore(report.composite);
  $("scAtt").textContent = att ? formatScore(att.score) : "—";
  $("scVtt").textContent = vtt ? formatScore(vtt.score) : "—";
  $("scDlt").textContent = dlt ? formatScore(dlt.score) : "—";
  $("debriefJson").textContent = JSON.stringify(report, null, 2);
}

function go(name) {
  if (name === "home") {
    S.running = false;
    S.battery = null;
    show("home");
    return;
  }
  if (name === "bench") {
    S.running = false;
    show("bench");
    renderSteps();
    renderChecklist();
    ensureAudio();
    return;
  }
  if (name === "battery") return startBattery();
  if (MODES[name] || name === "vtt" || name === "att") return startMode(name);
}

document.addEventListener("click", (e) => {
  const goTo = e.target.closest?.("[data-go]")?.getAttribute("data-go");
  if (goTo) go(goTo);
  const act = e.target.closest?.("[data-step-act]")?.getAttribute("data-step-act");
  if (act) applyStepAction(act);
});

$("homeBtn").addEventListener("click", () => go("home"));
$("audioUnlock")?.addEventListener("click", () => ensureAudio());
$("pickOutput")?.addEventListener("click", () => applyStepAction("pick"));
$("outputSelect")?.addEventListener("change", async (e) => {
  await audio.setSink(e.target.value);
  S.probes.audioOut = true;
  saveProbes();
  updatePills();
});
$("saveMap")?.addEventListener("click", () => {
  saveProfile(bus.profile);
  $("deviceList").textContent = "Mapping saved on this Mac.";
});
$("pauseBtn")?.addEventListener("click", () => {
  S.paused = !S.paused;
  $("pauseBtn").textContent = S.paused ? "Resume" : "Pause";
});
$("endBtn")?.addEventListener("click", () => finishRun());
$("againBtn")?.addEventListener("click", () => {
  if (S.battery) startBattery();
  else startMode(S.lastMode, { ear: S.ear });
});
$("examAids")?.addEventListener("change", (e) => {
  S.examAids = e.target.checked;
});

window.addEventListener("gamepadconnected", () => {
  S.probes.device = true;
  saveProbes();
  updatePills();
  if (S.view === "bench") {
    const pads = listPads(navigator.getGamepads?.() || []);
    $("deviceList").textContent = pads.map((p) => `#${p.index} ${p.id} · ${p.axes} axes · ${p.buttons} buttons`).join("\n");
  }
});

window.__pbm = {
  S,
  audio,
  bus,
  startMode,
  go,
  ensureAudio,
  fireDltPair,
  expectedDltResponse,
  finishRun,
  async selfTest() {
    await ensureAudio();
    audio.playTone("L");
    const left = { ...audio.lastPeaks };
    audio.playTone("R");
    const right = { ...audio.lastPeaks };
    const pads = listPads(navigator.getGamepads?.() || []);
    const check = mappingChecklist(bus.profile, { device: pads.length > 0, ...S.probes });
    return {
      audioBuffers: audio.buffers.size,
      missing: audio.missing,
      leftTone: left,
      rightTone: right,
      pads,
      checklist: check,
      swapEars: audio.swapEars,
    };
  },
};

renderSteps();
requestAnimationFrame(tick);
updatePills();
