/* メトロノームとチューナーの、純粋な部品(画面や音に関係しない。node でも動く) */
(function (root) {
  'use strict';
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var KANA = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

  // 周波数 → 音名・オクターブ・セントのズレ(a4 は基準の A の周波数)
  function freqToNote(freq, a4) {
    a4 = a4 || 440;
    var midiF = 69 + 12 * Math.log2(freq / a4), midi = Math.round(midiF), pc = ((midi % 12) + 12) % 12;
    return { midi: midi, name: NAMES[pc], kana: KANA[pc], octave: Math.floor(midi / 12) - 1, cents: (midiF - midi) * 100,
             target: a4 * Math.pow(2, (midi - 69) / 12) };
  }

  // 自己相関(正規化二乗差関数 NSDF)で、音の高さを求める。見つからなければ null
  function detectPitch(x, sr, opt) {
    opt = opt || {};
    var minF = opt.minFreq || 50, maxF = opt.maxFreq || 1200, n = x.length, i, tau;
    var rmsv = 0; for (i = 0; i < n; i++) rmsv += x[i] * x[i]; rmsv = Math.sqrt(rmsv / n);
    if (rmsv < (opt.minRms || 0.01)) return null; // 小さすぎる音は、あつかわない
    var maxLag = Math.min(Math.floor(sr / minF), n >> 1), minLag = Math.max(2, Math.floor(sr / maxF));
    var nsdf = new Float32Array(maxLag + 2);
    for (tau = 0; tau <= maxLag + 1; tau++) {
      var acf = 0, m = 0;
      for (i = 0; i + tau < n; i++) { var a = x[i], b = x[i + tau]; acf += a * b; m += a * a + b * b; }
      nsdf[tau] = m > 0 ? 2 * acf / m : 0;
    }
    // 「正に出て、負に戻るまで」の山ごとに、頂点を集める
    var peaks = [], pos = 0;
    tau = 1; while (tau < maxLag && nsdf[tau] > 0) tau++; // 最初の山(tau=0 のまわり)を飛ばす
    for (; tau <= maxLag; tau++) {
      if (nsdf[tau] > 0 && nsdf[tau - 1] <= 0) pos = tau;
      if (pos && nsdf[tau] > 0 && nsdf[tau] >= nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1] && tau >= minLag) { peaks.push(tau); pos = 0; }
    }
    if (!peaks.length) return null;
    var top = 0; for (i = 0; i < peaks.length; i++) if (nsdf[peaks[i]] > top) top = nsdf[peaks[i]];
    if (top < (opt.clarity || 0.8)) return null; // 音程のはっきりしない音
    var pick = peaks[0]; for (i = 0; i < peaks.length; i++) if (nsdf[peaks[i]] >= 0.9 * top) { pick = peaks[i]; break; }
    var y0 = nsdf[pick - 1], y1 = nsdf[pick], y2 = nsdf[pick + 1], den = y0 - 2 * y1 + y2, off = den ? 0.5 * (y0 - y2) / den : 0;
    return { freq: sr / (pick + off), clarity: nsdf[pick], rms: rmsv };
  }

  // タップテンポ: 時刻(ミリ秒)の並びから BPM。2秒以上あいたら、そこで数えなおす
  function tapTempo(times, maxGapMs) {
    maxGapMs = maxGapMs || 2000;
    var t = [], i; for (i = times.length - 1; i >= 0; i--) { if (i < times.length - 1 && times[i + 1] - times[i] > maxGapMs) break; t.unshift(times[i]); }
    t = t.slice(-8); if (t.length < 2) return null;
    return Math.round(600000 / ((t[t.length - 1] - t[0]) / (t.length - 1))) / 10;
  }

  // 先読みスケジューラ。tick() を、こまめに(25ms ごとなど)呼ぶ。
  // 「少し先(lookahead 秒)」までに鳴らす拍を、now() の時計に合わせて、前もって schedule(拍の番号, 時刻) に渡す。
  function Scheduler(o) {
    this.now = o.now; this.schedule = o.schedule; this.lookahead = o.lookahead || 0.2;
    this.bpm = o.bpm || 120; this.beats = o.beats || 4; this.running = false; this.index = 0; this.next = 0;
  }
  Scheduler.prototype.start = function (delay) { this.running = true; this.index = 0; this.next = this.now() + (delay == null ? 0.06 : delay); this.tick(); };
  Scheduler.prototype.stop = function () { this.running = false; };
  Scheduler.prototype.tick = function () {
    if (!this.running) return;
    while (this.next < this.now() + this.lookahead) {
      this.schedule(this.index % this.beats, this.next, this.index);
      this.next += 60 / this.bpm; this.index++; // 速さを変えても、次の拍から反映(ずれが溜まらない)
    }
  };
  Scheduler.prototype.setBeats = function (b) { this.beats = b; this.index = this.index % b; };

  var api = { freqToNote: freqToNote, detectPitch: detectPitch, tapTempo: tapTempo, Scheduler: Scheduler, NAMES: NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MusicCore = api;
})(this);
