// Whip swish for the whip-in hook: same soft pink-ish wind source as whoosh2
// (the founder called the v1 swept-noise harsh), but 0.45s instead of 0.8s,
// with a fast attack that peaks with the move and a sweep that RISES and dies
// away — a swish, not a gust. Pans right->left, following the picture.
// Deterministic; 48kHz 16-bit stereo WAV.
const fs = require("fs");
const sr = 48000, dur = 0.45, n = Math.round(sr * dur);
const L = new Float64Array(n), R = new Float64Array(n);
let seed = 7717;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 4294967296) * 2 - 1; };
let brown = 0, lp1 = 0, lp2 = 0, hp1 = 0, hpx1 = 0;
for (let i = 0; i < n; i++) {
  const t = i / n;
  const w = rnd();
  brown = 0.985 * brown + 0.015 * w * 40;
  const pinkish = 0.6 * brown + 0.4 * w;
  // Centre sweeps up fast and falls back: 400 -> 2600 -> 500 Hz, peak at 30%.
  const shape = t < 0.3 ? Math.pow(t / 0.3, 0.7) : Math.pow(1 - (t - 0.3) / 0.7, 1.4);
  const fc = 400 + 2200 * shape;
  const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  lp1 += k * (pinkish - lp1); lp2 += k * (lp1 - lp2);
  const khp = 1 - Math.exp((-2 * Math.PI * 160) / sr);
  const hp = lp2 - hpx1 + (1 - khp) * hp1; hpx1 = lp2; hp1 = hp;
  // 60ms attack, then an exponential tail — the move is over in 320ms.
  const env = t < 0.13 ? Math.pow(t / 0.13, 1.2) : Math.exp(-(t - 0.13) / 0.14);
  const pan = 0.45 - 0.9 * t;
  const s = hp * env;
  L[i] = s * Math.cos(((pan + 1) * Math.PI) / 4);
  R[i] = s * Math.sin(((pan + 1) * Math.PI) / 4);
}
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.45 / peak;
const data = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
h.write("data", 36); h.writeUInt32LE(data.length, 40);
fs.writeFileSync(process.argv[2], Buffer.concat([h, data]));
console.log("wrote", process.argv[2]);
