/* 3D planner. Scene units = world blocks: scene X/Z are the in-game X/Z, ground top at y = 0. */
(async function () {
  const { $, sgn, fmt, esc, uid } = App;
  await App.init();
  await App.load();
  App.mountTop('plan');
  const CAN = App.can('plan');
  const showTab = App.tabs(document.querySelector('.side'), () => setTimeout(resize, 0));
  const deny = () => { App.toast(App.user ? 'План меняют модераторы. Ты можешь смотреть.' : 'Войди через Telegram. План меняют модераторы.', 4000); return true; };
  const W = () => App.world, P = () => App.world.plan;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const MATS = { 1: '#8b8f8e', 2: '#dcdedb', 3: '#f3ede4', 4: '#e0782b', 5: '#bdbdc1', 6: '#3c68c9', 7: '#a9d9cf', 8: '#e9b85a', 9: '#e6edf0', 10: '#e9ebec' };
  const SW = ['#e07b2a', '#c0392b', '#d4ac0d', '#27ae60', '#16a085', '#2e86c1', '#7d3c98', '#d35490', '#6e2c00', '#5d6d7e'];
  const key = (cx, cz) => cx + ',' + cz;
  const sel = new Set();

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
  let ground = null, lines = null, selLines = null, volume = null, taskLines = null; const labels = [];
  let rectMode = false, rect = null;
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
      if (t) tmpC.copy(((cx + cz) & 1) ? b : a).lerp(new THREE.Color(t.color), 0.42); else tmpC.copy(((cx + cz) & 1) ? b : a);
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
    buildTaskLines(); buildVolume(); buildLabels(); redraw();
  }
  // dashed outline around each task's area, in the task's colour (inner borders between its own chunks are skipped)
  function buildTaskLines() {
    if (taskLines) { scene.remove(taskLines); taskLines.geometry.dispose(); taskLines.material.dispose(); taskLines = null; }
    const dashes = [];   // [x, y, z, horizontal?, colour]
    const ys = $('volume').checked ? [0.2, 8.1] : [0.2];
    const D = 2.6, G = 1.4, I = 0.7;                      // dash, gap, inset from the chunk border
    for (const t of P().tasks) {
      const own = new Set(t.chunks.map(c => key(c[0], c[1])));
      const edge = (x0, z0, horiz, y) => { for (let s = 0.6; s + D <= 16; s += D + G) dashes.push(horiz ? [x0 + s + D / 2, y, z0, 1, t.color] : [x0, y, z0 + s + D / 2, 0, t.color]); };
      for (const y of ys) for (const [cx, cz] of t.chunks) {
        const x = cx * 16, z = cz * 16;
        if (!own.has(key(cx, cz - 1))) edge(x, z + I, 1, y);
        if (!own.has(key(cx, cz + 1))) edge(x, z + 16 - I, 1, y);
        if (!own.has(key(cx - 1, cz))) edge(x + I, z, 0, y);
        if (!own.has(key(cx + 1, cz))) edge(x + 16 - I, z, 0, y);
      }
    }
    if (!dashes.length) return;
    taskLines = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), dashes.length);
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    dashes.forEach(([x, y, z, h, col], i) => { ps.set(x, y, z); sc.set(h ? D : 0.75, 1, h ? 0.75 : D); tmpM.compose(ps, q, sc); taskLines.setMatrixAt(i, tmpM); taskLines.setColorAt(i, tmpC.set(col)); });
    taskLines.renderOrder = 4; scene.add(taskLines);
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

  /* ---------- structures placed on the platform ---------- */
  const defs = () => W().structdefs, insts = () => P().structures;
  const defOf = id => defs().find(d => d.id === id);
  const lotusCache = new Map();          // def id -> { key, L, n, mat, col }
  const meshes = new Map();              // instance id -> Object3D
  let selStruct = null, selBox = null;
  const lotusKey = d => d.scale + ':' + (d.edits || []).length + ':' + JSON.stringify((d.edits || []).slice(-3));
  function lotusData(def) {
    const k = lotusKey(def), c = lotusCache.get(def.id); if (c && c.key === k) return c;
    const L = generateLotus(def.scale);
    for (const e of def.edits || []) if (Array.isArray(e) && e.length === 4) L.set(e[0] | 0, e[1] | 0, e[2] | 0, e[3] | 0);
    const N = L.N, list = [], occ = (x, y, z) => L.get(x, y, z) > 0;
    for (let y = 0; y < L.H; y++) for (let z = -N; z <= N; z++) for (let x = -N; x <= N; x++) {
      const m = L.get(x, y, z); if (!m) continue;
      if (occ(x + 1, y, z) && occ(x - 1, y, z) && occ(x, y + 1, z) && occ(x, y - 1, z) && occ(x, y, z + 1) && occ(x, y, z - 1)) continue;
      list.push(x, y, z, m);
    }
    const n = list.length / 4, mat = new Float32Array(n * 16), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { tmpM.makeTranslation(list[4 * i] + .5, list[4 * i + 1] + .5, list[4 * i + 2] + .5); tmpM.toArray(mat, i * 16); tmpC.set(MATS[list[4 * i + 3]] || '#dddddd'); col.set([tmpC.r, tmpC.g, tmpC.b], i * 3); }
    const out = { key: k, L, n, mat, col }; lotusCache.set(def.id, out); return out;
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  function makeMesh(def, s) {
    if (def.kind === 'lotus') {
      const c = lotusData(def), m = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, c.n));
      m.instanceMatrix.array.set(c.mat); m.instanceMatrix.needsUpdate = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(c.col.slice(), 3); m.count = c.n; return m;
    }
    const g = new THREE.Group(), fp = App.footprint(def, s), w = fp.x1 - fp.x0, d = fp.z1 - fp.z0;
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(def.color), transparent: true, opacity: .55 }));
    body.scale.set(w - 0.4, def.h, d - 0.4); body.position.set(0, def.h / 2, 0); g.add(body);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w - 0.4, def.h, d - 0.4)), new THREE.LineBasicMaterial({ color: new THREE.Color(def.color) }));
    edges.position.set(0, def.h / 2, 0); g.add(edges); return g;
  }
  function disposeObj(o) { o.traverse(x => { if (x.geometry && x.geometry !== boxGeo) x.geometry.dispose(); if (x.material) x.material.dispose(); }); }
  function syncStructures() {
    const hidden = App.pref('plan.hidden', false), need = insts().filter(s => defOf(s.def));
    const wantLotus = need.some(s => { const d = defOf(s.def); return d.kind === 'lotus' && (!lotusCache.get(d.id) || lotusCache.get(d.id).key !== lotusKey(d)); });
    const go = () => {
      for (const [id, o] of meshes) { scene.remove(o); disposeObj(o); } meshes.clear();
      for (const s of need) {
        const def = defOf(s.def), o = makeMesh(def, s), fp = App.footprint(def, s);
        if (def.kind === 'lotus') { o.position.set(fp.ox, 0, fp.oz); o.rotation.y = -(s.rot || 0) * Math.PI / 2; } else o.position.set((fp.x0 + fp.x1) / 2, 0, (fp.z0 + fp.z1) / 2);
        o.visible = !hidden; o.userData.sid = s.id; scene.add(o); meshes.set(s.id, o);
      }
      drawSelBox(); renderStructs(); redraw();
    };
    if (wantLotus) { $('busy').hidden = false; setTimeout(() => { go(); $('busy').hidden = true; }, 30); } else go();
  }
  function drawSelBox() {
    if (selBox) { scene.remove(selBox); disposeObj(selBox); selBox = null; }
    const s = insts().find(q => q.id === selStruct), def = s && defOf(s.def); if (!def) return;
    const fp = App.footprint(def, s), h = def.kind === 'lotus' ? (lotusCache.get(def.id) || { L: { H: 80 } }).L.H : def.h;
    selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(fp.x1 - fp.x0, h + 1, fp.z1 - fp.z0)), new THREE.LineBasicMaterial({ color: new THREE.Color(css('--accent') || '#e07b2a'), depthTest: false }));
    selBox.position.set((fp.x0 + fp.x1) / 2, (h + 1) / 2, (fp.z0 + fp.z1) / 2); selBox.renderOrder = 6; scene.add(selBox);
  }
  // which structure covers a block column, and the solid test used for picking
  function solidAt(x, y, z) {
    for (const s of insts()) {
      const def = defOf(s.def); if (!def) continue; const fp = App.footprint(def, s);
      if (x < fp.x0 - 1 || x > fp.x1 || z < fp.z0 - 1 || z > fp.z1) continue;
      if (def.kind === 'lotus') {
        const c = lotusCache.get(def.id); if (!c) continue;
        const a = (s.rot || 0) * Math.PI / 2, wx = x + .5 - fp.ox, wz = z + .5 - fp.oz;
        const lx = Math.floor(wx * Math.cos(a) + wz * Math.sin(a) + 1e-6), lz = Math.floor(-wx * Math.sin(a) + wz * Math.cos(a) + 1e-6);
        if (c.L.get(lx, y, lz)) return s;
      } else if (x >= fp.x0 && x < fp.x1 && z >= fp.z0 && z < fp.z1 && y >= 0 && y < def.h) return s;
    }
    return null;
  }
  function structAtChunk(cx, cz) { for (const s of insts()) { const def = defOf(s.def); if (!def) continue; const fp = App.footprint(def, s); if (cx * 16 + 8 >= fp.x0 && cx * 16 + 8 < fp.x1 && cz * 16 + 8 >= fp.z0 && cz * 16 + 8 < fp.z1) return s; } return null; }

  /* structures panel */
  function renderStructs() {
    const list = insts(), pl = P().platform;
    $('structCount').textContent = list.length ? String(list.length) : '';
    $('defPick').innerHTML = defs().map(d => `<option value="${esc(d.id)}">${esc(d.name)} — ${d.kind === 'lotus' ? 'модель' : `${d.w}×${d.d} чанк., ${d.h} бл.`}</option>`).join('');
    $('placedList').innerHTML = list.length ? list.map(s => {
      const def = defOf(s.def); if (!def) return '';
      const fp = App.footprint(def, s), out = fp.x0 < pl.cx0 * 16 || fp.z0 < pl.cz0 * 16 || fp.x1 > (pl.cx0 + pl.size) * 16 || fp.z1 > (pl.cz0 + pl.size) * 16;
      return `<div class="item" data-sid="${esc(s.id)}" role="button" tabindex="0" ${s.id === selStruct ? 'style="background:var(--accent-soft)"' : ''}><span style="width:18px;height:18px;border-radius:5px;background:${esc(def.color)}"></span><span class="t">${esc(def.name)}</span><span class="c">чанк ${sgn(s.cx)}, ${sgn(s.cz)}${s.rot ? ' · поворот ' + s.rot * 90 + '°' : ''}${out ? ' · за краем платформы' : ''}</span></div>`;
    }).join('') : '<div class="empty">На платформе пока пусто. Выбери структуру выше и нажми «Поставить».</div>';
    const s = list.find(q => q.id === selStruct), def = s && defOf(s.def);
    $('structEdit').hidden = !s || !CAN; $('structEdit').style.display = $('structEdit').hidden ? 'none' : 'flex';
    if (s && def) { const fp = App.footprint(def, s); $('structInfo').innerHTML = `<b>${esc(def.name)}</b><br>центр X ${sgn(Math.floor(fp.ox))} · Z ${sgn(Math.floor(fp.oz))}<br>чанки X ${sgn(App.chunkOf(fp.x0))}…${sgn(App.chunkOf(fp.x1 - 1))}, Z ${sgn(App.chunkOf(fp.z0))}…${sgn(App.chunkOf(fp.z1 - 1))}`; }
    else $('structInfo').textContent = list.length ? 'Выбери структуру в списке, чтобы двигать её.' : '';
  }
  function selectStruct(id, fly) {
    selStruct = id; drawSelBox(); renderStructs(); showTab('structs');
    const s = insts().find(q => q.id === id), def = s && defOf(s.def);
    if (fly && def) { const fp = App.footprint(def, s), sz = Math.max(fp.x1 - fp.x0, fp.z1 - fp.z0); cam.x = fp.ox + sz * .5; cam.z = fp.oz + sz * 1.3; cam.y = sz * .6 + 10; const dx = fp.ox - cam.x, dz = fp.oz - cam.z, dy = 10 - cam.y; cam.yaw = Math.atan2(-dx, -dz); cam.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
    redraw();
  }
  $('placedList').addEventListener('click', e => { const it = e.target.closest('[data-sid]'); if (it) selectStruct(it.dataset.sid, true); });
  $('placeBtn').onclick = () => {
    if (!CAN && deny()) return;
    const def = defOf($('defPick').value); if (!def) return;
    const cs = selChunks(), pl = P().platform;
    let cx = cs.length === 1 ? cs[0][0] : pl.cx0 + Math.floor(pl.size / 2), cz = cs.length === 1 ? cs[0][1] : pl.cz0 + Math.floor(pl.size / 2);
    if (def.kind !== 'lotus' && cs.length !== 1) { cx -= Math.floor(def.w / 2); cz -= Math.floor(def.d / 2); }
    const s = { id: uid(), def: def.id, cx, cz, rot: 0 }; insts().push(s);
    App.save('structures'); syncStructures(); selectStruct(s.id, true);
    App.toast(`«${def.name}» поставлена. Двигай стрелками в этой вкладке.`);
  };
  document.querySelectorAll('[data-smove]').forEach(btn => btn.onclick = () => {
    if (!CAN && deny()) return; const s = insts().find(q => q.id === selStruct); if (!s) return;
    const [dx, dz] = btn.dataset.smove.split(',').map(Number); s.cx += dx; s.cz += dz; App.save('structures'); syncStructures();
  });
  $('structRot').onclick = () => { if (!CAN && deny()) return; const s = insts().find(q => q.id === selStruct); if (!s) return; s.rot = ((s.rot || 0) + 1) % 4; App.save('structures'); syncStructures(); };
  $('structToSel').onclick = () => {
    if (!CAN && deny()) return; const s = insts().find(q => q.id === selStruct); const cs = selChunks();
    if (!s) return; if (cs.length !== 1) { App.toast('Выбери на платформе один чанк — туда встанет структура'); return; }
    s.cx = cs[0][0]; s.cz = cs[0][1]; App.save('structures'); syncStructures();
  };
  let sDelArm = 0;
  $('structDel').onclick = () => {
    if (!CAN && deny()) return;
    if (Date.now() - sDelArm > 3000) { sDelArm = Date.now(); $('structDel').textContent = 'Точно убрать?'; return; }
    P().structures = insts().filter(q => q.id !== selStruct); selStruct = null; $('structDel').textContent = 'Убрать с платформы';
    App.save('structures'); syncStructures();
  };
  $('structHidden').checked = App.pref('plan.hidden', false);
  $('structHidden').onchange = e => { App.setPref('plan.hidden', e.target.checked); for (const o of meshes.values()) o.visible = !e.target.checked; redraw(); };

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
    canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, id: e.pointerId, t: Date.now(), moved: false, shift: e.shiftKey || e.ctrlKey || e.metaKey }; canvas.style.cursor = rectMode ? 'crosshair' : 'grabbing';
    if (rectMode && e.button === 0 && e.pointerType !== 'touch' || rectMode && e.pointerType === 'touch' && touches.size === 1) { const c = chunkAt(e.clientX, e.clientY); if (c) rect = { a: c, keep: drag.shift ? new Set(sel) : new Set() }; }
  });
  canvas.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) { touches.set(e.pointerId, [e.clientX, e.clientY]); if (pinch != null && touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); move(0, 0, 0, (d - pinch) * .5); pinch = d; if (drag) drag.moved = true; return; } }
    if (!drag || drag.id !== e.pointerId) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) drag.moved = true;
    if (rect) { if (drag.moved) { const c = chunkAt(e.clientX, e.clientY); if (c) applyRect(c); } drag.x = e.clientX; drag.y = e.clientY; return; }
    if (drag.moved) look(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY;
  });
  const up = e => {
    touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null; canvas.style.cursor = rectMode ? 'crosshair' : 'grab';
    const wasRect = rect && d.moved; rect = null;
    if (wasRect) { renderSel(); return; }
    if (!d.moved && Date.now() - d.t < 600 && e.button !== 2) pickAt(e.clientX, e.clientY, d.shift);
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', e => { touches.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener('dblclick', e => {   // double click selects the whole task under the cursor
    const c = chunkAt(e.clientX, e.clientY); if (!c) return; const t = taskOf.get(key(c[0], c[1])); if (!t) return;
    if (!e.shiftKey) sel.clear(); for (const [cx, cz] of t.chunks) sel.add(key(cx, cz)); colorGround(); renderSel();
  });
  function applyRect(c) {
    const pl = P().platform, [ax, az] = rect.a;
    sel.clear(); for (const k of rect.keep) sel.add(k);
    for (let x = Math.min(ax, c[0]); x <= Math.max(ax, c[0]); x++) for (let z = Math.min(az, c[1]); z <= Math.max(az, c[1]); z++)
      if (x >= pl.cx0 && z >= pl.cz0 && x < pl.cx0 + pl.size && z < pl.cz0 + pl.size) sel.add(key(x, z));
    colorGround(); $('selCount').textContent = String(sel.size);
  }
  $('rectBtn').onclick = () => { rectMode = !rectMode; $('rectBtn').setAttribute('aria-pressed', String(rectMode)); canvas.style.cursor = rectMode ? 'crosshair' : 'grab'; App.toast(rectMode ? 'Тяни мышью по платформе, чтобы выделить прямоугольник чанков. Shift — добавить к выбранным.' : 'Выделение рамкой выключено', 3500); };
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
  function chunkAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
    const v = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
    const o = camera.position.clone(), d = v.sub(o).normalize();
    if (d.y > -1e-4) return null; const t = -o.y / d.y;
    return [App.chunkOf(Math.floor(o.x + d.x * t)), App.chunkOf(Math.floor(o.z + d.z * t))];
  }
  function pickAt(clientX, clientY, add) {
    const r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
    const v = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
    const o = camera.position.clone(), d = v.sub(o).normalize();
    let hit = null;
    if (insts().length && !App.pref('plan.hidden', false)) {
      let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
      const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1, tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
      let tx = (d.x > 0 ? (x + 1 - o.x) : (o.x - x)) * tdx, ty = (d.y > 0 ? (y + 1 - o.y) : (o.y - y)) * tdy, tz = (d.z > 0 ? (z + 1 - o.z) : (o.z - z)) * tdz;
      for (let i = 0; i < 3000; i++) {
        if (y >= 0 && y < 400 && solidAt(x, y, z)) { hit = { x, z }; break; }
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
    colorGround(); renderSel(); showTab('tasks');
  }

  /* ---------- selection & tasks UI ---------- */
  let pickColor = SW[0];
  $('swatches').innerHTML = SW.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Цвет ${c}"></button>`).join('');
  $('swatches').onclick = e => { const c = e.target.dataset.c; if (c) { pickColor = c; $('taskColor').value = c; syncSw(); } };
  $('taskColor').oninput = e => { pickColor = e.target.value; syncSw(); };
  const syncSw = () => $('swatches').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === pickColor.toLowerCase())));
  let selMode = 'same';
  function selChunks() { return [...sel].map(k => k.split(',').map(Number)); }
  function renderSel() {
    const cs = selChunks();
    $('selCount').textContent = cs.length ? `${cs.length}` : '';
    $('selEdit').hidden = !cs.length || !CAN; $('selEdit').style.display = $('selEdit').hidden ? 'none' : 'flex';
    if (!cs.length) { $('selInfo').textContent = 'Кликни по чанку. Shift+клик — добавить ещё, «Выделить рамкой» — сразу прямоугольник, двойной клик — вся задача.'; return; }
    const xs = cs.map(c => c[0]), zs = cs.map(c => c[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    $('selInfo').innerHTML = cs.length === 1
      ? `Чанк <b class="mono">${sgn(x0)}, ${sgn(z0)}</b>: блоки X <span class="mono">${sgn(x0 * 16)}…${sgn(x0 * 16 + 15)}</span>, Z <span class="mono">${sgn(z0 * 16)}…${sgn(z0 * 16 + 15)}</span>`
      : `${cs.length} чанков в области X <span class="mono">${sgn(x0 * 16)}…${sgn(x1 * 16 + 15)}</span>, Z <span class="mono">${sgn(z0 * 16)}…${sgn(z1 * 16 + 15)}</span>`;
    if (cs.length === 1) { const st = structAtChunk(cs[0][0], cs[0][1]); if (st && defOf(st.def)) $('selInfo').innerHTML += `<br>Здесь стоит <a href="#" data-pickstruct="${esc(st.id)}">${esc(defOf(st.def).name)}</a>`; }
    if (!CAN) { const ts0 = [...new Set(cs.map(c => taskOf.get(key(c[0], c[1]))).filter(Boolean))]; $('selInfo').innerHTML += ts0.length ? '<br>' + ts0.map(t => `<b>${esc(t.name)}</b>${t.note ? ': ' + esc(t.note) : ''}`).join('<br>') : '<br>Задачи нет.'; return; }
    const ts = new Set(cs.map(c => taskOf.get(key(c[0], c[1])) || null));
    const real = [...ts].filter(Boolean), free = cs.filter(c => !taskOf.get(key(c[0], c[1]))).length;
    // pick the task that already holds most of the selected chunks: adding chunks extends it, several tasks merge into it
    let best = null, bn = 0; for (const t of real) { const n = cs.filter(c => taskOf.get(key(c[0], c[1])) === t).length; if (n > bn) { bn = n; best = t; } }
    $('taskPick').innerHTML = '<option value="">Новая задача</option>' + P().tasks.map(t => `<option value="${t.id}">${esc(t.name)} (${t.chunks.length} чанк.)</option>`).join('');
    $('taskPick').value = best ? best.id : '';
    selMode = real.length > 1 ? 'merge' : (real.length === 1 && free ? 'extend' : 'same');
    fillTaskFields();
    $('unassignBtn').hidden = !real.length;
    if (real.length > 1) $('selInfo').innerHTML += `<br>В выборе ${real.length} задачи: ${real.map(t => `<b style="color:${t.color}">${esc(t.name)}</b>`).join(', ')}. Выбери, в какую их объединить.`;
    else if (real.length === 1 && free) $('selInfo').innerHTML += `<br>${free} свободн. чанк. можно добавить к задаче <b style="color:${real[0].color}">${esc(real[0].name)}</b>.`;
  }
  function fillTaskFields() {
    const t = P().tasks.find(q => q.id === $('taskPick').value);
    $('taskName').value = t ? t.name : ''; $('taskNote').value = t ? (t.note || '') : '';
    pickColor = t ? t.color : SW[P().tasks.length % SW.length]; $('taskColor').value = pickColor; syncSw();
    $('newNameWrap').firstChild.textContent = t ? 'Название задачи' : 'Название новой задачи';
    $('assignBtn').textContent = !t ? 'Создать задачу на эти чанки' : selMode === 'merge' ? 'Объединить в эту задачу' : selMode === 'extend' ? 'Добавить чанки к задаче' : 'Сохранить задачу';
  }
  $('taskPick').onchange = fillTaskFields;
  $('selInfo').addEventListener('click', e => { const a = e.target.closest('[data-pickstruct]'); if (a) { e.preventDefault(); selectStruct(a.dataset.pickstruct, false); } });
  function dropChunks(chunks) { const ks = new Set(chunks.map(c => key(c[0], c[1]))); for (const t of P().tasks) t.chunks = t.chunks.filter(c => !ks.has(key(c[0], c[1]))); }
  $('assignBtn').onclick = () => {
    if (!CAN && deny()) return;
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
    if (del) { e.stopPropagation(); if (!CAN && deny()) return; const id = del.dataset.del;
      if (delArm.id !== id || Date.now() - delArm.t > 3000) { delArm = { id, t: Date.now() }; del.textContent = 'Точно?'; return; }
      P().tasks = P().tasks.filter(t => t.id !== id); App.save('tasks'); colorGround(); renderSel(); renderTasks(); return; }
    const it = e.target.closest('.item'); if (!it) return;
    const t = P().tasks.find(q => q.id === it.dataset.id); if (!t) return;
    sel.clear(); for (const [cx, cz] of t.chunks) sel.add(key(cx, cz)); colorGround(); renderSel();
    let sx = 0, sz = 0; for (const [cx, cz] of t.chunks) { sx += cx * 16 + 8; sz += cz * 16 + 8; }
    topView(sx / t.chunks.length, sz / t.chunks.length, Math.max(80, Math.sqrt(t.chunks.length) * 60));
  });
  $('volume').checked = App.pref('plan.volume', false);
  $('volume').onchange = e => { App.setPref('plan.volume', e.target.checked); buildTaskLines(); buildVolume(); redraw(); };

  /* ---------- platform panel ---------- */
  function renderPlatform() { const pl = P().platform; $('plSize').value = pl.size; $('plCX').value = pl.cx0; $('plCZ').value = pl.cz0;
    $('plInfo').innerHTML = `${pl.size}×${pl.size} чанков = ${pl.size * 16}×${pl.size * 16} блоков<br>X ${sgn(pl.cx0 * 16)}…${sgn((pl.cx0 + pl.size) * 16 - 1)}, Z ${sgn(pl.cz0 * 16)}…${sgn((pl.cz0 + pl.size) * 16 - 1)}`; }
  $('plApply').onclick = () => { if (!CAN && deny()) return; const pl = P().platform; pl.size = Math.min(48, Math.max(8, Math.round(+$('plSize').value || 16))); pl.cx0 = Math.round(+$('plCX').value || 0); pl.cz0 = Math.round(+$('plCZ').value || 0); App.save('platform'); refreshAll(); };
  $('plCenter').onclick = () => { if (!CAN && deny()) return; const pl = P().platform; pl.cx0 = -Math.floor(pl.size / 2); pl.cz0 = -Math.floor(pl.size / 2); App.save('platform'); refreshAll(); };

  /* ---------- views ---------- */
  function topView(x, z, h) { const pl = P().platform; cam.x = x ?? (pl.cx0 + pl.size / 2) * 16; cam.z = z ?? (pl.cz0 + pl.size / 2) * 16; cam.y = h ?? pl.size * 16 * 0.95; cam.yaw = 0; cam.pitch = -1.5707; redraw(); }
  function overview() { const pl = P().platform, c = (pl.size * 16), mx = (pl.cx0 + pl.size / 2) * 16, mz = (pl.cz0 + pl.size / 2) * 16; cam.x = mx + c * .55; cam.z = mz + c * .75; cam.y = c * .5; const dx = mx - cam.x, dz = mz - cam.z, dy = 20 - cam.y; cam.yaw = Math.atan2(-dx, -dz); cam.pitch = Math.atan2(dy, Math.hypot(dx, dz)); redraw(); }
  $('topView').onclick = () => topView(); $('sideView').onclick = overview;
  $('fullBtn').onclick = () => { try { const p = document.fullscreenElement ? document.exitFullscreen() : $('stage').requestFullscreen(); p && p.catch && p.catch(() => App.toast('Полный экран здесь не поддерживается')); } catch (e) { App.toast('Полный экран здесь не поддерживается'); } };
  document.addEventListener('fullscreenchange', () => { $('fullBtn').textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'Во весь экран'; });

  function refreshAll() { sel.clear(); buildGround(); renderPlatform(); renderSel(); renderTasks(); syncStructures(); }
  App.onChange(why => { if (why === 'import' || why === 'replace' || why === 'settings') refreshAll(); });
  const mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener && mq.addEventListener('change', () => colorGround());
  window.addEventListener('themechange', () => { colorGround(); redraw(); });

  if (!CAN) {
    ['plApply', 'plCenter', 'placeRow'].forEach(id => $(id).hidden = true);
    ['plSize', 'plCX', 'plCZ'].forEach(id => $(id).disabled = true);
    $('selInfo').insertAdjacentHTML('afterend', '<p class="note">Размечать чанки и ставить структуры могут модераторы. Ты можешь смотреть и выбирать чанки, чтобы прочитать задачу.</p>');
  }
  if (App.mode === 'server' && !CAN) App.every(async () => {
    const w = await App.api('GET', '/api/world'); if (JSON.stringify(w.plan) === JSON.stringify(P())) return;
    App.world.plan = w.plan; if (w.structdefs) App.world.structdefs = w.structdefs; const keep = [...sel]; refreshAll(); keep.forEach(k => sel.add(k)); colorGround(); renderSel();
  }, 60000);
  resize(); refreshAll(); overview();
})();
