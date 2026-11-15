'use strict';
/* 手書きノート：Apple Pencil 向けの Web アプリ。データは端末内（IndexedDB）に保存する。 */

const PW = 1000, PH = 1414, GAP = 28, M = 14;      // 1ページ＝A4縦。1000単位＝210mm（1単位＝0.21mm）
const MM = PW / 210;
const MAXPX = 6e6;                                  // ページの下絵1枚の画素数の上限（iPad のメモリ対策）
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const PAPERS = {
  white: { bg: '#ffffff', line: '#c3cedd' },
  cream: { bg: '#fbf5e3', line: '#d6c9a2' },
  dark: { bg: '#1f2125', line: '#41454d' },
};
const COVERS = ['#2f5fd0', '#d2493f', '#2e9b62', '#e2a22b', '#7a52c7', '#3a3f4a'];
const PEN_COLORS = ['#1a1a1a', '#1556c5', '#d62828', '#1f8a3b', '#e07b00'];
const HL_COLORS = ['#ffe135', '#7dea7a', '#ff8fc7', '#6fc8ff', '#ffab4a'];
const WIDTHS = { pen: [1.6, 2.8, 4.6], hl: [14, 22, 34], eraser: [8, 16, 32], lasso: [] };

/* ---------- 設定（端末に保存） ---------- */
const S = Object.assign({
  tool: 'pen', fingerDraw: true, penSeen: false, eraseWhole: false,
  pen: { c: PEN_COLORS[0], w: 2.8 }, hl: { c: HL_COLORS[0], w: 22 }, eraser: { w: 16 },
}, JSON.parse(localStorage.getItem('notes-settings') || '{}'));
// 入力：finger＝指でも書く／pen＝ペンで書き、指で動かす／penonly＝ペンだけ（1本指は無視、2本指で移動・拡大）
if (!S.input) S.input = S.penSeen && !S.fingerDraw ? 'pen' : 'finger';
const saveSettings = () => localStorage.setItem('notes-settings', JSON.stringify(S));

/* ---------- 保存（IndexedDB） ---------- */
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('notes-app', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('books', { keyPath: 'id' });
      d.createObjectStore('pages', { keyPath: 'id' }).createIndex('book', 'bookId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function tx(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
    out = fn(t);
  });
}
const getBooks = () => rq(db.transaction('books').objectStore('books').getAll());
const getPages = (bookId) => rq(db.transaction('pages').objectStore('pages').index('book').getAll(bookId));

/* ---------- 線の形 ---------- */
const bbCache = new WeakMap(), denseCache = new WeakMap();
function bb(s) {
  let b = bbCache.get(s);
  if (!b) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const p = s.p;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
    }
    const e = s.w;
    b = [x0 - e, y0 - e, x1 + e, y1 + e];
    bbCache.set(s, b);
  }
  return b;
}
function dense(s) {                                   // 点の間を約3単位おきに補う（消しゴムの当たり判定用）
  let d = denseCache.get(s);
  if (!d) {
    const p = s.p; d = [p[0], p[1], p[2]];
    for (let i = 3; i < p.length; i += 3) {
      const dx = p[i] - p[i - 3], dy = p[i + 1] - p[i - 2], n = Math.ceil(Math.hypot(dx, dy) / 3);
      for (let k = 1; k <= n; k++) { const t = k / n; d.push(p[i - 3] + dx * t, p[i - 2] + dy * t, p[i - 1] + (p[i + 2] - p[i - 1]) * t); }
    }
    denseCache.set(s, d);
  }
  return d;
}
const penW = (w, pr) => w * (0.35 + 1.3 * pr);
let darkPaper = false;
function drawStroke(c, s) {
  const p = s.p, n = p.length / 3;
  c.lineCap = c.lineJoin = 'round';
  if (s.t === 'hl') {
    c.save();
    c.globalAlpha = 0.4; c.globalCompositeOperation = darkPaper ? 'source-over' : 'multiply';
    c.strokeStyle = s.c; c.lineWidth = s.w;
    c.beginPath(); c.moveTo(p[0], p[1]);
    if (n === 1) c.lineTo(p[0] + 0.01, p[1]);
    for (let i = 1; i < n - 1; i++) c.quadraticCurveTo(p[i * 3], p[i * 3 + 1], (p[i * 3] + p[i * 3 + 3]) / 2, (p[i * 3 + 1] + p[i * 3 + 4]) / 2);
    if (n > 1) c.lineTo(p[n * 3 - 3], p[n * 3 - 2]);
    c.stroke(); c.restore();
    return;
  }
  c.strokeStyle = c.fillStyle = s.c;
  if (n === 1) { c.beginPath(); c.arc(p[0], p[1], penW(s.w, p[2]) / 2, 0, 7); c.fill(); return; }
  let mx = p[0], my = p[1];
  for (let i = 1; i < n; i++) {
    const j = i * 3, last = i === n - 1;
    const nx = last ? p[j] : (p[j] + p[j + 3]) / 2, ny = last ? p[j + 1] : (p[j + 1] + p[j + 4]) / 2;
    c.beginPath(); c.moveTo(mx, my);
    if (last) c.lineTo(nx, ny); else c.quadraticCurveTo(p[j], p[j + 1], nx, ny);
    c.lineWidth = penW(s.w, (p[j - 1] + p[j + 2]) / 2);
    c.stroke();
    mx = nx; my = ny;
  }
}
function paintPaper(c, book) {
  const P = PAPERS[book.paperColor] || PAPERS.white;
  c.fillStyle = P.bg; c.fillRect(0, 0, PW, PH);
  c.strokeStyle = c.fillStyle = P.line; c.lineWidth = 1;
  const k = book.paper;
  if (k === 'ruled') {
    const st = 7 * MM;
    c.beginPath();
    for (let y = 24 * MM; y < PH - 10 * MM; y += st) { c.moveTo(0, y); c.lineTo(PW, y); }
    c.stroke();
  } else if (k === 'grid') {
    const st = 5 * MM, ox = (PW % st) / 2, oy = (PH % st) / 2;
    c.beginPath();
    for (let x = ox; x <= PW; x += st) { c.moveTo(x, 0); c.lineTo(x, PH); }
    for (let y = oy; y <= PH; y += st) { c.moveTo(0, y); c.lineTo(PW, y); }
    c.globalAlpha = 0.7; c.stroke(); c.globalAlpha = 1;
  } else if (k === 'dot') {
    const st = 5 * MM, ox = (PW % st) / 2, oy = (PH % st) / 2;
    for (let x = ox; x <= PW; x += st) for (let y = oy; y <= PH; y += st) c.fillRect(x - 1.1, y - 1.1, 2.2, 2.2);
  }
}
function paintPage(c, page, book, skip, clip) {     // c は「1単位＝ページの1単位」に変換済み
  darkPaper = book.paperColor === 'dark';
  paintPaper(c, book);
  for (const pass of ['hl', 'pen']) for (const s of page.strokes) {
    if (s.t !== pass || (skip && skip.has(s))) continue;
    if (clip) { const b = bb(s); if (b[2] < clip[0] || b[0] > clip[2] || b[3] < clip[1] || b[1] > clip[3]) continue; }
    drawStroke(c, s);
  }
}
function pageCanvas(page, book, scale) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(PW * scale); cv.height = Math.round(PH * scale);
  const c = cv.getContext('2d');
  c.scale(cv.width / PW, cv.height / PH);
  paintPage(c, page, book);
  return cv;
}

/* ---------- ノート一覧 ---------- */
const lib = $('#lib'), ed = $('#ed'), grid = $('#grid');
async function showLibrary() {
  ed.hidden = true; lib.hidden = false;
  const books = (await getBooks()).sort((a, b) => b.updated - a.updated);
  $('#empty').hidden = books.length > 0;
  grid.innerHTML = '';
  for (const b of books) {
    const el = document.createElement('div'); el.className = 'card';
    const d = new Date(b.updated);
    el.innerHTML = `<div class="cover">${b.thumb ? `<img alt="" src="${b.thumb}">` : ''}<div class="band"></div><div class="spine"></div></div>
      <div class="name"></div><div class="meta">${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}・${b.pageIds.length}ページ</div>
      <button class="more" title="名前の変更・削除">⋯</button>`;
    $('.name', el).textContent = b.title;
    $('.spine', el).style.background = $('.band', el).style.background = b.cover;
    if (!b.thumb) $('.cover', el).style.background = (PAPERS[b.paperColor] || PAPERS.white).bg;
    $('.cover', el).onclick = () => openBook(b.id);
    $('.more', el).onclick = (e) => { e.stopPropagation(); cardMenu(el, b); };
    grid.append(el);
  }
}
function cardMenu(el, b) {
  $$('.cardmenu').forEach((m) => m.remove());
  const m = document.createElement('div'); m.className = 'pop cardmenu';
  m.innerHTML = '<button data-a="ren">名前を変える</button><button data-a="del" class="danger">削除する</button>';
  m.onclick = async (e) => {
    const a = e.target.dataset.a; m.remove();
    if (a === 'ren') bookDialog(b);
    if (a === 'del' && confirm(`「${b.title}」を削除します。元に戻せません。よろしいですか。`)) {
      const pages = await getPages(b.id);
      await tx(['books', 'pages'], 'readwrite', (t) => { t.objectStore('books').delete(b.id); pages.forEach((p) => t.objectStore('pages').delete(p.id)); });
      showLibrary();
    }
  };
  el.append(m);
  setTimeout(() => document.addEventListener('pointerdown', function h(e) { if (!m.contains(e.target)) m.remove(); document.removeEventListener('pointerdown', h); }), 0);
}
let dlgCover = COVERS[0];
function bookDialog(book) {                           // book があれば名前の変更、なければ新規
  const d = $('#dNew');
  $('#dNewTitle').textContent = book ? '名前を変える' : '新しいノート';
  $('#dNewOk').textContent = book ? '変える' : '作る';
  $('#dNewOpts').hidden = !!book;
  $('#fTitle').value = book ? book.title : '';
  dlgCover = COVERS[Math.floor(Math.random() * COVERS.length)];
  const cv = $('#fCover'); cv.innerHTML = '';
  COVERS.forEach((c) => {
    const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.className = c === dlgCover ? 'on' : '';
    b.onclick = () => { dlgCover = c; $$('button', cv).forEach((x) => x.classList.toggle('on', x === b)); };
    cv.append(b);
  });
  d.returnValue = '';
  d.onclose = async () => {
    if (d.returnValue !== 'ok') return;
    const title = $('#fTitle').value.trim() || '無題のノート';
    if (book) { book.title = title; await tx('books', 'readwrite', (t) => t.objectStore('books').put(book)); showLibrary(); return; }
    const page = { id: uid(), bookId: uid(), strokes: [] };
    const nb = { id: page.bookId, title, cover: dlgCover, paper: $('#fPaper').value, paperColor: $('#fPColor').value, pageIds: [page.id], created: Date.now(), updated: Date.now(), last: 0 };
    await tx(['books', 'pages'], 'readwrite', (t) => { t.objectStore('books').put(nb); t.objectStore('pages').put(page); });
    openBook(nb.id);
  };
  d.showModal();
}
$('#bNew').onclick = () => bookDialog();

/* バックアップ */
$('#bBackup').onclick = () => $('#dBackup').showModal();
$('#bExport').onclick = async () => {
  const books = await getBooks(), pages = await rq(db.transaction('pages').objectStore('pages').getAll());
  const d = new Date(), name = `notes-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  saveBlob(new Blob([JSON.stringify({ app: 'notes-app', v: 1, books, pages })], { type: 'application/json' }), name);
};
$('#bImport').onclick = () => $('#fImport').click();
$('#fImport').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'notes-app' || !Array.isArray(j.books)) throw 0;
    const have = new Set((await getBooks()).map((b) => b.id));
    let n = 0;
    await tx(['books', 'pages'], 'readwrite', (t) => {
      for (const b of j.books) {                      // 同じノートが既にあれば、別のノートとして足す（上書きしない）
        const map = new Map(), dup = have.has(b.id), id = dup ? uid() : b.id;
        const ps = j.pages.filter((p) => p.bookId === b.id);
        ps.forEach((p) => { const nid = dup ? uid() : p.id; map.set(p.id, nid); t.objectStore('pages').put({ ...p, id: nid, bookId: id }); });
        t.objectStore('books').put({ ...b, id, title: dup ? b.title + '（読み込み）' : b.title, pageIds: b.pageIds.map((x) => map.get(x)).filter(Boolean) });
        n++;
      }
    });
    $('#dBackup').close(); alert(`${n}冊のノートを読み込みました。`); showLibrary();
  } catch (_) { alert('このファイルは読み込めませんでした。このアプリで書き出したバックアップのファイルを選んでください。'); }
};
async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer:coarse)').matches) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ---------- 編集画面 ---------- */
const stage = $('#stage'), view = $('#view'), live = $('#live');
const vctx = view.getContext('2d'), lctx = live.getContext('2d');
let dpr = 1, vw = 0, vh = 0;
const E = { book: null, pages: [], scale: 1, tx: 0, ty: 0, sel: null, undo: [], redo: [] };
const caches = new Map();                             // ページの下絵（id → {cv, cs}）
const dirty = new Set();
let G = null;                                         // 進行中の操作
const touches = new Map();
let lastPen = 0;                                      // ペンが最後に動いた時刻（直後のタッチは手のひらとみなす）
let saveTimer = 0, settleTimer = 0, rafDraw = 0, inertia = 0, eraserPos = null;

const pageY = (i) => i * (PH + GAP);
const fitScale = () => Math.max(0.1, (vw - 2 * M) / PW);
const capScale = Math.sqrt(MAXPX / (PW * PH));
function curPage() { return clamp(Math.floor(((vh * 0.4 - E.ty) / E.scale + GAP / 2) / (PH + GAP)), 0, E.pages.length - 1); }

async function openBook(id) {
  const book = await rq(db.transaction('books').objectStore('books').get(id));
  const ps = new Map((await getPages(id)).map((p) => [p.id, p]));
  E.book = book; E.pages = book.pageIds.map((x) => ps.get(x)).filter(Boolean);
  if (!E.pages.length) { const p = { id: uid(), bookId: id, strokes: [] }; E.pages.push(p); book.pageIds = [p.id]; dirty.add(p.id); }
  E.undo = []; E.redo = []; E.sel = null; caches.clear(); G = null; touches.clear();
  lib.hidden = true; ed.hidden = false; $('#pages').hidden = true; $('#menu').hidden = true;
  resize();
  E.scale = Math.min(fitScale(), 1.6);
  E.ty = M - pageY(clamp(book.last || 0, 0, E.pages.length - 1)) * E.scale;
  clampView(); syncBar(); draw(true);
}
async function closeBook() {
  commitSel();
  E.book.last = curPage();
  try { E.book.thumb = pageCanvas(E.pages[0], E.book, 0.3).toDataURL('image/jpeg', 0.8); } catch (_) {}
  dirty.add('book'); await flush();
  E.book = null; caches.clear();
  showLibrary();
}
$('#bBack').onclick = closeBook;

function markDirty(page) { dirty.add(page.id); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); }
async function flush() {
  clearTimeout(saveTimer);
  if (!E.book || !dirty.size) return;
  const ids = [...dirty]; dirty.clear();
  E.book.updated = Date.now(); E.book.pageIds = E.pages.map((p) => p.id);
  try {
    await tx(['books', 'pages'], 'readwrite', (t) => {
      t.objectStore('books').put(E.book);
      for (const p of E.pages) if (ids.includes(p.id)) t.objectStore('pages').put(p);
    });
  } catch (e) { ids.forEach((i) => dirty.add(i)); toast('保存に失敗しました。端末の空き容量を確認してください。'); }
}
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

function resize() {
  if (ed.hidden) return;
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  vw = stage.clientWidth; vh = stage.clientHeight;
  for (const cv of [view, live]) { cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr); }
  clampView(); draw(true);
}
addEventListener('resize', resize);

function clampView() {
  const f = fitScale();
  E.scale = clamp(E.scale, f * 0.4, Math.max(f * 8, 4));
  const s = E.scale, w = PW * s, h = (pageY(E.pages.length) - GAP) * s;
  E.tx = w <= vw - 2 * M ? (vw - w) / 2 : clamp(E.tx, vw - w - M, M);
  E.ty = h <= vh - 2 * M ? M : clamp(E.ty, vh - h - M - 90, M);
}
function visibleRange() {
  const s = E.scale;
  return [clamp(Math.floor((-E.ty / s) / (PH + GAP)), 0, E.pages.length - 1), clamp(Math.floor(((vh - E.ty) / s) / (PH + GAP)), 0, E.pages.length - 1)];
}
function getCache(page, want) {
  let c = caches.get(page.id);
  if (!c || (want && Math.abs(c.cs - want) / want > 0.1)) {
    const cs = want || Math.min(E.scale * dpr, capScale);
    const cv = (c && c.cv) || document.createElement('canvas');
    cv.width = Math.round(PW * cs); cv.height = Math.round(PH * cs);
    const x = cv.getContext('2d');
    x.setTransform(cv.width / PW, 0, 0, cv.height / PH, 0, 0);
    paintPage(x, page, E.book, E.sel && E.sel.set);
    c = { cv, cs }; caches.set(page.id, c);
  }
  return c;
}
/* 画面を描く。sharp＝止まっているとき。拡大中で下絵が粗くなる倍率では、線をじかに描いてくっきりさせる */
function draw(sharp) {
  if (!E.book) return;
  const c = vctx, s = E.scale, [a, b] = visibleRange();
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#d9dce2'; c.fillRect(0, 0, vw, vh);
  const want = Math.min(s * dpr, capScale);
  for (let i = a; i <= b; i++) {
    const page = E.pages[i], x = E.tx, y = E.ty + pageY(i) * s;
    c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(x + 1, y + 2, PW * s + 1, PH * s + 2);
    if (sharp && s * dpr > capScale * 1.02) {
      c.save(); c.beginPath(); c.rect(x, y, PW * s, PH * s); c.clip();
      c.translate(x, y); c.scale(s, s);
      paintPage(c, page, E.book, E.sel && E.sel.set, [-x / s, -y / s, (vw - x) / s, (vh - y) / s]);
      c.restore();
    } else {
      c.drawImage(getCache(page, sharp ? want : 0).cv, x, y, PW * s, PH * s);
    }
  }
  if (sharp) for (const id of [...caches.keys()]) {    // 見えていないページの下絵は捨てる
    const i = E.pages.findIndex((p) => p.id === id);
    if (i < a - 1 || i > b + 1) caches.delete(id);
  }
  $('#bPages').textContent = `${curPage() + 1} / ${E.pages.length}`;
  drawLive();
}
function viewChanged() { draw(false); clearTimeout(settleTimer); settleTimer = setTimeout(() => draw(true), 170); }
function redraw() { if (!rafDraw) rafDraw = requestAnimationFrame(() => { rafDraw = 0; draw(true); }); }
function invalidate(page) { caches.delete(page.id); redraw(); }

function liveToPage(i) { const s = E.scale; lctx.setTransform(s * dpr, 0, 0, s * dpr, E.tx * dpr, (E.ty + pageY(i) * s) * dpr); }
function drawLive() {
  const c = lctx, s = E.scale;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, live.width, live.height);
  if (G && G.mode === 'draw') { liveToPage(G.pi); darkPaper = E.book.paperColor === 'dark'; drawStroke(c, G.stroke); }
  if (G && G.mode === 'lasso') {
    liveToPage(G.pi); c.setLineDash([6 / s, 5 / s]); c.lineWidth = 1.6 / s; c.strokeStyle = '#2463eb';
    c.beginPath(); c.moveTo(G.path[0], G.path[1]);
    for (let i = 2; i < G.path.length; i += 2) c.lineTo(G.path[i], G.path[i + 1]);
    c.stroke(); c.setLineDash([]);
  }
  const L = E.sel;
  if (L) {
    liveToPage(L.pi); c.translate(L.dx, L.dy);
    darkPaper = E.book.paperColor === 'dark';
    for (const pass of ['hl', 'pen']) for (const st of E.pages[L.pi].strokes) if (st.t === pass && L.set.has(st)) drawStroke(c, st);
    const b = L.box;
    c.setLineDash([6 / s, 5 / s]); c.lineWidth = 1.6 / s; c.strokeStyle = '#2463eb'; c.fillStyle = 'rgba(36,99,235,.06)';
    c.beginPath(); c.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); c.fill(); c.stroke(); c.setLineDash([]);
  }
  if (eraserPos) {
    liveToPage(eraserPos.pi); c.lineWidth = 1.2 / s; c.strokeStyle = '#555'; c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.arc(eraserPos.x, eraserPos.y, S.eraser.w, 0, 7); c.fill(); c.stroke();
  }
}

/* ---------- 取り消し・やり直し ---------- */
function pushOp(page, before) {
  E.undo.push({ id: page.id, before, after: page.strokes.slice() });
  if (E.undo.length > 120) E.undo.shift();
  E.redo = []; markDirty(page); syncBar();
}
function stepHistory(from, to, key) {
  commitSel();
  const op = from.pop(); if (!op) return;
  const page = E.pages.find((p) => p.id === op.id);
  if (page) { page.strokes = op[key].slice(); markDirty(page); invalidate(page); }
  to.push(op); syncBar();
}
$('#bUndo').onclick = () => stepHistory(E.undo, E.redo, 'before');
$('#bRedo').onclick = () => stepHistory(E.redo, E.undo, 'after');
addEventListener('keydown', (e) => {
  if (ed.hidden || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault(); e.shiftKey ? $('#bRedo').click() : $('#bUndo').click();
});

/* ---------- 入力（ペン・指・マウス） ---------- */
function toPage(e, pi) {
  const r = stage.getBoundingClientRect();
  const wx = (e.clientX - r.left - E.tx) / E.scale, wy = (e.clientY - r.top - E.ty) / E.scale;
  if (pi == null) pi = clamp(Math.floor((wy + GAP / 2) / (PH + GAP)), 0, E.pages.length - 1);
  return { pi, x: wx, y: wy - pageY(pi) };
}
stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  closePops();
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  cancelAnimationFrame(inertia);
  if (e.pointerType === 'pen' && !S.penSeen) {        // ペンを初めて使ったら、指は「動かす・拡大」専用にする
    S.penSeen = true; S.input = 'pen'; saveSettings(); syncBar();
    toast('ペンを検出しました。指は、動かす・拡大の専用にします（メニューの「入力」で変えられます）。');
  }
  if (e.pointerType === 'pen') lastPen = performance.now();
  if (e.pointerType === 'touch') {
    if (G && G.kind === 'tool' && G.ptype !== 'touch') return;          // ペンで書いている間の手のひらは無視
    if (S.input !== 'finger' && performance.now() - lastPen < 300) return;  // ペンを離した直後のタッチは手のひら
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1 && S.input === 'finger' && !G) { startTool(e); return; }
    if (S.input === 'penonly' && touches.size < 2) return;              // ペンだけのモード：1本指は無視
    if (G && G.kind === 'tool') cancelTool();                           // 2本目の指が来たら、書くのをやめて拡大へ
    G = { kind: 'nav', vx: 0, vy: 0, t: performance.now() };
    return;
  }
  if (G && G.kind === 'nav') G = null;                                  // 手のひらで始まった移動は、ペンが来たらやめる
  if (G) return;
  startTool(e);
});
stage.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'pen') lastPen = performance.now();
  if (e.pointerType === 'touch' && touches.has(e.pointerId) && !(G && G.kind === 'tool')) {
    const t = touches.get(e.pointerId), all = [...touches.values()];
    if (G && G.kind === 'nav') {
      if (all.length === 1 && S.input === 'penonly') { /* 1本指では動かさない */ }
      else if (all.length === 1) {
        const dx = e.clientX - t.x, dy = e.clientY - t.y, now = performance.now(), dt = Math.max(1, now - G.t);
        E.tx += dx; E.ty += dy;
        G.vx = G.vx * 0.5 + (dx / dt) * 0.5; G.vy = G.vy * 0.5 + (dy / dt) * 0.5; G.t = now;
      } else {
        const [p, q] = all, d0 = Math.hypot(p.x - q.x, p.y - q.y), cx0 = (p.x + q.x) / 2, cy0 = (p.y + q.y) / 2;
        t.x = e.clientX; t.y = e.clientY;
        const d1 = Math.hypot(p.x - q.x, p.y - q.y), cx1 = (p.x + q.x) / 2, cy1 = (p.y + q.y) / 2;
        const r = stage.getBoundingClientRect();
        zoomAt(cx0 - r.left, cy0 - r.top, d0 > 0 ? d1 / d0 : 1);
        E.tx += cx1 - cx0; E.ty += cy1 - cy0;
        G.vx = G.vy = 0;
      }
      clampView(); viewChanged();
    }
    t.x = e.clientX; t.y = e.clientY;
    return;
  }
  if (!G || G.kind !== 'tool' || e.pointerId !== G.id) return;
  const evs = (G.mode === 'draw' && e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  for (const ev of evs.length ? evs : [e]) moveTool(ev);
  if (!G.raf) G.raf = requestAnimationFrame(() => { if (G) G.raf = 0; toolFrame(); });
});
const onUp = (e) => {
  if (e.pointerType === 'pen') lastPen = performance.now();
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId);
    if (G && G.kind === 'nav') {
      if (touches.size === 0) { const g = G; G = null; if (performance.now() - g.t < 60) fling(g.vx, g.vy); }
      else { G.vx = G.vy = 0; }
      return;
    }
  }
  if (G && G.kind === 'tool' && e.pointerId === G.id) e.type === 'pointercancel' ? cancelTool() : endTool(e);
};
stage.addEventListener('pointerup', onUp);
stage.addEventListener('pointercancel', onUp);
stage.addEventListener('wheel', (e) => {
  e.preventDefault(); cancelAnimationFrame(inertia);
  if (e.ctrlKey || e.metaKey) { const r = stage.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01)); }
  else { E.tx -= e.deltaX; E.ty -= e.deltaY; }
  clampView(); viewChanged();
}, { passive: false });
stage.addEventListener('contextmenu', (e) => e.preventDefault());
for (const t of ['gesturestart', 'gesturechange', 'dblclick', 'selectstart']) document.addEventListener(t, (e) => { if (!ed.hidden) e.preventDefault(); });

function zoomAt(sx, sy, k) {
  const f = fitScale(), ns = clamp(E.scale * k, f * 0.4, Math.max(f * 8, 4));
  k = ns / E.scale;
  E.tx = sx - (sx - E.tx) * k; E.ty = sy - (sy - E.ty) * k; E.scale = ns;
}
function fling(vx, vy) {
  if (Math.hypot(vx, vy) < 0.15) return;
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(40, now - last); last = now;
    E.tx += vx * dt; E.ty += vy * dt;
    const k = Math.pow(0.996, dt); vx *= k; vy *= k;
    const ty = E.ty; clampView();
    viewChanged();
    if (Math.hypot(vx, vy) > 0.03 && Math.abs(ty - E.ty) < 0.5) inertia = requestAnimationFrame(step);
  };
  inertia = requestAnimationFrame(step);
}

/* 道具の操作 */
function startTool(e) {
  const tool = S.tool, p = toPage(e);
  G = { kind: 'tool', id: e.pointerId, ptype: e.pointerType, pi: p.pi, t0: performance.now() };
  const pr = e.pointerType === 'pen' ? clamp(e.pressure || 0.1, 0.02, 1) : 0.5;
  if (tool === 'lasso') {
    const L = E.sel;
    if (L && L.pi === p.pi && p.x >= L.box[0] + L.dx - 12 && p.x <= L.box[2] + L.dx + 12 && p.y >= L.box[1] + L.dy - 12 && p.y <= L.box[3] + L.dy + 12) {
      G.mode = 'drag'; G.sx = p.x - L.dx; G.sy = p.y - L.dy;
    } else { commitSel(); G.mode = 'lasso'; G.path = [p.x, p.y]; }
    return;
  }
  commitSel();
  if (tool === 'eraser') { G.mode = 'erase'; G.before = null; G.lx = p.x; G.ly = p.y; eraseAt(p.x, p.y, p.x, p.y); eraserPos = p; redrawLive(); return; }
  G.mode = 'draw'; G.pr = pr;
  G.stroke = { t: tool, c: S[tool].c, w: S[tool].w, p: [p.x, p.y, pr] };
  G.hx = e.clientX; G.hy = e.clientY; armHold();
  redrawLive();
}
function moveTool(e) {
  const p = toPage(e, G.pi);
  if (G.mode === 'draw') {
    if (Math.hypot(e.clientX - G.hx, e.clientY - G.hy) > 4) { G.hx = e.clientX; G.hy = e.clientY; armHold(); }
    if (G.line) { setLine(p.x, p.y); return; }
    const a = G.stroke.p, n = a.length;
    if (Math.hypot(p.x - a[n - 3], p.y - a[n - 2]) < 0.6 / Math.max(1, E.scale)) return;
    if (G.ptype === 'pen') G.pr = G.pr * 0.55 + clamp(e.pressure || 0, 0.02, 1) * 0.45;
    a.push(p.x, p.y, G.pr);
  } else if (G.mode === 'erase') {
    eraseAt(G.lx, G.ly, p.x, p.y); G.lx = p.x; G.ly = p.y; eraserPos = p;
  } else if (G.mode === 'lasso') {
    G.path.push(p.x, p.y);
  } else if (G.mode === 'drag') {
    E.sel.dx = p.x - G.sx; E.sel.dy = p.y - G.sy; E.sel.moved = true;
  }
}
function toolFrame() {
  if (!G) return;
  if (G.mode === 'erase' && G.changed) { G.changed = false; caches.delete(E.pages[G.pi].id); draw(true); }
  else drawLive();
}
function redrawLive() { requestAnimationFrame(drawLive); }
function endTool() {
  const g = G; G = null; clearTimeout(g.hold); cancelAnimationFrame(g.raf);
  const page = E.pages[g.pi];
  if (g.mode === 'draw') {
    const s = g.stroke;
    for (let i = 0; i < s.p.length; i += 3) { s.p[i] = Math.round(s.p[i] * 10) / 10; s.p[i + 1] = Math.round(s.p[i + 1] * 10) / 10; s.p[i + 2] = Math.round(s.p[i + 2] * 100) / 100; }
    const before = page.strokes.slice();
    page.strokes.push(s); pushOp(page, before);
    const c = caches.get(page.id);
    if (c && s.t === 'pen') {                          // ペンの線は下絵に描き足すだけ（速い）
      const x = c.cv.getContext('2d'); x.setTransform(c.cv.width / PW, 0, 0, c.cv.height / PH, 0, 0); drawStroke(x, s);
    } else caches.delete(page.id);
    draw(true);
  } else if (g.mode === 'erase') {
    eraserPos = null;
    if (g.before) pushOp(page, g.before);
    caches.delete(page.id); draw(true);
  } else if (g.mode === 'lasso') {
    selectIn(g.pi, g.path);
  } else if (g.mode === 'drag') {
    drawLive();
  }
}
function cancelTool() {
  const g = G; G = null; if (!g) return;
  clearTimeout(g.hold); cancelAnimationFrame(g.raf); eraserPos = null;
  if (g.mode === 'erase' && g.before) { E.pages[g.pi].strokes = g.before; caches.delete(E.pages[g.pi].id); }
  draw(true);
}

/* ペンを止めたまま待つと、まっすぐな線に直す */
function armHold() {
  clearTimeout(G.hold);
  const g = G;
  g.hold = setTimeout(() => {
    if (G !== g || g.mode !== 'draw' || g.line) return;
    const p = g.stroke.p, n = p.length / 3;
    if (n < 4) return;
    const x0 = p[0], y0 = p[1], x1 = p[n * 3 - 3], y1 = p[n * 3 - 2], L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 40) return;
    let dev = 0;
    for (let i = 1; i < n - 1; i++) dev = Math.max(dev, Math.abs((p[i * 3] - x0) * (y1 - y0) - (p[i * 3 + 1] - y0) * (x1 - x0)) / L);
    if (dev > 0.12 * L) return;
    g.line = [x0, y0]; setLine(x1, y1); drawLive();
  }, 550);
}
function setLine(x, y) {
  const [x0, y0] = G.line, n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / 6)), a = [];
  for (let i = 0; i <= n; i++) a.push(x0 + (x - x0) * i / n, y0 + (y - y0) * i / n, 0.5);
  G.stroke.p = a;
}

/* 消しゴム：部分（触れた所だけ）と、線ごと */
function eraseAt(ax, ay, bx, by) {
  const page = E.pages[G.pi], r = S.eraser.w, out = [];
  const x0 = Math.min(ax, bx) - r, x1 = Math.max(ax, bx) + r, y0 = Math.min(ay, by) - r, y1 = Math.max(ay, by) + r;
  const vx = bx - ax, vy = by - ay, vv = vx * vx + vy * vy;
  let changed = false;
  for (const s of page.strokes) {
    const b = bb(s);
    if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) { out.push(s); continue; }
    const d = dense(s), R = r + (s.t === 'hl' ? s.w / 2 : s.w * 0.5), R2 = R * R;
    const hit = (i) => {
      const px = d[i] - ax, py = d[i + 1] - ay, t = vv ? clamp((px * vx + py * vy) / vv, 0, 1) : 0;
      const qx = px - vx * t, qy = py - vy * t;
      return qx * qx + qy * qy <= R2;
    };
    let any = false, run = [];
    const runs = [];
    for (let i = 0; i < d.length; i += 3) {
      if (hit(i)) { any = true; if (S.eraseWhole) break; if (run.length >= 6) runs.push(run); run = []; }
      else run.push(d[i], d[i + 1], d[i + 2]);
    }
    if (!any) { out.push(s); continue; }
    changed = true;
    if (!S.eraseWhole) { if (run.length >= 6) runs.push(run); for (const p of runs) out.push({ t: s.t, c: s.c, w: s.w, p }); }
  }
  if (changed) { if (!G.before) G.before = page.strokes; page.strokes = out; G.changed = true; }
}

/* 投げ縄 */
function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) {
    if ((P[i + 1] > y) !== (P[j + 1] > y) && x < (P[j] - P[i]) * (y - P[i + 1]) / (P[j + 1] - P[i + 1]) + P[i]) c = !c;
  }
  return c;
}
function selBox(set) {
  const b = [1e9, 1e9, -1e9, -1e9];
  for (const s of set) { const q = bb(s); b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); }
  return [b[0] - 6, b[1] - 6, b[2] + 6, b[3] + 6];
}
function selectIn(pi, path) {
  const page = E.pages[pi], set = new Set();
  if (path.length >= 8) for (const s of page.strokes) {
    let inN = 0; const n = s.p.length / 3;
    for (let i = 0; i < s.p.length; i += 3) if (inPoly(s.p[i], s.p[i + 1], path)) inN++;
    if (inN / n >= 0.6) set.add(s);
  }
  if (set.size) setSel(pi, set); else drawLive();
}
function setSel(pi, set) {
  E.sel = { pi, set, box: selBox(set), dx: 0, dy: 0, moved: false };
  $('#selbar').hidden = false; caches.delete(E.pages[pi].id); draw(true);
}
function replaceSel(fn) {                             // 選んだ線を、作り直した線に入れ替える（取り消しできる）
  const L = E.sel, page = E.pages[L.pi], before = page.strokes.slice(), ns = new Set();
  page.strokes = page.strokes.map((s) => { if (!L.set.has(s)) return s; const n = fn(s); ns.add(n); return n; });
  L.set = ns; L.box = selBox(ns); L.dx = L.dy = 0; L.moved = false;
  pushOp(page, before);
}
function commitSel() {
  const L = E.sel; if (!L) return;
  if (L.moved && (L.dx || L.dy)) { const dx = L.dx, dy = L.dy; replaceSel((s) => ({ ...s, p: s.p.map((v, i) => (i % 3 === 0 ? Math.round((v + dx) * 10) / 10 : i % 3 === 1 ? Math.round((v + dy) * 10) / 10 : v)) })); }
  E.sel = null; $('#selbar').hidden = true; caches.delete(E.pages[L.pi].id); draw(true);
}
$('#bSelDone').onclick = commitSel;
$('#bSelDel').onclick = () => {
  const L = E.sel; if (!L) return;
  const page = E.pages[L.pi], before = page.strokes.slice();
  page.strokes = page.strokes.filter((s) => !L.set.has(s)); pushOp(page, before);
  E.sel = null; $('#selbar').hidden = true; invalidate(page);
};
$('#bSelDup').onclick = () => {
  const L = E.sel; if (!L) return;
  const pi = L.pi; commitSel();
  const page = E.pages[pi], before = page.strokes.slice(), ns = new Set();
  for (const s of L.set) { const n = { ...s, p: s.p.map((v, i) => (i % 3 === 2 ? v : v + 24)) }; ns.add(n); page.strokes.push(n); }
  pushOp(page, before); setSel(pi, ns);
};

/* ---------- ツールバー ---------- */
function syncBar() {
  const t = S.tool;
  $$('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  const wd = $('#widths'); wd.innerHTML = '';
  (WIDTHS[t] || []).forEach((w, i) => {
    const b = document.createElement('button'); b.className = S[t].w === w ? 'on' : ''; b.title = '太さ';
    const d = [6, 11, 17][i]; b.innerHTML = `<span class="wdot" style="width:${d}px;height:${d}px"></span>`;
    b.onclick = () => { S[t].w = w; saveSettings(); syncBar(); };
    wd.append(b);
  });
  wd.hidden = !(WIDTHS[t] || []).length;
  const col = $('#colors'); col.innerHTML = '';
  const ct = t === 'hl' ? 'hl' : 'pen';                // 消しゴム・投げ縄のときは、ペンの色を出す
  let list = ct === 'hl' ? HL_COLORS : PEN_COLORS;
  if (ct === 'pen' && E.book && E.book.paperColor === 'dark') list = ['#f2f2f2', ...list.slice(1)];
  const pick = (c) => {
    if (E.sel) { replaceSel((s) => ({ ...s, c })); draw(true); }
    S[ct].c = c; if (t !== 'hl' && t !== 'pen') S.tool = 'pen';
    if (E.sel) S.tool = 'lasso';
    saveSettings(); syncBar();
  };
  list.forEach((c) => {
    const b = document.createElement('button'); b.className = S[ct].c === c ? 'on' : ''; b.title = '色';
    b.innerHTML = `<span class="sw" style="background:${c}"></span>`;
    b.onclick = () => pick(c); col.append(b);
  });
  const lb = document.createElement('label'); lb.title = '好きな色';
  lb.innerHTML = `<span class="sw"></span><input type="color" value="${/^#[0-9a-f]{6}$/i.test(S[ct].c) ? S[ct].c : '#000000'}">`;
  $('input', lb).onchange = (e) => pick(e.target.value); col.append(lb);
  const em = $('#bEraseMode'); em.hidden = t !== 'eraser'; em.textContent = S.eraseWhole ? '線ごと消す' : '部分を消す';
  $('#bUndo').disabled = !E.undo.length; $('#bRedo').disabled = !E.redo.length;
  $$('#mInput button').forEach((b) => b.classList.toggle('on', b.dataset.in === S.input));
  $('#mInputNote').textContent = { finger: '指でも書けます。2本指で移動・拡大。', pen: 'ペンで書き、指は移動・拡大だけ。', penonly: 'ペンだけ反応。1本指は無視、2本指で移動・拡大。' }[S.input];
  if (E.book) {
    $$('#mPaper button').forEach((b) => b.classList.toggle('on', b.dataset.paper === E.book.paper));
    $$('#mColor button').forEach((b) => b.classList.toggle('on', b.dataset.pc === E.book.paperColor));
  }
}
$('#tools').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tool !== 'lasso') commitSel();
  S.tool = b.dataset.tool; saveSettings(); syncBar();
};
$('#bEraseMode').onclick = () => { S.eraseWhole = !S.eraseWhole; saveSettings(); syncBar(); };
function closePops() { $('#menu').hidden = true; }
$('#bMenu').onclick = () => { $('#menu').hidden = !$('#menu').hidden; $('#pages').hidden = true; };
$('#mInput').onclick = (e) => { if (!e.target.dataset.in) return; S.input = e.target.dataset.in; S.penSeen = true; touches.clear(); saveSettings(); syncBar(); };
const setPaper = (k, v) => { E.book[k] = v; dirty.add('book'); markDirty(E.pages[0]); caches.clear(); syncBar(); draw(true); };
$('#mPaper').onclick = (e) => { if (e.target.dataset.paper) setPaper('paper', e.target.dataset.paper); };
$('#mColor').onclick = (e) => { if (e.target.dataset.pc) setPaper('paperColor', e.target.dataset.pc); };
$('#mClear').onclick = () => {
  closePops(); commitSel();
  const page = E.pages[curPage()]; if (!page.strokes.length) return;
  const before = page.strokes.slice(); page.strokes = []; pushOp(page, before); invalidate(page);
  toast('白紙に戻しました。「取り消し」で元に戻せます。');
};
let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }

/* ---------- ページ ---------- */
function jumpTo(i) { E.ty = M - pageY(i) * E.scale; clampView(); draw(true); }
function addPage(at) {
  commitSel();
  const p = { id: uid(), bookId: E.book.id, strokes: [] };
  E.pages.splice(at, 0, p); markDirty(p); jumpTo(at);
  if (!$('#pages').hidden) renderPages();
}
$('#bAddPage').onclick = () => addPage(curPage() + 1);
$('#bPages').onclick = () => { const p = $('#pages'); p.hidden = !p.hidden; closePops(); if (!p.hidden) renderPages(); };
$('#bPagesClose').onclick = () => ($('#pages').hidden = true);
function renderPages() {
  const list = $('#plist'), cur = curPage(); list.innerHTML = '';
  E.pages.forEach((p, i) => {
    const el = document.createElement('div'); el.className = 'pt' + (i === cur ? ' cur' : '');
    const cv = pageCanvas(p, E.book, 0.2);
    cv.onclick = () => { jumpTo(i); renderPages(); };
    el.append(cv, document.createTextNode(String(i + 1)));
    if (E.pages.length > 1) {
      const d = document.createElement('button'); d.className = 'del'; d.textContent = '×'; d.title = 'このページを削除';
      d.onclick = async () => {
        if (!confirm(`${i + 1}ページ目を削除します。元に戻せません。よろしいですか。`)) return;
        commitSel(); E.pages.splice(i, 1); caches.delete(p.id);
        E.undo = E.undo.filter((o) => o.id !== p.id); E.redo = E.redo.filter((o) => o.id !== p.id);
        dirty.add('book'); await flush();
        await tx('pages', 'readwrite', (t) => t.objectStore('pages').delete(p.id));
        clampView(); draw(true); syncBar(); renderPages();
      };
      el.append(d);
    }
    list.append(el);
  });
  list.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
}

/* ---------- 書き出し ---------- */
const toBlob = (cv, type, q) => new Promise((r) => cv.toBlob(r, type, q));
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'note';
$('#mPng').onclick = async () => {
  closePops(); commitSel();
  const i = curPage();
  saveBlob(await toBlob(pageCanvas(E.pages[i], E.book, 2), 'image/png'), `${safeName(E.book.title)}-${i + 1}.png`);
};
$('#mPdf').onclick = async () => {
  closePops(); commitSel(); toast('PDF を作っています…');
  await new Promise((r) => setTimeout(r, 30));
  const enc = new TextEncoder(), parts = [], xref = [];
  let off = 0;
  const put = (d) => { if (typeof d === 'string') d = enc.encode(d); parts.push(d); off += d.length; };
  const obj = (n, ...body) => { xref[n] = off; put(`${n} 0 obj\n`); body.forEach(put); put('\nendobj\n'); };
  const W = 595.28, H = 841.89, n = E.pages.length;
  put('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${E.pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  for (let i = 0; i < n; i++) {
    const cv = pageCanvas(E.pages[i], E.book, 1.8);
    const jpg = new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.88)).arrayBuffer());
    const a = 3 + i * 3, cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(a, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${a + 2} 0 R >> >> /Contents ${a + 1} 0 R >>`);
    obj(a + 1, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
    obj(a + 2, `<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream');
  }
  const start = off, cnt = 3 + n * 3;
  put(`xref\n0 ${cnt}\n0000000000 65535 f \n`);
  for (let i = 1; i < cnt; i++) put(String(xref[i]).padStart(10, '0') + ' 00000 n \n');
  put(`trailer\n<< /Size ${cnt} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  saveBlob(new Blob(parts, { type: 'application/pdf' }), `${safeName(E.book.title)}.pdf`);
};

/* ---------- 起動 ---------- */
(async () => {
  db = await openDB();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  syncBar(); showLibrary();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.__notes = { E, S, caches };
