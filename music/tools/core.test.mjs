// node core.test.mjs で動く。音名・セント変換、ピッチ検出、タップテンポ、先読みスケジューラを試す
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const C = createRequire(import.meta.url)('./core.js');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const SR = 44100;

// 音名・セント
let n = C.freqToNote(440); assert.equal(n.name, 'A'); assert.equal(n.octave, 4); near(n.cents, 0, 1e-9, 'A4');
n = C.freqToNote(261.6256); assert.equal(n.name, 'C'); assert.equal(n.octave, 4); near(n.cents, 0, 0.01, 'C4');
n = C.freqToNote(466.16 * 1.01); assert.equal(n.name, 'A#'); near(n.cents, 17.2, 0.5, 'A#4 +17c');
n = C.freqToNote(82.41); assert.equal(n.name, 'E'); assert.equal(n.octave, 2);
n = C.freqToNote(442, 442); assert.equal(n.name, 'A'); near(n.cents, 0, 1e-9, 'A=442');
n = C.freqToNote(440, 442); assert.equal(n.name, 'A'); near(n.cents, -7.85, 0.05, 'A=442 で 440 は -7.85c');
n = C.freqToNote(440 * Math.pow(2, -0.3 / 12)); near(n.cents, -30, 1e-6, '-30c'); // 半音の手前でも、同じ音名

// ピッチ検出: 正弦波と、倍音の多い音(基本周波数が弱い音を含む)
function wave(f, harm, N = 2048, ph = 0.3) { const x = new Float32Array(N); for (let i = 0; i < N; i++) { let v = 0; harm.forEach((a, h) => v += a * Math.sin(2 * Math.PI * f * (h + 1) * i / SR + ph * (h + 1))); x[i] = 0.3 * v; } return x; }
for (const f of [82.41, 110, 196, 261.63, 440, 659.26, 987.77]) {
  const r = C.detectPitch(wave(f, [1]), SR); assert.ok(r, 'sine ' + f); near(1200 * Math.log2(r.freq / f), 0, 3, `sine ${f} (セント)`);
  const r2 = C.detectPitch(wave(f, [1, 0.8, 0.6, 0.4, 0.3]), SR); assert.ok(r2, 'harm ' + f); near(1200 * Math.log2(r2.freq / f), 0, 3, `倍音つき ${f}`);
}
{ const f = 220, r = C.detectPitch(wave(f, [0.2, 1, 0.7, 0.5]), SR); assert.ok(r); near(1200 * Math.log2(r.freq / f), 0, 5, '基音が弱くても 220Hz(オクターブ誤りなし)'); }
// 少しずれた音のセント(A=440 で 435Hz は約 -20c)
{ const r = C.detectPitch(wave(435, [1, 0.5]), SR), nn = C.freqToNote(r.freq); assert.equal(nn.name, 'A'); near(nn.cents, 1200 * Math.log2(435 / 440), 3, '435Hz のセント'); }
// ノイズ・無音は null
{ const x = new Float32Array(2048); assert.equal(C.detectPitch(x, SR), null);
  let s = 1; for (let i = 0; i < x.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = 0.3 * (s / 4294967296 - 0.5); } assert.equal(C.detectPitch(x, SR), null, '雑音'); }
// 雑音まじり(SN比 約 20dB)でも、おおよそ当たる
{ const x = wave(330, [1, 0.5]); let s = 7; for (let i = 0; i < x.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] += 0.03 * (s / 4294967296 - 0.5); } const r = C.detectPitch(x, SR); assert.ok(r); near(1200 * Math.log2(r.freq / 330), 0, 8, '雑音まじり'); }

// タップテンポ
assert.equal(C.tapTempo([0]), null);
assert.equal(C.tapTempo([0, 500, 1000, 1500]), 120);
assert.equal(C.tapTempo([0, 600, 1200]), 100);
assert.equal(C.tapTempo([0, 500, 5000, 5500, 6000]), 120, '2秒あいたら数えなおす');
assert.equal(C.tapTempo([0, 500, 5000]), null);

// 先読みスケジューラ: 25ms ごとの tick(ゆれあり)で、拍が等間隔・重複なし
{ let now = 0; const got = [];
  const s = new C.Scheduler({ now: () => now, schedule: (b, t, i) => got.push({ b, t, i }), bpm: 150, beats: 3, lookahead: 0.12 });
  s.start(0);
  let seed = 3; while (now < 10) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; now += 0.025 + (seed % 20) / 1000; s.tick(); } // 25〜45ms の、ゆれる呼び出し
  assert.ok(got.length >= 24, '拍の数 ' + got.length);
  got.forEach((g, k) => { assert.equal(g.i, k); assert.equal(g.b, k % 3); near(g.t, k * 0.4, 1e-9, '拍の時刻'); });
  // 速さを途中で変える: 次の拍から新しい間隔
  const before = got.length, lastT = got[before - 1].t; s.bpm = 60;
  while (now < 20) { now += 0.03; s.tick(); }
  const g1 = got[before]; near(g1.t - lastT, 0.4, 1e-9, '変更前に決めた拍'); near(got[before + 1].t - g1.t, 1.0, 1e-9, '新しい間隔(60BPM)');
  s.stop(); const c = got.length; now += 5; s.tick(); assert.equal(got.length, c, '止めたら鳴らさない'); }
console.log('tools: すべて合格');
