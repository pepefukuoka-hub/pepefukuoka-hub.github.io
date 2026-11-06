/* 曲のテンポとキー: 画面に出す文章と、長い曲の切り出し(純粋な関数。node でも動く) */
(function (root) {
  'use strict';
  var MAXSEC = 240; // 長い曲は、まん中の4分だけ調べる(待ち時間を短くするため)

  // 長い曲なら、まん中の部分を返す。短ければ、そのまま
  function middle(L, R, sr) {
    var max = MAXSEC * sr;
    if (L.length <= max) return { L: L, R: R, from: 0, sec: L.length / sr, cut: false };
    var a = Math.floor((L.length - max) / 2);
    return { L: L.subarray(a, a + max), R: R.subarray(a, a + max), from: a / sr, sec: MAXSEC, cut: true };
  }

  // Analyze.run の結果を、画面用にまとめる
  function describe(r) {
    var out = { bpm: null, half: null, double: null, key: null, rel: null, keyNote: '' };
    if (r && r.bpm) { out.bpm = Math.round(r.bpm); out.half = Math.round(r.bpm / 2); out.double = Math.round(r.bpm * 2); }
    if (r && r.key) {
      out.key = r.key.name; out.rel = r.key.rel;
      out.keyNote = r.key.conf < 0.03 ? '自信は低めです(転調する曲や、音の少ない曲では、外れやすい)' : '';
    }
    return out;
  }

  var api = { middle: middle, describe: describe, MAXSEC: MAXSEC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TempoKey = api;
})(this);
