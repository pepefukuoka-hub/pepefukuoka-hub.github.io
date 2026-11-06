// node tempo-key.test.mjs で動く。共有部品 ../analyze.js を、合成した音で試す
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
globalThis.window = globalThis; // analyze.js は window に登録するため
const require = createRequire(import.meta.url);
require('../analyze.js');
const TK = require('./tempo-key.js');
const SR = 44100;

function clicks(bpm, sec) { // クリック列(キック風の低い音)
  const x = new Float32Array(SR * sec), step = SR * 60 / bpm;
  for (let t = 0; t < sec * SR - 4000; t += step) { const s = Math.round(t); for (let j = 0; j < 3000; j++) x[s + j] += 0.9 * Math.exp(-j / 500) * Math.sin(2 * Math.PI * 80 * j / SR); }
  return x;
}
function tones(midis, sec) { // 音階の音を順番に鳴らす(倍音つき)
  const x = new Float32Array(SR * sec), per = Math.floor(SR * 0.5);
  for (let n = 0, t = 0; t + per <= x.length; n++, t += per) {
    const f = 440 * Math.pow(2, (midis[n % midis.length] - 69) / 12);
    for (let i = 0; i < per; i++) { const e = Math.min(1, i / 500) * Math.exp(-i / 20000); let v = 0; for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * i / SR) / h; x[t + i] = 0.3 * e * v; }
  }
  return x;
}
const run = (x) => window.Analyze.run(x, x, SR);
const report = [];
for (const bpm of [80, 100, 120, 140, 170]) {
  const r = run(clicks(bpm, 30)); report.push(`クリック ${bpm} -> ${r.bpm && r.bpm.toFixed(1)}`);
  const ok = [bpm, bpm * 2, bpm / 2].some(b => Math.abs(r.bpm - b) < b * 0.03);
  assert.ok(ok, `BPM ${bpm}: ${r.bpm}`);
  if (bpm >= 90 && bpm <= 150) assert.ok(Math.abs(r.bpm - bpm) < bpm * 0.03, `BPM ${bpm} そのまま: ${r.bpm}`);
}
// キー: C メジャーの音階 / A マイナーでなく、A メジャー
const cMajor = [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60, 67, 64, 60];
let r = run(tones(cMajor, 40)); report.push('Cメジャー音階 -> ' + r.key.name);
assert.ok(/^C メジャー|^A マイナー/.test(r.key.name), r.key.name);
const dMinor = [62, 64, 65, 67, 69, 70, 72, 74, 69, 65, 62, 69, 65, 62];
r = run(tones(dMinor, 40)); report.push('Dマイナー音階 -> ' + r.key.name);
assert.ok(/^D マイナー|^F メジャー/.test(r.key.name), r.key.name);
const gMajor = [67, 69, 71, 72, 74, 76, 78, 79, 74, 71, 67, 74, 71, 67];
r = run(tones(gMajor, 40)); report.push('Gメジャー音階 -> ' + r.key.name);
assert.ok(/^G メジャー|^E マイナー/.test(r.key.name), r.key.name);
// describe / middle
const d = TK.describe({ bpm: 121.6, key: { name: 'C メジャー', rel: 'A マイナー', conf: 0.01 } });
assert.equal(d.bpm, 122); assert.equal(d.double, 243); assert.equal(d.half, 61); assert.ok(d.keyNote);
assert.equal(TK.describe({ bpm: null, key: null }).bpm, null);
const long = new Float32Array(SR * 600), m = TK.middle(long, long, SR);
assert.equal(m.sec, 240); assert.equal(m.from, 180); assert.equal(m.L.length, SR * 240);
console.log(report.join('\n')); console.log('tempo-key: すべて合格');
