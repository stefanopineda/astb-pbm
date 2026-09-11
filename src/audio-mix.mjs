/** Channel packing helpers. Node- and browser-safe. */

export function interleaveStereo(left, right) {
  const n = Math.max(left.length, right.length);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = left[i] || 0;
    out[i * 2 + 1] = right[i] || 0;
  }
  return out;
}

export function splitStereo(interleaved) {
  const n = Math.floor(interleaved.length / 2);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = interleaved[i * 2];
    right[i] = interleaved[i * 2 + 1];
  }
  return { left, right };
}

export function peak(samples) {
  let m = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > m) m = a;
  }
  return m;
}

export function isolationRatio(left, right) {
  const lp = peak(left);
  const rp = peak(right);
  return {
    leftPeak: lp,
    rightPeak: rp,
    leftIsolation: lp / Math.max(rp, 1e-6),
    rightIsolation: rp / Math.max(lp, 1e-6),
  };
}

export function tokenUrl(token) {
  if (/^\d$/.test(token)) return `assets/audio/digit-${token}.wav`;
  return `assets/audio/letter-${token}.wav`;
}
