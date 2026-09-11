import { isolationRatio, tokenUrl } from "./audio-mix.mjs";

const PHRASE_FILES = {
  "attend-left": "assets/audio/attend-left.wav",
  "attend-right": "assets/audio/attend-right.wav",
  "engine-fire": "assets/audio/engine-fire.wav",
  "hyd-fail": "assets/audio/hyd-fail.wav",
  "elec-fail": "assets/audio/elec-fail.wav",
  "cabin-press": "assets/audio/cabin-press.wav",
  "engine-fail": "assets/audio/engine-fail.wav",
  "fuel-leak": "assets/audio/fuel-leak.wav",
  "tone-left": "assets/audio/tone-left.wav",
  "tone-right": "assets/audio/tone-right.wav",
  blip: "assets/audio/blip.wav",
};

export class DichoticEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.swapEars = false;
    this.sinkId = "";
    this.lastPeaks = { leftPeak: 0, rightPeak: 0 };
    this.ready = false;
    this.missing = [];
  }

  async unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.sinkId && this.ctx.setSinkId) {
      try {
        await this.ctx.setSinkId(this.sinkId);
      } catch (err) {
        console.warn("setSinkId failed", err);
      }
    }
    return this.ctx;
  }

  async setSink(deviceId) {
    this.sinkId = deviceId || "";
    if (this.ctx?.setSinkId && this.sinkId) await this.ctx.setSinkId(this.sinkId);
  }

  async loadAll() {
    await this.unlock();
    const wanted = { ...PHRASE_FILES };
    for (const d of "0123456789") wanted[d] = tokenUrl(d);
    for (const L of "ABCDEFGHJKLMNPRSTWXYZ") wanted[L] = tokenUrl(L);
    this.missing = [];
    await Promise.all(
      Object.entries(wanted).map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          const raw = await res.arrayBuffer();
          const buf = await this.ctx.decodeAudioData(raw.slice(0));
          this.buffers.set(key, buf);
        } catch {
          this.missing.push(key);
        }
      }),
    );
    this.ready = this.missing.length === 0;
    return { ready: this.ready, missing: this.missing, count: this.buffers.size };
  }

  _channel(which) {
    const left = which === "L";
    return this.swapEars ? !left : left;
  }

  _playBuffer(buffer, { leftGain, rightGain, when = 0 } = {}) {
    if (!this.ctx || !buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const splitter = this.ctx.createChannelSplitter(Math.max(1, buffer.numberOfChannels));
    const merger = this.ctx.createChannelMerger(2);
    const gL = this.ctx.createGain();
    const gR = this.ctx.createGain();
    gL.gain.value = leftGain;
    gR.gain.value = rightGain;

    src.connect(splitter);
    splitter.connect(gL, 0);
    splitter.connect(gR, 0);
    gL.connect(merger, 0, 0);
    gR.connect(merger, 0, 1);
    merger.connect(this.ctx.destination);

    const start = Math.max(this.ctx.currentTime, when || this.ctx.currentTime);
    src.start(start);

    const dur = buffer.duration;
    const ch = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / 64));
    let peak = 0;
    for (let i = 0; i < ch.length; i += step) peak = Math.max(peak, Math.abs(ch[i]));
    if (leftGain > rightGain) this.lastPeaks = { leftPeak: peak * leftGain, rightPeak: peak * rightGain };
    else if (rightGain > leftGain) this.lastPeaks = { leftPeak: peak * leftGain, rightPeak: peak * rightGain };
    else this.lastPeaks = { leftPeak: peak * leftGain, rightPeak: peak * rightGain };

    return { src, duration: dur, start };
  }

  playMono(key, ear /* 'L' | 'R' | 'C' */) {
    const buf = this.buffers.get(key);
    if (!buf) return null;
    if (ear === "C") return this._playBuffer(buf, { leftGain: 0.9, rightGain: 0.9 });
    const isL = this._channel(ear);
    return this._playBuffer(buf, {
      leftGain: isL ? 1 : 0,
      rightGain: isL ? 0 : 1,
    });
  }

  playPair(leftToken, rightToken) {
    const lKey = this._channel("L") ? leftToken : rightToken;
    const rKey = this._channel("L") ? rightToken : leftToken;
    const lBuf = this.buffers.get(lKey);
    const rBuf = this.buffers.get(rKey);
    const when = this.ctx ? this.ctx.currentTime + 0.02 : 0;
    const l = lBuf ? this._playBuffer(lBuf, { leftGain: 1, rightGain: 0, when }) : null;
    const r = rBuf ? this._playBuffer(rBuf, { leftGain: 0, rightGain: 1, when }) : null;
    this.lastPeaks = {
      leftPeak: l ? 1 : 0,
      rightPeak: r ? 1 : 0,
    };
    return { left: l, right: r, when };
  }

  playTone(ear) {
    const key = ear === "L" ? "tone-left" : "tone-right";
    if (this.buffers.has(key)) return this.playMono(key, ear);
    return this._beep(ear === "L" ? 440 : 554.37, ear);
  }

  _beep(freq, ear, seconds = 0.55) {
    if (!this.ctx) return null;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, this.ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + seconds);
    const merger = this.ctx.createChannelMerger(2);
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    const isL = this._channel(ear);
    osc.connect(g);
    if (isL) {
      g.connect(merger, 0, 0);
      silent.connect(merger, 0, 1);
    } else {
      silent.connect(merger, 0, 0);
      g.connect(merger, 0, 1);
    }
    merger.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + seconds + 0.02);
    this.lastPeaks = isL ? { leftPeak: 1, rightPeak: 0 } : { leftPeak: 0, rightPeak: 1 };
    return { duration: seconds };
  }

  isolationReport() {
    return isolationRatio(
      [this.lastPeaks.leftPeak],
      [this.lastPeaks.rightPeak],
    );
  }
}

export async function listOutputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audiooutput");
}

export async function pickOutputDevice() {
  if (navigator.mediaDevices?.selectAudioOutput) {
    return navigator.mediaDevices.selectAudioOutput();
  }
  return null;
}
