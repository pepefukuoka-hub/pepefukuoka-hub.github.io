(function () {
  'use strict';
  const VER = 1;
  const $ = (id) => document.getElementById(id);
  const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const R = (a, b) => a + Math.random() * (b - a);
  const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const GOAL_FAR = 55;   // ここまで逃げたら、見えなくなる(m)

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('読み込み失敗: ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- 音(その場で作る。向きに合わせて、左右から聞こえる) ----------
  let actx = null;
  function tone(delay, f0, f1, dur, vol, pan, type) {
    if (!actx || actx.state !== 'running') return;
    const t0 = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = g;
    if (actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); out = p; }
    o.connect(g); out.connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  const SND = {
    ping(pan, vol) { tone(0, 1500, 1900, 0.07, 0.18 * vol, pan); tone(0.1, 1900, 2300, 0.07, 0.18 * vol, pan); },   // ピッピッ(いるよ)
    alert(pan, vol) { tone(0, 2200, 1100, 0.28, 0.35 * vol, pan); tone(0.02, 1100, 550, 0.28, 0.2 * vol, pan, 'sawtooth'); },   // ピーッ!(見つかった)
    whirr(pan, vol) { tone(0, 180, 900, 0.5, 0.2 * vol, pan, 'sawtooth'); },   // ウィーン(走り出す)
    step(pan, vol) { tone(0, 140, 60, 0.06, 0.3 * vol, pan, 'triangle'); },   // ドタ(足音)
    pop(pan, vol) { tone(0, 300, 1200, 0.12, 0.25 * vol, pan, 'triangle'); },   // ポン(あらわれた)
  };
  window.addEventListener('pointerup', () => { if (actx && actx.state !== 'running') actx.resume().catch(() => {}); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && actx) actx.resume().catch(() => {}); });

  // ---------- 部品 ----------
  function registerComponents() {
    // 端末の向きでカメラを回す(位置は使わない)。向きが取れないとき(パソコン)は、ドラッグで見回す
    AFRAME.registerComponent('robo-look', {
      init: function () {
        this.ori = null; this.count = 0; this.yaw = 0; this.pitch = 0;
        this.euler = new THREE.Euler(); this.q0 = new THREE.Quaternion();
        this.q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); this.zee = new THREE.Vector3(0, 0, 1);
        window.addEventListener('deviceorientation', (e) => { if (e.alpha == null && e.beta == null) return; this.ori = e; this.count++; });
        let drag = null;
        window.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
        window.addEventListener('pointermove', (e) => {
          if (!drag || this.count > 5) return;
          this.yaw -= (e.clientX - drag.x) * 0.005; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - (e.clientY - drag.y) * 0.005));
          drag = { x: e.clientX, y: e.clientY };
        });
        window.addEventListener('pointerup', () => { drag = null; });
        const fov = () => {
          const a = window.innerWidth / window.innerHeight;
          this.el.setAttribute('camera', 'fov', a <= 0.75 ? 65 : 2 * Math.atan(Math.tan(34.5 * Math.PI / 180) / Math.max(a, 1.333)) * 180 / Math.PI);
        };
        fov(); window.addEventListener('resize', fov);
      },
      tick: function () {
        try {
          const o = this.el.object3D, d = this.ori, rad = THREE.MathUtils.degToRad;
          if (d) {
            const sa = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
            this.euler.set(d.beta ? rad(d.beta) : 0, rad(d.alpha || 0), d.gamma ? -rad(d.gamma) : 0, 'YXZ');
            o.quaternion.setFromEuler(this.euler); o.quaternion.multiply(this.q1); o.quaternion.multiply(this.q0.setFromAxisAngle(this.zee, -rad(sa)));
          } else { this.euler.set(this.pitch, this.yaw, 0, 'YXZ'); o.quaternion.setFromEuler(this.euler); }
        } catch (e) {}
      }
    });

    const MAT = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.5 : r, metalness: m == null ? 0.25 : m });
    const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x || 0, y || 0, z || 0); return m; };
    function dustTex() {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
    }
    function markTex() {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 92px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 64, 70);
      return new THREE.CanvasTexture(c);
    }
    const COLORS = [{ body: 0xe8eef3, accent: 0xff8a1f }, { body: 0x3b6fd8, accent: 0x7be8ff }, { body: 0xd9d9df, accent: 0x7dff6b }, { body: 0xb04a4a, accent: 0xffe14d }];

    function makeRobot(ci) {
      const col = COLORS[ci % COLORS.length], body = MAT(col.body, 0.45, 0.3), acc = MAT(col.accent, 0.4, 0.2), dark = MAT(0x232a33, 0.6, 0.4);
      const root = new THREE.Group(), g = new THREE.Group(); root.add(g);   // g: 向き・弾み・前かがみ
      const torso = box(0.52, 0.5, 0.32, body, 0, 0.7, 0); g.add(torso);
      g.add(box(0.3, 0.22, 0.02, dark, 0, 0.7, 0.165));
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.03), new THREE.MeshBasicMaterial({ color: col.accent })); lamp.position.set(0, 0.7, 0.18); g.add(lamp);
      g.add(box(0.58, 0.07, 0.36, acc, 0, 0.47, 0));   // 腰のベルト
      const head = new THREE.Group(); head.position.set(0, 1.08, 0); g.add(head);
      head.add(box(0.42, 0.32, 0.34, body, 0, 0, 0));
      head.add(box(0.34, 0.14, 0.02, dark, 0, 0.02, 0.175));
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x5ff3ff });
      const eyes = [-0.09, 0.09].map((x) => { const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.02), eyeMat); e.position.set(x, 0.02, 0.19); head.add(e); return e; });
      head.add(box(0.04, 0.14, 0.04, dark, 0, 0.23, 0));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff4d4d })); ball.position.set(0, 0.32, 0); head.add(ball);
      head.add(box(0.06, 0.16, 0.12, acc, -0.24, 0, 0), box(0.06, 0.16, 0.12, acc, 0.24, 0, 0));   // みみ
      const arm = (s) => { const pv = new THREE.Group(); pv.position.set(s * 0.36, 0.9, 0); pv.add(box(0.1, 0.42, 0.1, body, 0, -0.2, 0)); pv.add(box(0.12, 0.1, 0.12, acc, 0, -0.44, 0)); g.add(pv); return pv; };
      const armL = arm(-1), armR = arm(1);
      const leg = (s) => { const pv = new THREE.Group(); pv.position.set(s * 0.14, 0.44, 0); pv.add(box(0.14, 0.34, 0.16, dark, 0, -0.17, 0)); pv.add(box(0.18, 0.08, 0.26, acc, 0, -0.38, 0.04)); g.add(pv); return pv; };
      const legL = leg(-1), legR = leg(1);
      g.traverse((o) => { o.frustumCulled = false; });
      const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTex(), transparent: true, depthTest: false })); mark.scale.set(0.45, 0.45, 1); mark.position.set(0, 1.75, 0); mark.visible = false; mark.renderOrder = 5; root.add(mark);
      // 影
      const c = document.createElement('canvas'); c.width = c.height = 128; const g2 = c.getContext('2d'), gr = g2.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004; root.add(shadow);
      return { root, g, head, eyes, eyeMat, ball, armL, armR, legL, legR, mark, side: ci % 2 ? 1 : -1, state: 'gone', t: 0, timer: 0.3 + ci * 0.4, vis: 0, ph: 0, yaw: 0, dir: new THREE.Vector3(), speed: 0, ping: 1 + ci, puff: 0, stepK: 0, pop: 1 };
    }

    AFRAME.registerComponent('robots', {
      schema: { size: { default: 1 }, dist: { default: 3 }, n: { default: 2 } },
      init: function () {
        this.rs = []; for (let i = 0; i < this.data.n; i++) { const r = makeRobot(i); r.root.visible = false; r.root.scale.setScalar(this.data.size); this.el.object3D.add(r.root); this.rs.push(r); }
        this.cp = new THREE.Vector3(); this.f = new THREE.Vector3(); this.q = new THREE.Vector3(); this.phi = 0; this.found = 0; this.hudT = 0; this.started = false;
        this.dust = []; this.dtex = dustTex();
      },
      tick: function (time, dtms) { try { this.step(time, dtms); } catch (e) { if (!this.err) { this.err = 1; console.error(e); } } },
      puff: function (pos) {
        const m = new THREE.SpriteMaterial({ map: this.dtex, transparent: true, depthWrite: false, color: 0xcfc8b8, opacity: 0.5 });
        const s = new THREE.Sprite(m); s.position.copy(pos); s.position.y = 0.12; s.scale.setScalar(0.3); this.el.object3D.add(s); this.dust.push({ s, m, a: 0 });
      },
      place: function (r) {   // 左か右の、画面に入らないところに出す
        const phi = this.phi + r.side * (Math.PI / 2 + R(-0.3, 0.3)), d = this.data.dist * R(0.9, 1.3);
        r.root.position.set(this.cp.x + Math.sin(phi) * d, 0, this.cp.z - Math.cos(phi) * d);
        r.state = 'idle'; r.t = 0; r.vis = 0; r.speed = 0; r.root.visible = true; r.pop = 0; r.mark.visible = false; r.eyeMat.color.setHex(0x5ff3ff);
        r.yaw = Math.atan2(this.cp.x - r.root.position.x, this.cp.z - r.root.position.z);
        r.ping = R(1, 2.5);
      },
      pan: function (r) {   // この子の、いまの左右(-1〜1)と、音の大きさ
        const p = r.root.position, rel = wrap(Math.atan2(p.x - this.cp.x, -(p.z - this.cp.z)) - this.phi), d = Math.hypot(p.x - this.cp.x, p.z - this.cp.z);
        return { pan: Math.sin(rel), vol: Math.max(0.08, Math.min(1, 3.5 / (d + 1.5))) };
      },
      step: function (time, dtms) {
        const cam = this.el.sceneEl.camera; if (!cam) return;
        const dt = Math.min(dtms, 100) / 1000, t = time / 1000;
        cam.getWorldPosition(this.cp); cam.getWorldDirection(this.f);
        if (Math.hypot(this.f.x, this.f.z) > 0.4) this.phi = Math.atan2(this.f.x, -this.f.z);
        if (!this.started) {   // 向きが届くまで(最大2秒)待ってから置く
          if (this.t0 == null) this.t0 = time;
          const lk = this.el.sceneEl.querySelector('[robo-look]'), lc = lk && lk.components['robo-look'];
          if (!(lc && lc.count > 2) && time - this.t0 < 2000) return;
          this.started = true;
        }
        let seenNow = 0;
        this.rs.forEach((r) => {
          const pos = r.root.position, tt = t, dC = Math.hypot(pos.x - this.cp.x, pos.z - this.cp.z);
          if (r.state === 'gone') { r.timer -= dt; if (r.timer <= 0) { this.place(r); const k = this.pan(r); SND.pop(k.pan, k.vol); } return; }
          // 弾み・ゆれ
          let by = 0, lean = 0, sw = 0, armUp = 0;
          if (r.pop < 1) { r.pop = Math.min(1, r.pop + dt * 4); r.root.scale.setScalar(this.data.size * (0.2 + 0.8 * Math.sin(r.pop * Math.PI / 2 * 1.0) + 0.1 * Math.sin(r.pop * Math.PI))); }
          if (r.state === 'idle') {
            // まわりを見張る: 体はこちらを向いたまま、頭を左右にふる
            const face = Math.atan2(this.cp.x - pos.x, this.cp.z - pos.z);
            r.yaw += wrap(face + Math.sin(tt * 0.4 + r.side) * 0.9 - r.yaw) * Math.min(1, dt * 2);
            r.head.rotation.y = Math.sin(tt * 1.3 + r.side * 2) * 0.6; by = Math.sin(tt * 2 + r.side) * 0.012;
            armUp = Math.sin(tt * 1.7) * 0.15; r.ball.visible = Math.sin(tt * 6) > -0.3;
            r.ping -= dt; if (r.ping <= 0) { r.ping = R(1.6, 3.2); const k = this.pan(r); SND.ping(k.pan, k.vol); }
            // 画面に入っているか(ある程度の間、見ていたら、気づく)
            this.q.set(pos.x, 0.8 * this.data.size, pos.z).project(cam);
            const vis = this.q.z < 1 && Math.abs(this.q.x) < 0.85 && Math.abs(this.q.y) < 0.9 && dC < 14;
            if (vis) seenNow++;
            r.vis = vis ? r.vis + dt : Math.max(0, r.vis - dt);
            if (r.vis > 0.4) { r.state = 'alert'; r.t = 0; r.mark.visible = true; r.eyeMat.color.setHex(0xff3b30); this.found++; const k = this.pan(r); SND.alert(k.pan, k.vol); }
          } else if (r.state === 'alert') {   // 「!」と飛びはね → ダッシュ
            r.t += dt;
            r.yaw += wrap(Math.atan2(this.cp.x - pos.x, this.cp.z - pos.z) - r.yaw) * Math.min(1, dt * 12);
            by = 0.35 * Math.sin(Math.min(1, r.t / 0.5) * Math.PI); armUp = 1.6; r.head.rotation.y = 0;
            if (r.t > 0.55) {
              r.state = 'flee'; r.t = 0; r.mark.visible = false; r.speed = 0;
              let dx = pos.x - this.cp.x, dz = pos.z - this.cp.z; const l = Math.hypot(dx, dz) || 1, a = Math.atan2(dx, dz) + R(-0.35, 0.35);
              r.dir.set(Math.sin(a), 0, Math.cos(a)); const k = this.pan(r); SND.whirr(k.pan, k.vol);
            }
          } else if (r.state === 'flee') {   // 全速力で、遠くへ
            r.t += dt; r.speed = Math.min(11, r.speed + 40 * dt);
            pos.addScaledVector(r.dir, r.speed * dt);
            r.yaw += wrap(Math.atan2(r.dir.x, r.dir.z) - r.yaw) * Math.min(1, dt * 14);
            r.head.rotation.y = 0; r.ph += dt * (10 + r.speed * 2.2); sw = Math.sin(r.ph);
            lean = 0.45 * Math.min(1, r.speed / 8); by = Math.abs(Math.sin(r.ph)) * 0.1 * Math.min(1, r.speed / 6); armUp = 0;
            r.puff -= dt; if (r.puff <= 0) { r.puff = 0.05; this.puff(pos); }
            const sk = Math.floor(r.ph / Math.PI); if (sk !== r.stepK) { r.stepK = sk; const k = this.pan(r); SND.step(k.pan, k.vol); }
            if (dC > GOAL_FAR || r.t > 9) { r.state = 'gone'; r.root.visible = false; r.timer = R(2.5, 4.5); }
          }
          const g = r.g; g.position.y = by; g.rotation.y = r.yaw; g.rotation.x = lean;
          r.legL.rotation.x = sw * 0.9; r.legR.rotation.x = -sw * 0.9;
          r.armL.rotation.x = -sw * 1.0; r.armR.rotation.x = sw * 1.0;
          r.armL.rotation.z = r.state === 'flee' ? 0 : -armUp * 0.8; r.armR.rotation.z = r.state === 'flee' ? 0 : armUp * 0.8;
          r.mark.position.y = 1.75 + (r.state === 'alert' ? 0.1 * Math.sin(tt * 20) : 0);
          r.root.rotation.y = 0;
        });
        for (let i = this.dust.length - 1; i >= 0; i--) {
          const d = this.dust[i]; d.a += dt * 1.6;
          if (d.a >= 1) { this.el.object3D.remove(d.s); d.m.dispose(); this.dust.splice(i, 1); continue; }
          d.s.scale.setScalar(0.3 + d.a * 1.2); d.m.opacity = 0.5 * (1 - d.a); d.s.position.y += dt * 0.5;
        }
        if (time - this.hudT > 300) {
          this.hudT = time;
          const near = this.rs.some((r) => r.state === 'idle');
          $('find').textContent = 'みつけた ' + this.found + ' 回' + (near && !this.found ? ' ・ 左右を見回してね' : '');
        }
      }
    });
  }

  // ---------- 開始 ----------
  let started = false, stream = null;
  function fail(msg) { $('msg').textContent = '⚠ ' + msg; $('msg').style.color = '#ff6b6b'; $('go').disabled = false; }
  function step(t) { $('msg').style.color = ''; $('msg').textContent = '準備中 ' + t + ' …'; }
  const errName = (e) => (e && (e.name || e.message)) ? String(e.name || e.message) : '不明';
  async function start() {
    if (started) return;
    $('go').disabled = true;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { actx = null; }
    put('robo.size', $('size').value); put('robo.dist', $('dist').value); put('robo.eye', $('eye').value);
    step('1/3 モーションの許可');
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { fail('モーションと方向のアクセスが許可されていません。設定 > Safari > モーションと方向のアクセス をオンにして、ページを開き直してください。'); return; }
      }
    } catch (e) { fail('モーションの許可を取得できませんでした(' + errName(e) + ')。ページを開き直して、もう一度押してください。'); return; }
    step('2/3 カメラの許可');
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
    catch (e) { fail('カメラを開けませんでした(' + errName(e) + ')。設定 > Safari > カメラ で許可し、ページを開き直してください。'); return; }
    step('3/3 画面の準備');
    try { await loadScript('vendor/aframe.min.js'); registerComponents(); }
    catch (e) { fail('部品を読み込めませんでした(' + errName(e) + ')。通信を確認して、ページを開き直してください。'); return; }
    started = true;
    const v = $('cam'); v.srcObject = stream; document.body.classList.add('ar'); v.play().catch(() => {});
    const size = parseFloat($('size').value), dist = parseFloat($('dist').value), eye = parseFloat($('eye').value);
    const scene = document.createElement('a-scene');
    scene.setAttribute('vr-mode-ui', 'enabled: false'); scene.setAttribute('renderer', 'alpha: true; antialias: true'); scene.setAttribute('embedded', '');
    scene.innerHTML =
      '<a-entity camera="fov: 65; near: 0.05; far: 500" position="0 ' + eye + ' 0" robo-look></a-entity>' +
      '<a-entity light="type: ambient; color: #ffffff; intensity: 0.9"></a-entity>' +
      '<a-entity light="type: directional; color: #ffffff; intensity: 0.7" position="1 3 2"></a-entity>' +
      '<a-entity id="robots" robots="size: ' + size + '; dist: ' + dist + '; n: 2"></a-entity>';
    scene.addEventListener('loaded', () => { if (scene.renderer) scene.renderer.setClearColor(0x000000, 0); });
    $('host').appendChild(scene); $('hud').hidden = false;
  }
  $('go').onclick = start;
  $('exit').onclick = () => { location.reload(); };
  $('size').value = get('robo.size', '1'); $('dist').value = get('robo.dist', '3'); $('eye').value = get('robo.eye', '1.4');
  if (!$('size').value) $('size').value = '1'; if (!$('dist').value) $('dist').value = '3'; if (!$('eye').value) $('eye').value = '1.4';
})();
