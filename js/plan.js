/* 3D planner. Scene units = world blocks: scene X/Z are the in-game X/Z, ground top at y = 0. */
(async function () {
  const { $, sgn, fmt, esc, uid } = App;
  await App.load();
  App.mountTop('plan');
  const W = () => App.world, P = () => App.world.plan;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const MATS = { 1: '#8b8f8e', 2: '#dcdedb', 3: '#f3ede4', 4: '#e0782b', 5: '#bdbdc1', 6: '#3c68c9', 7: '#a9d9cf', 8: '#e9b85a', 9: '#e6edf0', 10: '#e9ebec' };
  const SW = ['#e07b2a', '#c0392b', '#d4ac0d', '#27ae60', '#16a085', '#2e86c1', '#7d3c98', '#d35490', '#6e2c00', '#5d6d7e'];
  const key = (cx, cz) => cx + ',' + cz;
  const sel = new Set();
  let baseHidden = false; try { baseHidden = localStorage.getItem('mcmap.baseHidden') === '1'; } catch (e) { }

  if (!window.THREE) { $('stage').innerHTML = '<div class="banner"><h3>3D не загрузился</h3><p class="note">Не удалось загрузить three.js. Проверь интернет и обнови страницу.</p></div>'; return; }

  /* ---------- scene ---------- */
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 6000); camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.78));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(0.6, 1, 0.35); scene.add(sun);
  const sun2 = new THREE.DirectionalLight(0xffffff, 0.18); sun2.position.set(-0.5, 0.4, -0.8); scene.add(sun2);
  const cam = { x: 0, y: 120, z: 200, yaw: 0, pitch: -0.5 };
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color();

  function draw() {
    camera.position.set(cam.x, cam.y, cam.z); camera.rotation.set(cam.pitch, cam.yaw, 0);
    scene.background = new THREE.Color(css('--stage') || '#dbe1e5');
    renderer.render(scene, camera);
    $('camPos').textContent = `Камера: X ${sgn(Math.floor(cam.x))} · Y ${Math.floor(cam.y)} · Z ${sgn(Math.floor(cam.z))}`;
  }
  let drawQueued = false; const redraw = () => { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; draw(); }); };
  function resize() { const r = $('stage').getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); redraw(); }
  new ResizeObserver(resize).observe($('stage'));

  /* ---------- ground: one thin box per chunk ---------- */
  let ground = null, lines = null, selLines = null, volume = null; const labels = [];
  const taskOf = new Map();          // "cx,cz" -> task
  function indexTasks() { taskOf.clear(); for (const t of P().tasks) for (const [cx, cz] of t.chunks) taskOf.set(key(cx, cz), t); }
  function buildGround() {
    const pl = P().platform, n = pl.size;
    if (ground) { scene.remove(ground); ground.geometry.dispose(); }
    ground = new THREE.InstancedMesh(new THREE.BoxGeometry(16, 0.4, 16), new THREE.MeshLambertMaterial({ color: 0xffffff }), n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { tmpM.makeTranslation((pl.cx0 + i) * 16 + 8, -0.2, (pl.cz0 + j) * 16 + 8); ground.setMatrixAt(i * n + j, tmpM); }
    ground.setColorAt(0, tmpC.set('#ffffff')); scene.add(ground);
    if (lines) { scene.remove(lines); lines.geometry.dispose(); }
    const pts = [], x0 = pl.cx0 * 16, z0 = pl.cz0 * 16, L = n * 16;
    for (let i = 0; i <= n; i++) { pts.push(x0 + i * 16, 0.03, z0, x0 + i * 16, 0.03, z0 + L, x0, 0.03, z0 + i * 16, x0 + L, 0.03, z0 + i * 16); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x555b60, transparent: true, opacity: .55 })); scene.add(lines);
    colorGround();
  }
  function colorGround() {
    indexTasks();
    const pl = P().platform, n = pl.size, a = new THREE.Color(css('--panel') || '#f7f8f9'), b = new THREE.Color(css('--line') || '#cfd5d9'), acc = new THREE.Color(css('--accent') || '#e07b2a');
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const cx = pl.cx0 + i, cz = pl.cz0 + j, t = taskOf.get(key(cx, cz));
      if (t) tmpC.set(t.color); else tmpC.copy(((cx + cz) & 1) ? b : a);
      if (sel.has(key(cx, cz))) tmpC.lerp(acc, t ? .35 : .55);
      ground.setColorAt(i * n + j, tmpC);
    }
    ground.instanceColor.needsUpdate = true;
    // selection outline
    if (selLines) { scene.remove(selLines); selLines.geometry.dispose(); selLines = null; }
    if (sel.size) {
      const pts = [], y = 0.08;
      for (const k of sel) { const [cx, cz] = k.split(',').map(Number), x = cx * 16, z = cz * 16;
        if (!sel.has(key(cx, cz - 1))) pts.push(x, y, z, x + 16, y, z);
        if (!sel.has(key(cx, cz + 1))) pts.push(x, y, z + 16, x + 16, y, z + 16);
        if (!sel.has(key(cx - 1, cz))) pts.push(x, y, z, x, y, z + 16);
        if (!sel.has(key(cx + 1, cz))) pts.push(x + 16, y, z, x + 16, y, z + 16); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      selLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: acc, depthTest: false })); selLines.renderOrder = 5; scene.add(selLines);
    }
    buildVolume(); buildLabels(); redraw();
  }
  function buildVolume() {
    if (volume) { scene.remove(volume); volume.geometry.dispose(); volume = null; }
    if (!$('volume').checked) return;
    const list = []; for (const t of P().tasks) for (const c of t.chunks) list.push([c[0], c[1], t.color]);
    if (!list.length) return;
    volume = new THREE.InstancedMesh(new THREE.BoxGeometry(15.6, 8, 15.6), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: .28, depthWrite: false }), list.length);
    list.forEach(([cx, cz, col], i) => { tmpM.makeTranslation(cx * 16 + 8, 4, cz * 16 + 8); volume.setMatrixAt(i, tmpM); volume.setColorAt(i, tmpC.set(col)); });
    volume.renderOrder = 2; scene.add(volume);
  }
  function buildLabels() {
    for (const s of labels) { scene.remove(s); s.material.map.dispose(); s.material.dispose(); } labels.length = 0;
    for (const t of P().tasks) {
      if (!t.chunks.length) continue;
      let sx = 0, sz = 0; for (const [cx, cz] of t.chunks) { sx += cx * 16 + 8; sz += cz * 16 + 8; }
      const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 40;
      g.font = `600 ${fs}px "IBM Plex Sans", system-ui, sans-serif`; const w = Math.ceil(g.measureText(t.name).width) + 40;
      c.width = w; c.height = fs + 26; g.font = `600 ${fs}px "IBM Plex Sans", system-ui, sans-serif`;
      g.fillStyle = 'rgba(20,22,24,.78)'; roundRect(g, 0, 0, w, c.height, 14); g.fill();
      g.fillStyle = t.color; g.fillRect(14, 14, 8, c.height - 28);
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(t.name, 30, c.height / 2 + 1);
      const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, transparent: true }));
      const h = 0.045; sp.scale.set(h * w / c.height, h, 1);
      sp.position.set(sx / t.chunks.length, 10, sz / t.chunks.length); sp.renderOrder = 10; scene.add(sp); labels.push(sp);
    }
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  /* ---------- base ---------- */
  let base = { L: null, scale: null, edKey: '', mesh: null };
  function baseOrigin() { const b = P().base; return { ox: b.cx * 16 + 8, oz: b.cz * 16 + 8 }; }
  function ensureBase(cb) {
    const b = P().base, edKey = b.scale + ':' + JSON.stringify(b.edits || []).length + ':' + (b.edits || []).length;
    if (!b.placed) { if (base.mesh) base.mesh.visible = false; cb && cb(); return; }
    if (base.L && base.scale === b.scale && base.edKey === edKey) { placeBase(); cb && cb(); return; }
    $('busy').hidden = false;
    setTimeout(() => {
      const L = generateLotus(b.scale);
      for (const e of b.edits || []) if (Array.isArray(e) && e.length === 4) L.set(e[0] | 0, e[1] | 0, e[2] | 0, e[3] | 0);
      base.L = L; base.scale = b.scale; base.edKey = edKey;
      buildBaseMesh(); placeBase(); $('busy').hidden = true; cb && cb();
    }, 30);
  }
  function buildBaseMesh() {
    const L = base.L, N = L.N, list = [];
    const occ = (x, y, z) => L.get(x, y, z) > 0;
    for (let y = 0; y < L.H; y++) for (let z = -N; z <= N; z++) for (let x = -N; x <= N; x++) {
      const m = L.get(x, y, z); if (!m) continue;
      if (occ(x + 1, y, z) && occ(x - 1, y, z) && occ(x, y + 1, z) && occ(x, y - 1, z) && occ(x, y, z + 1) && occ(x, y, z - 1)) continue;
      list.push(x, y, z, m);
    }
    if (base.mesh) { scene.remove(base.mesh); base.mesh.dispose && base.mesh.dispose(); }
    const n = list.length / 4;
    base.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, n));
    for (let i = 0; i < n; i++) { tmpM.makeTranslation(list[4 * i] + .5, list[4 * i + 1] + .5, list[4 * i + 2] + .5); base.mesh.setMatrixAt(i, tmpM); base.mesh.setColorAt(i, tmpC.set(MATS[list[4 * i + 3]] || '#dddddd')); }
    base.mesh.count = n; scene.add(base.mesh);
  }
  function placeBase() {
    if (!base.mesh) return; const b = P().base, { ox, oz } = baseOrigin();
    base.mesh.position.set(ox, 0, oz); base.mesh.visible = b.placed && !baseHidden; renderBaseInfo(); redraw();
  }
  function renderBaseInfo() {
    const b = P().base, pl = P().platform, N = App.BASE_N[String(b.scale)] || 73, { ox, oz } = baseOrigin();
    const c0x = App.chunkOf(ox - N), c1x = App.chunkOf(ox + N), c0z = App.chunkOf(oz - N), c1z = App.chunkOf(oz + N);
    const out = c0x < pl.cx0 || c0z < pl.cz0 || c1x > pl.cx0 + pl.size - 1 || c1z > pl.cz0 + pl.size - 1;
    $('baseInfo').innerHTML = b.placed
      ? `Центр: X ${sgn(ox)} · Z ${sgn(oz)}<br>чанк ${sgn(b.cx)}, ${sgn(b.cz)}, внутри 8, 8<br>занимает чанки X ${sgn(c0x)}…${sgn(c1x)}, Z ${sgn(c0z)}…${sgn(c1z)}${out ? '<br><b style="color:var(--danger)">Выходит за платформу</b>' : ''}`
      : 'База не стоит на платформе.';
    const ne = (b.edits || []).length; $('editsInfo').textContent = ne ? `Твои правки применены: ${fmt(ne)}.` : 'Правок нет: стоит исходная модель.';
  }

  /* ---------- camera control: drag to look, WASD to fly, click to pick ---------- */
  const look = (dx, dy) => { cam.yaw -= dx * 0.0026; cam.pitch = Math.min(1.5707, Math.max(-1.5707, cam.pitch - dy * 0.0026)); redraw(); };
  function move(f, r, u, along) {
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    cam.x += -sy * f + cy * r; cam.z += -cy * f - sy * r; cam.y += u;
    if (along) { const cp = Math.cos(cam.pitch); cam.x += -sy * cp * along; cam.z += -cy * cp * along; cam.y += Math.sin(cam.pitch) * along; }
    cam.y = Math.max(0.6, cam.y); redraw();
  }
  let drag = null; const touches = new Map(); let pinch = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') { touches.set(e.pointerId, [e.clientX, e.clientY]); if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } }
    canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, id: e.pointerId, t: Date.now(), moved: false, shift: e.shiftKey || e.ctrlKey || e.metaKey }; canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) { touches.set(e.pointerId, [e.clientX, e.clientY]); if (pinch != null && touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); move(0, 0, 0, (d - pinch) * .5); pinch = d; if (drag) drag.moved = true; return; } }
    if (!drag || drag.id !== e.pointerId) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) drag.moved = true;
    if (drag.moved) look(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY;
  });
  const up = e => {
    touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null; canvas.style.cursor = 'grab';
    if (!d.moved && Date.now() - d.t < 600 && e.button !== 2) pickAt(e.clientX, e.clientY, d.shift);
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', e => { touches.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); move(0, 0, 0, -e.deltaY * 0.12); }, { passive: false });

  const keys = new Set(); let kbRaf = 0, kbLast = 0;
  const KB = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  canvas.addEventListener('keydown', e => {
    if (e.key === 'Escape') { sel.clear(); colorGround(); renderSel(); return; }
    if (!KB.includes(e.code)) return; e.preventDefault(); keys.add(e.code);
    if (!kbRaf) { kbLast = performance.now(); kbRaf = requestAnimationFrame(tick); }
  });
  document.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', () => keys.clear()); canvas.addEventListener('blur', () => keys.clear());
  function tick(now) {
    const dt = Math.min(.05, (now - kbLast) / 1000); kbLast = now; const k = c => keys.has(c);
    const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyQ', 'KeyE', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].some(k);
    if (!moving) { kbRaf = 0; return; }
    const sp = (k('ShiftLeft') || k('ShiftRight') ? 90 : 28) * dt;
    move(((k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0)) * sp, ((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0)) * sp, ((k('Space') || k('KeyE') ? 1 : 0) - (k('KeyC') || k('KeyQ') ? 1 : 0)) * sp, 0);
    cam.yaw += ((k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0)) * 1.8 * dt;
    cam.pitch = Math.min(1.5707, Math.max(-1.5707, cam.pitch + ((k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0)) * 1.4 * dt));
    redraw(); kbRaf = requestAnimationFrame(tick);
  }

  /* picking: walk the ray through base voxels, fall back to the ground plane */
  function pickAt(clientX, clientY, add) {
    const r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
    const v = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
    const o = camera.position.clone(), d = v.sub(o).normalize();
    let hit = null;
    if (base.L && P().base.placed && !baseHidden) {
      const { ox, oz } = baseOrigin(); const L = base.L;
      let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
      const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1, tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
      let tx = (d.x > 0 ? (x + 1 - o.x) : (o.x - x)) * tdx, ty = (d.y > 0 ? (y + 1 - o.y) : (o.y - y)) * tdy, tz = (d.z > 0 ? (z + 1 - o.z) : (o.z - z)) * tdz;
      for (let i = 0; i < 3000; i++) {
        if (L.get(x - ox, y, z - oz)) { hit = { x, z }; break; }
        if (tx < ty && tx < tz) { x += sx; tx += tdx; } else if (ty < tz) { y += sy; ty += tdy; } else { z += sz; tz += tdz; }
        if (y < -1 || Math.min(tx, ty, tz) > 2500) break;
      }
    }
    if (!hit && d.y < -1e-4) { const t = -o.y / d.y; hit = { x: Math.floor(o.x + d.x * t), z: Math.floor(o.z + d.z * t) }; }
    if (!hit) return;
    const cx = App.chunkOf(hit.x), cz = App.chunkOf(hit.z), pl = P().platform;
    if (cx < pl.cx0 || cz < pl.cz0 || cx >= pl.cx0 + pl.size || cz >= pl.cz0 + pl.size) { if (!add) { sel.clear(); colorGround(); renderSel(); } return; }
    const k = key(cx, cz);
    if (add) { sel.has(k) ? sel.delete(k) : sel.add(k); } else { const only = sel.size === 1 && sel.has(k); sel.clear(); if (!only) sel.add(k); }
    colorGround(); renderSel();
  }

  /* ---------- selection & tasks UI ---------- */
  let pickColor = SW[0];
  $('swatches').innerHTML = SW.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Цвет ${c}"></button>`).join('');
  $('swatches').onclick = e => { const c = e.target.dataset.c; if (c) { pickColor = c; $('taskColor').value = c; syncSw(); } };
  $('taskColor').oninput = e => { pickColor = e.target.value; syncSw(); };
  const syncSw = () => $('swatches').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === pickColor.toLowerCase())));
  function selChunks() { return [...sel].map(k => k.split(',').map(Number)); }
  function renderSel() {
    const cs = selChunks();
    $('selCount').textContent = cs.length ? `${cs.length}` : '';
    $('selEdit').hidden = !cs.length;
    if (!cs.length) { $('selInfo').textContent = 'Кликни по чанку на платформе. Shift+клик добавляет ещё чанки.'; return; }
    const xs = cs.map(c => c[0]), zs = cs.map(c => c[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    $('selInfo').innerHTML = cs.length === 1
      ? `Чанк <b class="mono">${sgn(x0)}, ${sgn(z0)}</b>: блоки X <span class="mono">${sgn(x0 * 16)}…${sgn(x0 * 16 + 15)}</span>, Z <span class="mono">${sgn(z0 * 16)}…${sgn(z0 * 16 + 15)}</span>`
      : `${cs.length} чанков в области X <span class="mono">${sgn(x0 * 16)}…${sgn(x1 * 16 + 15)}</span>, Z <span class="mono">${sgn(z0 * 16)}…${sgn(z1 * 16 + 15)}</span>`;
    const ts = new Set(cs.map(c => taskOf.get(key(c[0], c[1])) || null));
    const same = ts.size === 1 ? [...ts][0] : null;
    $('taskPick').innerHTML = '<option value="">Новая задача</option>' + P().tasks.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    $('taskPick').value = same ? same.id : '';
    fillTaskFields();
    $('unassignBtn').hidden = ![...ts].some(Boolean);
  }
  function fillTaskFields() {
    const t = P().tasks.find(q => q.id === $('taskPick').value);
    $('taskName').value = t ? t.name : ''; $('taskNote').value = t ? (t.note || '') : '';
    pickColor = t ? t.color : SW[P().tasks.length % SW.length]; $('taskColor').value = pickColor; syncSw();
    $('newNameWrap').firstChild.textContent = t ? 'Название задачи' : 'Название новой задачи';
    $('assignBtn').textContent = t ? 'Сохранить и назначить' : 'Создать и назначить';
  }
  $('taskPick').onchange = fillTaskFields;
  function dropChunks(chunks) { const ks = new Set(chunks.map(c => key(c[0], c[1]))); for (const t of P().tasks) t.chunks = t.chunks.filter(c => !ks.has(key(c[0], c[1]))); }
  $('assignBtn').onclick = () => {
    const cs = selChunks(); if (!cs.length) return;
    const name = $('taskName').value.trim(); if (!name) { App.toast('Впиши название задачи'); $('taskName').focus(); return; }
    let t = P().tasks.find(q => q.id === $('taskPick').value);
    dropChunks(cs);
    if (!t) { t = { id: uid(), name, color: pickColor, note: '', chunks: [] }; P().tasks.push(t); }
    t.name = name; t.color = pickColor; t.note = $('taskNote').value.trim();
    t.chunks.push(...cs);
    P().tasks = P().tasks.filter(q => q.chunks.length);
    App.save('tasks'); colorGround(); renderSel(); renderTasks(); App.toast(`«${name}»: ${t.chunks.length} чанк.`);
  };
  $('unassignBtn').onclick = () => { dropChunks(selChunks()); P().tasks = P().tasks.filter(q => q.chunks.length); App.save('tasks'); colorGround(); renderSel(); renderTasks(); };
  $('clearSel').onclick = () => { sel.clear(); colorGround(); renderSel(); };
  function renderTasks() {
    const ts = P().tasks; $('taskCount').textContent = ts.length ? String(ts.length) : '';
    $('taskList').innerHTML = ts.length ? ts.map(t => `<div class="item" data-id="${t.id}" role="button" tabindex="0"><span style="width:18px;height:18px;border-radius:5px;background:${t.color}"></span><span class="t">${esc(t.name)}</span><span class="c">${t.chunks.length} чанк. ${t.note ? '· ' + esc(t.note.slice(0, 40)) : ''}</span><span class="r"><button class="btn sm danger" data-del="${t.id}">Удалить</button></span></div>`).join('')
      : '<div class="empty">Задач пока нет. Выбери чанки на платформе и назначь им задачу.</div>';
  }
  let delArm = { id: null, t: 0 };
  $('taskList').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); const id = del.dataset.del;
      if (delArm.id !== id || Date.now() - delArm.t > 3000) { delArm = { id, t: Date.now() }; del.textContent = 'Точно?'; return; }
      P().tasks = P().tasks.filter(t => t.id !== id); App.save('tasks'); colorGround(); renderSel(); renderTasks(); return; }
    const it = e.target.closest('.item'); if (!it) return;
    const t = P().tasks.find(q => q.id === it.dataset.id); if (!t) return;
    sel.clear(); for (const [cx, cz] of t.chunks) sel.add(key(cx, cz)); colorGround(); renderSel();
    let sx = 0, sz = 0; for (const [cx, cz] of t.chunks) { sx += cx * 16 + 8; sz += cz * 16 + 8; }
    topView(sx / t.chunks.length, sz / t.chunks.length, Math.max(80, Math.sqrt(t.chunks.length) * 60));
  });
  $('volume').onchange = () => { buildVolume(); redraw(); };

  /* ---------- base panel ---------- */
  $('baseScale').innerHTML = App.SCALES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  function renderBasePanel() { const b = P().base; $('basePlaced').checked = !!b.placed; $('baseHidden').checked = baseHidden; $('baseScale').value = String(b.scale); renderBaseInfo(); }
  $('basePlaced').onchange = e => { P().base.placed = e.target.checked; App.save('base'); ensureBase(placeBase); renderBaseInfo(); };
  $('baseHidden').onchange = e => { baseHidden = e.target.checked; try { localStorage.setItem('mcmap.baseHidden', baseHidden ? '1' : '0'); } catch (er) { } placeBase(); };
  $('baseScale').onchange = e => {
    const s = +e.target.value, b = P().base;
    if (b.edits && b.edits.length) App.toast('Правки сделаны для другого масштаба и могут лечь не туда. Вставь правки этого масштаба со страницы базы.', 6000);
    b.scale = s; App.save('base'); ensureBase(placeBase);
  };
  document.querySelectorAll('[data-move]').forEach(btn => btn.onclick = () => { const [dx, dz] = btn.dataset.move.split(',').map(Number); P().base.cx += dx; P().base.cz += dz; App.save('base'); placeBase(); });
  $('baseToSel').onclick = () => { const cs = selChunks(); if (cs.length !== 1) { App.toast('Выбери один чанк — туда встанет центр базы'); return; } P().base.cx = cs[0][0]; P().base.cz = cs[0][1]; P().base.placed = true; App.save('base'); renderBasePanel(); ensureBase(placeBase); };

  $('importBase').onclick = () => { $('importText').value = ''; $('importMsg').textContent = ''; $('importDlg').showModal(); $('importText').focus(); };
  $('importDlg').querySelector('[data-close]').onclick = () => $('importDlg').close();
  $('importOk').onclick = () => {
    let j; try { j = JSON.parse($('importText').value); } catch (e) { $('importMsg').textContent = 'Не получилось прочитать текст. Скопируй его целиком ещё раз.'; return; }
    if (!j || j.kind !== 'lotus-base' || !Array.isArray(j.edits)) { $('importMsg').textContent = 'Это не данные базы. Нужна кнопка «Скопировать для планировщика» на странице «Лотос Легиона».'; return; }
    const s = [0.55, 0.75, 1].includes(+j.scale) ? +j.scale : 1;
    P().base.scale = s; P().base.edits = j.edits.filter(e => Array.isArray(e) && e.length === 4 && e.every(Number.isFinite)); P().base.placed = true;
    App.save('base'); $('importDlg').close(); renderBasePanel(); ensureBase(placeBase); App.toast(`Правки применены: ${fmt(P().base.edits.length)} блоков`);
  };
  $('importClear').onclick = () => { P().base.edits = []; App.save('base'); $('importDlg').close(); ensureBase(placeBase); App.toast('Правки убраны, стоит исходная база'); };

  /* ---------- platform panel ---------- */
  function renderPlatform() { const pl = P().platform; $('plSize').value = pl.size; $('plCX').value = pl.cx0; $('plCZ').value = pl.cz0;
    $('plInfo').innerHTML = `${pl.size}×${pl.size} чанков = ${pl.size * 16}×${pl.size * 16} блоков<br>X ${sgn(pl.cx0 * 16)}…${sgn((pl.cx0 + pl.size) * 16 - 1)}, Z ${sgn(pl.cz0 * 16)}…${sgn((pl.cz0 + pl.size) * 16 - 1)}`; }
  $('plApply').onclick = () => { const pl = P().platform; pl.size = Math.min(48, Math.max(8, Math.round(+$('plSize').value || 16))); pl.cx0 = Math.round(+$('plCX').value || 0); pl.cz0 = Math.round(+$('plCZ').value || 0); App.save('platform'); refreshAll(); };
  $('plCenter').onclick = () => { const pl = P().platform, b = P().base; pl.cx0 = b.cx - Math.floor(pl.size / 2); pl.cz0 = b.cz - Math.floor(pl.size / 2); App.save('platform'); refreshAll(); };

  /* ---------- views ---------- */
  function topView(x, z, h) { const pl = P().platform; cam.x = x ?? (pl.cx0 + pl.size / 2) * 16; cam.z = z ?? (pl.cz0 + pl.size / 2) * 16; cam.y = h ?? pl.size * 16 * 0.95; cam.yaw = 0; cam.pitch = -1.5707; redraw(); }
  function overview() { const pl = P().platform, c = (pl.size * 16), mx = (pl.cx0 + pl.size / 2) * 16, mz = (pl.cz0 + pl.size / 2) * 16; cam.x = mx + c * .55; cam.z = mz + c * .75; cam.y = c * .5; const dx = mx - cam.x, dz = mz - cam.z, dy = 20 - cam.y; cam.yaw = Math.atan2(-dx, -dz); cam.pitch = Math.atan2(dy, Math.hypot(dx, dz)); redraw(); }
  $('topView').onclick = () => topView(); $('sideView').onclick = overview;
  $('toBase').onclick = () => { const { ox, oz } = baseOrigin(); cam.x = ox + 60; cam.z = oz + 150; cam.y = 50; const dx = ox - cam.x, dz = oz - cam.z, dy = 35 - cam.y; cam.yaw = Math.atan2(-dx, -dz); cam.pitch = Math.atan2(dy, Math.hypot(dx, dz)); redraw(); };
  $('fullBtn').onclick = () => { try { const p = document.fullscreenElement ? document.exitFullscreen() : $('stage').requestFullscreen(); p && p.catch && p.catch(() => App.toast('Полный экран здесь не поддерживается')); } catch (e) { App.toast('Полный экран здесь не поддерживается'); } };
  document.addEventListener('fullscreenchange', () => { $('fullBtn').textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'Во весь экран'; });

  function refreshAll() { sel.clear(); buildGround(); renderPlatform(); renderBasePanel(); renderSel(); renderTasks(); ensureBase(placeBase); }
  App.onChange(why => { if (why === 'import' || why === 'replace' || why === 'settings') refreshAll(); });
  const mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener && mq.addEventListener('change', () => colorGround());

  resize(); refreshAll(); overview();
})();
