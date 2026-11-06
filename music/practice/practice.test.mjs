// node practice.test.mjs で動く。合成した音で、テンポ・音程の変更を確かめる
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { Engine } = createRequire(import.meta.url)('./worklet.js');
const SR = 44100;
function sine(f, sec, amp = 0.5) { const x = new Float32Array(Math.floor(SR * sec)); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / SR); return x; }
function run(x, { tempo = 1, semi = 0, seek = 0, loop = null, maxSec = 60 } = {}) {
  const e = new Engine(SR); e.load(x, x); e.setTempo(tempo); e.setPitch(semi);
  if (loop) e.setLoop(true, loop[0], loop[1]);
  e.seek(seek); e.playing = true;
  const out = []; const bl = new Float32Array(128), br = new Float32Array(128); let total = 0;
  while (total < SR * maxSec) {
    e.render(bl, br, 128); out.push(Float32Array.from(bl)); total += 128;
    if (e.consumeEnded()) break;
  }
  const y = new Float32Array(total); out.forEach((b, i) => y.set(b, i * 128));
  return { y, e, total };
}
function freq(y, a, b) { // 正方向のゼロ交差から、周波数を求める
  let first = -1, last = -1, n = 0;
  for (let i = a + 1; i < b; i++) if (y[i - 1] < 0 && y[i] >= 0) { const t = i - y[i] / (y[i] - y[i - 1]); if (first < 0) first = t; last = t; n++; }
  return (n - 1) * SR / (last - first);
}
function rms(y, a, b) { let s = 0; for (let i = a; i < b; i++) s += y[i] * y[i]; return Math.sqrt(s / (b - a)); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// 1) そのまま(100%・0半音)
{ const x = sine(440, 4); const { y, total } = run(x);
  near(total / SR, 4, 0.1, '長さ'); near(freq(y, SR, 3 * SR), 440, 1, '周波数'); near(rms(y, SR, 3 * SR), 0.5 / Math.SQRT2, 0.01, '音量'); }
// 2) テンポ 50% → 長さ2倍、音程そのまま
{ const x = sine(440, 4); const { y, total } = run(x, { tempo: 0.5 });
  near(total / SR, 8, 0.2, '50% の長さ'); near(freq(y, SR, 7 * SR), 440, 2, '50% の周波数'); near(rms(y, SR, 7 * SR), 0.354, 0.03, '50% の音量'); }
// 3) テンポ 150%
{ const x = sine(440, 6); const { y, total } = run(x, { tempo: 1.5 });
  near(total / SR, 4, 0.2, '150% の長さ'); near(freq(y, SR, 3 * SR), 440, 2, '150% の周波数'); }
// 4) 音程 ±3, ±6 半音 → 周波数 × 2^(s/12)、長さそのまま
for (const s of [6, 3, -3, -6]) {
  const x = sine(440, 5); const { y, total } = run(x, { semi: s });
  near(total / SR, 5, 0.15, `${s}半音の長さ`);
  const want = 440 * Math.pow(2, s / 12); near(freq(y, SR, 4 * SR), want, want * 0.005, `${s}半音の周波数`);
  near(rms(y, SR, 4 * SR), 0.354, 0.03, `${s}半音の音量`);
}
// 5) 両方同時(テンポ80% + 音程+5半音)
{ const x = sine(300, 6); const { y, total } = run(x, { tempo: 0.8, semi: 5 });
  near(total / SR, 7.5, 0.2, '両方の長さ'); const want = 300 * Math.pow(2, 5 / 12); near(freq(y, SR, 5 * SR), want, want * 0.006, '両方の周波数'); }
// 6) 位置の報告とシーク
{ const x = sine(440, 10); const e = new Engine(SR); e.load(x, x); e.setTempo(0.5); e.seek(4); e.playing = true;
  const b = new Float32Array(128); let n = 0; while (n < SR * 2) { e.render(b, b, 128); n += 128; }
  near(e.position(), 5, 0.1, '50% で2秒再生後の位置(4秒から)'); }
// 7) A-B ループ: 2秒〜3秒をくり返し、位置が範囲を出ない
{ const x = sine(440, 10); const e = new Engine(SR); e.load(x, x); e.setLoop(true, 2, 3); e.seek(2); e.playing = true;
  const b = new Float32Array(128); let n = 0, minP = 99, maxP = 0, ended = false;
  while (n < SR * 8) { e.render(b, b, 128); n += 128; const p = e.position(); if (n > 2000) { minP = Math.min(minP, p); maxP = Math.max(maxP, p) } if (e.consumeEnded()) ended = true; }
  assert.ok(!ended, 'ループ中は終わらない'); assert.ok(minP > 1.9 && maxP < 3.1, `ループの範囲 ${minP}..${maxP}`);
  const y = []; for (let i = 0; i < 100; i++) { e.render(b, b, 128); y.push(...b); }
  near(freq(Float32Array.from(y), 0, y.length), 440, 4, 'ループ中も音程そのまま'); }
// 8) 一時停止中は、位置が進まず、無音
{ const x = sine(440, 5); const e = new Engine(SR); e.load(x, x); e.playing = true; const b = new Float32Array(128);
  for (let i = 0; i < 200; i++) e.render(b, b, 128); e.playing = false; for (let i = 0; i < 20; i++) e.render(b, b, 128);
  const p = e.position(); for (let i = 0; i < 100; i++) e.render(b, b, 128);
  assert.equal(e.position(), p); assert.equal(rms(b, 0, 128), 0); }
// 9) クリック列(周期的でない音)が、つなぎ目で消えない
{ const x = new Float32Array(SR * 8); for (let k = 0; k < 16; k++) { for (let j = 0; j < 40; j++) x[k * SR / 2 + j] = 0.8 * Math.exp(-j / 8) * (j % 2 ? -1 : 1); }
  const { y } = run(x, { tempo: 1 }); let c = 0, last = -99999; for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > 0.3 && i - last > SR / 4) { c++; last = i; }
  assert.ok(c >= 15 && c <= 17, 'クリック数 ' + c); }
console.log('practice: すべて合格');
