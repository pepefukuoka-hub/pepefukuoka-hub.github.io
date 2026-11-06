/* 練習プレーヤーの音の心臓部。AudioWorklet の中で動く(外部の部品・通信なし)。
   方式: WSOLA(波形の似ている所でつなぎ直す時間伸縮) + 再生速度の変更(リサンプル)
     テンポだけ変える = WSOLA で伸び縮みさせる(音程は、そのまま)
     音程だけ変える   = WSOLA で逆方向に伸び縮みさせてから、その分だけ速く/遅く読む(長さは、そのまま)
   node でも読み込める(practice.test.mjs が、同じコードを試験する)。 */
(function (root) {
  'use strict';
  var N = 2048, HS = N >> 1, SEARCH = 512, STRIDE = 2, CAP = 1 << 16;

  function Engine(sr) {
    this.sr = sr;
    this.win = new Float32Array(N);
    for (var i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    this.ref = new Float32Array(HS / STRIDE);
    this.olaL = new Float32Array(N); this.olaR = new Float32Array(N);
    this.qL = new Float32Array(CAP); this.qR = new Float32Array(CAP);
    this.len = 0; this.L = this.R = this.mono = null;
    this.tempo = 1; this.semi = 0; this.P = 1;
    this.loop = { on: false, a: 0, b: 0 };
    this.playing = false; this.gain = 0; this.endedFlag = false;
    this.seek(0);
  }
  Engine.prototype.load = function (L, R) {
    this.L = L; this.R = R || L; this.len = L.length;
    var m = new Float32Array(this.len);
    for (var i = 0; i < this.len; i++) m[i] = (this.L[i] + this.R[i]) * 0.5;
    this.mono = m; this.seek(0); this.playing = false;
  };
  Engine.prototype.setTempo = function (v) { this.tempo = Math.min(1.5, Math.max(0.5, v)); };
  Engine.prototype.setPitch = function (s) { this.semi = Math.min(6, Math.max(-6, s)); this.P = Math.pow(2, this.semi / 12); };
  Engine.prototype.setLoop = function (on, aSec, bSec) {
    var a = Math.floor(aSec * this.sr), b = Math.floor(bSec * this.sr);
    this.loop = { on: !!on && b - a >= this.sr * 0.1, a: a, b: b };
  };
  Engine.prototype.seek = function (sec) {
    this.t = Math.max(0, Math.floor(sec * this.sr)); this.p = -1; this.first = true;
    this.olaL.fill(0); this.olaR.fill(0);
    this.qe = 0; this.rp = 0; this.finished = false; this.gain = 0;
  };
  Engine.prototype.position = function () { // 元の曲の、いまの位置(秒)
    var sigma = this.tempo / this.P, pos = this.t - (this.qe - this.rp) * sigma;
    return Math.min(this.len, Math.max(0, pos)) / this.sr;
  };
  Engine.prototype.consumeEnded = function () { var e = this.endedFlag; this.endedFlag = false; return e; };

  // 1つ分(HS サンプル)の、伸び縮みした音を作って、キューの後ろに足す
  Engine.prototype.step = function () {
    var len = this.len, sigma = this.tempo / this.P, ha = HS * sigma, lp = this.loop, i;
    if (lp.on && this.t >= lp.b) this.t = lp.a + ((this.t - lp.a) % (lp.b - lp.a));
    if (this.t >= len) { this.finished = true; }
    if (this.qe + HS > CAP) { // 読み終わった所を捨てて、詰める
      var base = Math.max(0, Math.floor(this.rp) - 2);
      this.qL.copyWithin(0, base, this.qe); this.qR.copyWithin(0, base, this.qe);
      this.qe -= base; this.rp -= base;
    }
    var olaL = this.olaL, olaR = this.olaR, qL = this.qL, qR = this.qR, w = this.win, L = this.L, R = this.R;
    if (this.finished) { // 残りのしっぽを出して、おしまい
      for (i = 0; i < HS; i++) { qL[this.qe + i] = olaL[i]; qR[this.qe + i] = olaR[i]; }
      this.qe += HS; return;
    }
    var tc = Math.round(this.t), c = tc;
    if (this.p >= 0) {
      // 前のフレームの「自然なつづき」に、いちばん似ている開始位置を探す
      var mono = this.mono, rs = this.p + HS, rn = HS / STRIDE, ref = this.ref, k, rr = 0;
      for (k = 0; k < rn; k++) { var ri = rs + k * STRIDE; ref[k] = ri < len ? mono[ri] : 0; }
      var lo = Math.max(0, tc - SEARCH), hi = Math.min(len - HS - 1, tc + SEARCH), best = -Infinity;
      for (var cand = lo; cand <= hi; cand++) {
        var xy = 0, yy = 0;
        for (k = 0; k < rn; k++) { var y = mono[cand + k * STRIDE]; xy += ref[k] * y; yy += y * y; }
        var sc = xy / Math.sqrt(yy + 1e-6);
        if (sc > best) { best = sc; c = cand; }
      }
    }
    if (this.first) { // シークの直後は、ふわっと立ち上げず、そのまま始める
      for (i = 0; i < HS; i++) { var si = c + i, f = 1 - w[i]; olaL[i] = si < len ? L[si] * f : 0; olaR[i] = si < len ? R[si] * f : 0; }
      this.first = false;
    }
    for (i = 0; i < N; i++) { var s = c + i; if (s >= 0 && s < len) { olaL[i] += L[s] * w[i]; olaR[i] += R[s] * w[i]; } }
    for (i = 0; i < HS; i++) { qL[this.qe + i] = olaL[i]; qR[this.qe + i] = olaR[i]; }
    this.qe += HS;
    olaL.copyWithin(0, HS, N); olaR.copyWithin(0, HS, N); olaL.fill(0, HS); olaR.fill(0, HS);
    this.p = c; this.t += ha;
  };

  // outL/outR に n サンプル書く
  Engine.prototype.render = function (outL, outR, n) {
    var gstep = 1 / (this.sr * 0.01), P = this.P;
    for (var i = 0; i < n; i++) {
      var target = this.playing ? 1 : 0;
      if (this.gain < target) this.gain = Math.min(target, this.gain + gstep);
      else if (this.gain > target) this.gain = Math.max(target, this.gain - gstep);
      if (this.gain === 0 && !this.playing || !this.len) { outL[i] = 0; outR[i] = 0; continue; }
      while (!this.finished && this.qe - this.rp < 4) this.step();
      if (this.qe - this.rp < 4 && this.finished) { // 最後まで来た
        outL[i] = 0; outR[i] = 0;
        if (this.playing) { this.playing = false; this.endedFlag = true; this.seek(0); }
        continue;
      }
      var i1 = Math.floor(this.rp), f = this.rp - i1, i0 = i1 > 0 ? i1 - 1 : 0, i2 = i1 + 1, i3 = i1 + 2, q = this.qL, v;
      for (var ch = 0; ch < 2; ch++) { // 4点の補間(Catmull-Rom)
        q = ch ? this.qR : this.qL;
        var p0 = q[i0], p1 = q[i1], p2 = q[i2], p3 = q[i3];
        v = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
        if (ch) outR[i] = v * this.gain; else outL[i] = v * this.gain;
      }
      this.rp += P;
    }
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = { Engine: Engine, N: N, HS: HS }; }
  if (typeof registerProcessor === 'function') {
    var Proc = class extends AudioWorkletProcessor {
      constructor() {
        super(); this.e = new Engine(sampleRate); this.cnt = 0;
        this.port.onmessage = (ev) => {
          var m = ev.data, e = this.e;
          if (m.type === 'load') e.load(m.L, m.R);
          else if (m.type === 'play') { e.playing = true; }
          else if (m.type === 'pause') { e.playing = false; }
          else if (m.type === 'seek') { e.seek(m.sec); this.port.postMessage({ type: 'pos', sec: e.position() }); }
          else if (m.type === 'tempo') e.setTempo(m.v);
          else if (m.type === 'pitch') e.setPitch(m.v);
          else if (m.type === 'loop') e.setLoop(m.on, m.a, m.b);
        };
      }
      process(inputs, outputs) {
        var o = outputs[0], l = o[0], r = o[1] || o[0], e = this.e;
        e.render(l, r, l.length);
        this.cnt += l.length;
        if (e.consumeEnded()) this.port.postMessage({ type: 'ended' });
        if (this.cnt >= sampleRate / 25) { this.cnt = 0; if (e.len) this.port.postMessage({ type: 'pos', sec: e.position() }); }
        return true;
      }
    };
    registerProcessor('practice-proc', Proc);
  }
})(this);
