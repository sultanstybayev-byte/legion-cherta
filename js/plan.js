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
  const MATS = { 1: '#8b8f8e', 2: '#d9d9d3', 3: '#f3ede4', 4: '#e0782b', 5: '#a3a5a9', 6: '#3c68c9', 7: '#a9d9cf', 8: '#e9b85a', 9: '#e6edf0', 10: '#e9ebec', 11: '#4d7482' };
  const isModel = VX.isModel;
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
    if (ground) { scene.remove(ground); ground.geometry.dispose(); ground.material.dispose(); ground.dispose(); }
    ground = new THREE.InstancedMesh(new THREE.BoxGeometry(16, 0.4, 16), new THREE.MeshLambertMaterial({ color: 0xffffff }), n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { tmpM.makeTranslation((pl.cx0 + i) * 16 + 8, -0.2, (pl.cz0 + j) * 16 + 8); ground.setMatrixAt(i * n + j, tmpM); }
    ground.setColorAt(0, tmpC.set('#ffffff')); scene.add(ground);
    if (lines) { scene.remove(lines); lines.geometry.dispose(); lines.material.dispose(); }
    const pts = [], x0 = pl.cx0 * 16, z0 = pl.cz0 * 16, L = n * 16;
    for (let i = 0; i <= n; i++) { pts.push(x0 + i * 16, 0.03, z0, x0 + i * 16, 0.03, z0 + L, x0, 0.03, z0 + i * 16, x0 + L, 0.03, z0 + i * 16); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x555b60, transparent: true, opacity: .55 })); scene.add(lines);
    buildCompass(); colorGround();
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
    if (selLines) { scene.remove(selLines); selLines.geometry.dispose(); selLines.material.dispose(); selLines = null; }
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
    if (taskLines) { scene.remove(taskLines); taskLines.geometry.dispose(); taskLines.material.dispose(); taskLines.dispose(); taskLines = null; }
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
    if (volume) { scene.remove(volume); volume.geometry.dispose(); volume.material.dispose(); volume.dispose(); volume = null; }
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
  // cardinal directions around the platform: letter + the coordinate of that edge; corners get their X, Z
  const compass = [];
  function textSprite(lines, opt) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), fs = opt.fs || 40, f1 = `700 ${fs}px "Unbounded", "IBM Plex Sans", system-ui, sans-serif`, f2 = `500 ${Math.round(fs * .62)}px "JetBrains Mono", monospace`;
    g.font = f1; let w = g.measureText(lines[0]).width; if (lines[1]) { g.font = f2; w = Math.max(w, g.measureText(lines[1]).width); }
    c.width = Math.ceil(w) + 36; c.height = lines[1] ? Math.round(fs * 1.9) + 22 : fs + 26;
    g.fillStyle = opt.bg || 'rgba(20,22,24,.8)'; roundRect(g, 0, 0, c.width, c.height, 14); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = opt.fg || '#fff'; g.font = f1; g.fillText(lines[0], c.width / 2, 12);
    if (lines[1]) { g.font = f2; g.fillStyle = 'rgba(255,255,255,.78)'; g.fillText(lines[1], c.width / 2, 16 + fs); }
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, transparent: true }));
    const h = opt.h || 0.06; sp.scale.set(h * c.width / c.height, h, 1); sp.renderOrder = 9; return sp;
  }
  function buildCompass() {
    for (const s of compass) { scene.remove(s); s.material.map.dispose(); s.material.dispose(); } compass.length = 0;
    const pl = P().platform, x0 = pl.cx0 * 16, z0 = pl.cz0 * 16, x1 = x0 + pl.size * 16, z1 = z0 + pl.size * 16, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, off = 14, acc = css('--accent') || '#e07b2a';
    const add = (sp, x, z) => { sp.position.set(x, 3, z); scene.add(sp); compass.push(sp); };
    add(textSprite(['С  север', `Z ${sgn(z0)}`], { bg: acc }), mx, z0 - off);
    add(textSprite(['Ю  юг', `Z ${sgn(z1 - 1)}`], {}), mx, z1 + off);
    add(textSprite(['З  запад', `X ${sgn(x0)}`], {}), x0 - off, mz);
    add(textSprite(['В  восток', `X ${sgn(x1 - 1)}`], {}), x1 + off, mz);
    for (const [x, z] of [[x0, z0], [x1 - 1, z0], [x0, z1 - 1], [x1 - 1, z1 - 1]]) add(textSprite([`${sgn(x)}, ${sgn(z)}`], { fs: 26, h: 0.032, bg: 'rgba(20,22,24,.62)' }), x + .5, z + .5);
    // a north arrow on the ground
    if (compassArrow) { scene.remove(compassArrow); compassArrow.geometry.dispose(); compassArrow.material.dispose(); }
    const sh = new THREE.Shape(); sh.moveTo(0, -10); sh.lineTo(5, 4); sh.lineTo(0, 1); sh.lineTo(-5, 4); sh.closePath();
    compassArrow = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: new THREE.Color(acc), side: THREE.DoubleSide }));
    compassArrow.rotation.x = Math.PI / 2; compassArrow.position.set(mx, 0.1, z0 - off - 16); scene.add(compassArrow);
  }
  let compassArrow = null;
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  /* ---------- structures placed on the platform ---------- */
  const defs = () => W().structdefs, insts = () => P().structures;
  const defOf = id => defs().find(d => d.id === id);
  const lotusCache = new Map();          // def id -> { key, L, n, mat, col }
  const meshes = new Map();              // instance id -> Object3D
  let selStruct = null, selBox = null;
  // models come from js/vox.js; here they are turned into instance buffers (one copy per structure, shared by its placements)
  function lotusData(def) {
    const vox = VX.cached(def); if (!vox) return null;
    const c = lotusCache.get(def.id); if (c && c.vox === vox) return c;
    const sf = VX.surface(vox), n = sf.n, mat = new Float32Array(n * 16), col = sf.rgb, b = vox.bounds();
    for (let i = 0; i < n; i++) { tmpM.makeTranslation(sf.pos[3 * i] + .5, sf.pos[3 * i + 1] + .5, sf.pos[3 * i + 2] + .5); tmpM.toArray(mat, i * 16); }
    const out = { vox, L: { get: (x, y, z) => vox.get(x, y, z), inside: (x, y, z) => vox.inside(x, y, z), H: b ? b.y1 + 1 : 1 }, n, cap: Math.max(1, n), mat, col, pos: sf.pos, cells: null };
    lotusCache.set(def.id, out); return out;
  }
  function cellsOf(c) {
    if (c.cells) return c.cells; const m = c.cells = new Map();
    for (let i = 0; i < c.n; i++) { const k = cellKey(c.pos[3 * i], c.pos[3 * i + 1], c.pos[3 * i + 2]); let a = m.get(k); if (!a) m.set(k, a = []); a.push(i); }
    return m;
  }
  function uploadMesh(def, m) {
    const c = lotusCache.get(def.id); if (!c) return;
    m.instanceMatrix.array.set(c.mat.subarray(0, c.n * 16)); m.instanceMatrix.needsUpdate = true; m.count = c.n; recolor(def, m, null);
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  /* ---------- zones painted on a model with the brush: cubes of ZC×ZC×ZC blocks, stored on the structure ---------- */
  const ZC = 4, ZONE_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e84393', '#795548', '#34495e'];
  const cellKey = (x, y, z) => Math.floor(x / ZC) + ',' + Math.floor(y / ZC) + ',' + Math.floor(z / ZC);
  const zoneMaps = new WeakMap();
  function zonesOf(def) { let m = zoneMaps.get(def); if (!m) { m = new Map(); for (const z of def.zones || []) if (Array.isArray(z) && z.length === 4) m.set(z[0] + ',' + z[1] + ',' + z[2], z[3] | 0); zoneMaps.set(def, m); } return m; }
  function storeZones(def) { def.zones = [...zonesOf(def)].map(([k, c]) => [...k.split(',').map(Number), c]); }
  const zc = new THREE.Color(), bc = new THREE.Color();
  function recolor(def, mesh, keys) {      // keys: changed cells, or null for all
    const c = lotusCache.get(def.id); if (!c || !mesh.instanceColor) return;
    const zm = zonesOf(def), arr = mesh.instanceColor.array; if (!keys) arr.set(c.col.subarray(0, c.n * 3));
    const one = (ck, idx) => { const z = zm.get(ck); for (const i of idx) { bc.setRGB(c.col[3 * i], c.col[3 * i + 1], c.col[3 * i + 2]); if (z != null) bc.lerp(zc.set(ZONE_COLORS[z] || '#ff00ff'), .78); arr[3 * i] = bc.r; arr[3 * i + 1] = bc.g; arr[3 * i + 2] = bc.b; } };
    const cells = cellsOf(c); if (keys) { for (const k of keys) { const idx = cells.get(k); if (idx) one(k, idx); } } else for (const [k, idx] of cells) if (zm.has(k)) one(k, idx);
    mesh.instanceColor.needsUpdate = true;
  }
  function makeMesh(def, s) {
    if (isModel(def) && lotusData(def)) {
      const c = lotusData(def), m = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), c.cap);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(c.cap * 3), 3); m.userData.def = def.id;
      uploadMesh(def, m); return m;
    }
    const g = new THREE.Group(), fp = App.footprint(def, s), w = fp.x1 - fp.x0, d = fp.z1 - fp.z0;
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(def.color), transparent: true, opacity: .55 }));
    body.scale.set(w - 0.4, def.h, d - 0.4); body.position.set(0, def.h / 2, 0); g.add(body);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w - 0.4, def.h, d - 0.4)), new THREE.LineBasicMaterial({ color: new THREE.Color(def.color) }));
    edges.position.set(0, def.h / 2, 0); g.add(edges); return g;
  }
  function disposeObj(o) { o.traverse(x => { if (x.geometry && x.geometry !== boxGeo) x.geometry.dispose(); if (x.material) x.material.dispose(); if (x.isInstancedMesh) x.dispose(); }); }   // InstancedMesh.dispose frees its GPU buffers
  function syncStructures() {
    const hidden = App.pref('plan.hidden', false), need = insts().filter(s => defOf(s.def));
    const wantLotus = need.some(s => { const d = defOf(s.def); return isModel(d) && !VX.cached(d); });
    const go = () => {
      for (const [id, o] of meshes) { scene.remove(o); disposeObj(o); } meshes.clear();
      for (const s of need) {
        const def = defOf(s.def), o = makeMesh(def, s), fp = App.footprint(def, s);
        placeMesh(o, def, s);
        o.visible = !hidden; o.userData.sid = s.id; scene.add(o); meshes.set(s.id, o);
      }
      drawSelBox(); buildSurfGrid(); renderStructs(); renderZones(); redraw();
    };
    if (wantLotus) { $('busy').hidden = false; setTimeout(async () => { for (const st of need) { const d = defOf(st.def); if (isModel(d)) { try { await VX.loadModel(d); } catch (e) { console.warn(e); } } } go(); $('busy').hidden = true; }, 30); } else go();
  }
  function placeMesh(o, def, s) {
    const fp = App.footprint(def, s);
    if (isModel(def)) { o.position.set(fp.ox, 0, fp.oz); o.rotation.y = -(s.rot || 0) * Math.PI / 2; } else o.position.set((fp.x0 + fp.x1) / 2, 0, (fp.z0 + fp.z1) / 2);
  }
  function drawSelBox() {
    if (selBox) { scene.remove(selBox); disposeObj(selBox); selBox = null; }
    const s = insts().find(q => q.id === selStruct), def = s && defOf(s.def); if (!def) return;
    const fp = App.footprint(def, s), h = isModel(def) ? (lotusCache.get(def.id) || { L: { H: 80 } }).L.H : def.h;
    selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(fp.x1 - fp.x0, h + 1, fp.z1 - fp.z0)), new THREE.LineBasicMaterial({ color: new THREE.Color(css('--accent') || '#e07b2a'), depthTest: false }));
    selBox.position.set((fp.x0 + fp.x1) / 2, (h + 1) / 2, (fp.z0 + fp.z1) / 2); selBox.renderOrder = 6; scene.add(selBox);
  }
  // which structure covers a block column, and the solid test used for picking
  // top of a world column inside a placed structure (0 if empty)
  function topFn(s) {
    const def = defOf(s.def); if (!def) return () => 0; const fp = App.footprint(def, s);
    if (!isModel(def)) return (x, z) => (x >= fp.x0 && x < fp.x1 && z >= fp.z0 && z < fp.z1) ? def.h : 0;
    const c = lotusCache.get(def.id); if (!c) return () => 0;
    const v = c.vox, hm = c.hm || (c.hm = VX.heightMap(v)), a = (s.rot || 0) * Math.PI / 2, ca = Math.round(Math.cos(a)), sa = Math.round(Math.sin(a));
    return (x, z) => { if (x < fp.x0 || x >= fp.x1 || z < fp.z0 || z >= fp.z1) return 0; const wx = x + .5 - fp.ox, wz = z + .5 - fp.oz, lx = Math.floor(wx * ca + wz * sa), lz = Math.floor(-wx * sa + wz * ca), i = lx - v.x0, k = lz - v.z0;
      return (i < 0 || k < 0 || i >= v.w || k >= v.d) ? 0 : hm[k * v.w + i]; };
  }
  // chunk grid lying on top of the structures, so the covered chunks are visible
  let surfGrid = null;
  function buildSurfGrid() {
    if (surfGrid) { scene.remove(surfGrid); surfGrid.geometry.dispose(); surfGrid.material.dispose(); surfGrid = null; }
    if (!App.pref('plan.surfGrid', true) || App.pref('plan.hidden', false)) { redraw(); return; }
    const pts = [];
    for (const s of insts()) { const def = defOf(s.def); if (!def) continue; const fp = App.footprint(def, s), h = topFn(s); for (const v of VX.chunkGridLines(h, fp.x0, fp.x1, fp.z0, fp.z1, 0, 0, 0.12)) pts.push(v); }
    if (!pts.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    surfGrid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(css('--accent') || '#e07b2a'), transparent: true, opacity: .85 })); surfGrid.renderOrder = 3; scene.add(surfGrid); redraw();
  }
  const platformCentre = () => { const pl = P().platform; return [(pl.cx0 + pl.size / 2) * 16, (pl.cz0 + pl.size / 2) * 16]; };
  const fmtOff = v => (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(v)).replace('.', ',');
  function solidAt(x, y, z) {
    for (const s of insts()) {
      const def = defOf(s.def); if (!def) continue; const fp = App.footprint(def, s);
      if (x < fp.x0 - 1 || x > fp.x1 || z < fp.z0 - 1 || z > fp.z1) continue;
      if (isModel(def)) {
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
    $('defPick').innerHTML = defs().map(d => `<option value="${esc(d.id)}">${esc(d.name)} — ${isModel(d) ? 'модель' : `${d.w}×${d.d} чанк., ${d.h} бл.`}</option>`).join('');
    $('placedList').innerHTML = list.length ? list.map(s => {
      const def = defOf(s.def); if (!def) return '';
      const fp = App.footprint(def, s), out = fp.x0 < pl.cx0 * 16 || fp.z0 < pl.cz0 * 16 || fp.x1 > (pl.cx0 + pl.size) * 16 || fp.z1 > (pl.cz0 + pl.size) * 16;
      return `<div class="item" data-sid="${esc(s.id)}" role="button" tabindex="0" ${s.id === selStruct ? 'style="background:var(--accent-soft)"' : ''}><span style="width:18px;height:18px;border-radius:5px;background:${esc(def.color)}"></span><span class="t">${esc(def.name)}</span><span class="c">центр X ${sgn(Math.floor(fp.ox))} · Z ${sgn(Math.floor(fp.oz))} · чанк ${sgn(s.cx)}, ${sgn(s.cz)}${s.rot ? ' · поворот ' + s.rot * 90 + '°' : ''}${out ? ' · за краем платформы' : ''}</span>${CAN ? `<span class="r"><button class="btn sm danger" data-sdel="${esc(s.id)}">Убрать</button></span>` : ''}</div>`;
    }).join('') : '<div class="empty">На платформе пока пусто. Выбери структуру выше и нажми «Поставить».</div>';
    const s = list.find(q => q.id === selStruct), def = s && defOf(s.def);
    $('structEdit').hidden = !s || !CAN; $('structEdit').style.display = $('structEdit').hidden ? 'none' : 'flex';
    if (s && def) {
      const fp = App.footprint(def, s), [pcx, pcz] = platformCentre(), mx = (fp.x0 + fp.x1) / 2, mz = (fp.z0 + fp.z1) / 2, offx = mx - pcx, offz = mz - pcz;
      const used = VX.chunksUsed(topFn(s), fp.x0, fp.x1, fp.z0, fp.z1, 0, 0);
      $('structInfo').innerHTML = `<b>${esc(def.name)}</b> · ${fp.x1 - fp.x0}×${fp.z1 - fp.z0} блоков<br>центр в мире X ${String(mx).replace('.', ',')} · Z ${String(mz).replace('.', ',')}<br>от центра платформы: X ${fmtOff(offx)} · Z ${fmtOff(offz)}${!offx && !offz ? ' — ровно по центру' : ''}<br>центр в чанке: ${(((mx % 16) + 16) % 16) === 8 && (((mz % 16) + 16) % 16) === 8 ? 'в середине ✓' : 'блок ' + String(((mx % 16) + 16) % 16).replace('.', ',') + ', ' + String(((mz % 16) + 16) % 16).replace('.', ',')}<br>занимает чанков: ${used.n}${used.n ? ` (X ${sgn(used.cx0)}…${sgn(used.cx1)}, Z ${sgn(used.cz0)}…${sgn(used.cz1)})` : ''}`;
    }
    else $('structInfo').textContent = list.length ? (CAN ? 'Структуры закреплены. Двигать — стрелками или включи «Двигать мышью». Клик по строке — выбрать.' : 'Клик по строке — показать.') : '';
  }
  function selectStruct(id, fly) {
    selStruct = id; drawSelBox(); renderStructs(); renderZones(); showTab('structs');
    const s = insts().find(q => q.id === id), def = s && defOf(s.def);
    if (fly && def) { const fp = App.footprint(def, s), sz = Math.max(fp.x1 - fp.x0, fp.z1 - fp.z0); cam.x = fp.ox + sz * .5; cam.z = fp.oz + sz * 1.3; cam.y = sz * .6 + 10; const dx = fp.ox - cam.x, dz = fp.oz - cam.z, dy = 10 - cam.y; cam.yaw = Math.atan2(-dx, -dz); cam.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
    redraw();
  }
  let rowDelArm = { id: null, t: 0 };
  function removeStruct(id) { P().structures = insts().filter(q => q.id !== id); if (selStruct === id) selStruct = null; App.save('structures'); syncStructures(); }
  $('placedList').addEventListener('click', e => {
    const del = e.target.closest('[data-sdel]');
    if (del) { e.stopPropagation(); if (!CAN && deny()) return; const id = del.dataset.sdel;
      if (rowDelArm.id !== id || Date.now() - rowDelArm.t > 3000) { rowDelArm = { id, t: Date.now() }; del.textContent = 'Точно?'; return; }
      removeStruct(id); return; }
    const it = e.target.closest('[data-sid]'); if (it) selectStruct(it.dataset.sid, true);
  });
  $('placeBtn').onclick = () => {
    if (!CAN && deny()) return;
    const def = defOf($('defPick').value); if (!def) return;
    const cs = selChunks(), pl = P().platform;
    let cx = cs.length === 1 ? cs[0][0] : pl.cx0 + Math.floor(pl.size / 2), cz = cs.length === 1 ? cs[0][1] : pl.cz0 + Math.floor(pl.size / 2);
    if (!isModel(def) && cs.length !== 1) { cx -= Math.floor(def.w / 2); cz -= Math.floor(def.d / 2); }
    const s = { id: uid(), def: def.id, cx, cz, rot: 0 }; insts().push(s);
    App.save('structures'); syncStructures(); selectStruct(s.id, true);
    App.toast(`«${def.name}» поставлена. Двигай стрелками или включи «Двигать мышью».`);
  };
  document.querySelectorAll('[data-smove]').forEach(btn => btn.onclick = () => {
    if (!CAN && deny()) return; const s = insts().find(q => q.id === selStruct); if (!s) return;
    const [dx, dz] = btn.dataset.smove.split(',').map(Number); s.cx += dx; s.cz += dz; App.save('structures'); syncStructures();
  });
  $('structRot').onclick = () => { if (!CAN && deny()) return; const s = insts().find(q => q.id === selStruct); if (!s) return; s.rot = ((s.rot || 0) + 1) % 4; App.save('structures'); syncStructures(); };
  $('structToSel').onclick = () => {
    if (!CAN && deny()) return; const s = insts().find(q => q.id === selStruct); const cs = selChunks();
    if (!s) return; if (cs.length !== 1) { App.toast('Выбери на платформе один чанк — туда встанет структура'); return; }
    s.cx = cs[0][0]; s.cz = cs[0][1]; s.dx = 0; s.dz = 0; App.save('structures'); syncStructures();
  };
  $('structCentre').onclick = () => {
    if (!CAN && deny()) return; const s = insts().find(q => q.id === selStruct), def = s && defOf(s.def); if (!def) return;
    const fp = App.footprint(def, s), [pcx, pcz] = platformCentre(), ddx = Math.round(pcx - (fp.x0 + fp.x1) / 2), ddz = Math.round(pcz - (fp.z0 + fp.z1) / 2);
    // the structure's centre (the 2×2 middle) always lands in the middle of a chunk: block 8 of the chunk, like every model
    s.cx += Math.round(ddx / 16); s.cz += Math.round(ddz / 16); s.dx = 0; s.dz = 0;
    App.save('structures'); syncStructures();
    const f2 = App.footprint(def, s), ox = (f2.x0 + f2.x1) / 2 - pcx, oz = (f2.z0 + f2.z1) / 2 - pcz, pl = P().platform;
    App.toast(!ox && !oz ? 'Ровно по центру платформы, центр структуры — в середине чанка'
      : `Центр структуры — в середине чанка; от центра платформы X ${fmtOff(ox)} · Z ${fmtOff(oz)}.${pl.size % 2 === 0 && isModel(def) ? ' У платформы плана чётное число чанков (' + pl.size + '), её центр на углу чанка. Сделай её нечётной (например ' + (pl.size + 1) + ') во вкладке «Платформа» — и будет ровно.' : ''}`, 7000);
  };
  $('surfGrid').checked = App.pref('plan.surfGrid', true);
  $('surfGrid').onchange = e => { App.setPref('plan.surfGrid', e.target.checked); buildSurfGrid(); };
  let sDelArm = 0;
  $('structDel').onclick = () => {
    if (!CAN && deny()) return;
    if (Date.now() - sDelArm > 3000) { sDelArm = Date.now(); $('structDel').textContent = 'Точно убрать?'; return; }
    $('structDel').textContent = 'Убрать с платформы'; removeStruct(selStruct);
  };
  $('dragMove').checked = App.pref('plan.dragMove', false);
  $('dragMove').onchange = e => { App.setPref('plan.dragMove', e.target.checked); App.toast(e.target.checked ? 'Теперь структуру можно зажать в 3D и перетащить. Не забудь выключить.' : 'Структуры закреплены: мышь только крутит камеру.', 3500); };
  $('structHidden').checked = App.pref('plan.hidden', false);
  $('structHidden').onchange = e => { App.setPref('plan.hidden', e.target.checked); for (const o of meshes.values()) o.visible = !e.target.checked; buildSurfGrid(); redraw(); };

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
    if (walk.on) { if (document.pointerLockElement !== canvas) lockMouse(); return; }
    if (e.pointerType === 'touch') { touches.set(e.pointerId, [e.clientX, e.clientY]); if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } }
    canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, id: e.pointerId, t: Date.now(), moved: false, shift: e.shiftKey || e.ctrlKey || e.metaKey }; canvas.style.cursor = rectMode ? 'crosshair' : 'grabbing';
    if (rectMode && e.button === 0 && e.pointerType !== 'touch' || rectMode && e.pointerType === 'touch' && touches.size === 1) { const c = chunkAt(e.clientX, e.clientY); if (c) rect = { a: c, keep: drag.shift ? new Set(sel) : new Set() }; }
    else if (brush.on && CAN && e.button === 0 && touches.size <= 1) {   // brush: paint zones while the button is held
      const h = rayHit(e.clientX, e.clientY, true);
      if (h && h.s && isModel(defOf(h.s.def))) { drag.paint = { def: defOf(h.s.def), n: 0 }; paintAt(h, drag.paint); if (selStruct !== h.s.id) { selStruct = h.s.id; drawSelBox(); renderStructs(); renderZones(); showTab('structs'); } }
      else if (h && h.s) App.toast('Кистью красятся модели из блоков. Заготовки пока — просто цветные блоки.', 3500);
    }
    else if (CAN && e.button === 0 && touches.size <= 1 && App.pref('plan.dragMove', false)) {   // press on a structure: drag it over the chunks
      const h = rayHit(e.clientX, e.clientY, true);
      if (h && h.s) { const p0 = planeAt(e.clientX, e.clientY, h.y + .5); if (p0) drag.struct = { s: h.s, cx: h.s.cx, cz: h.s.cz, y: h.y + .5, p0 }; }
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) { touches.set(e.pointerId, [e.clientX, e.clientY]); if (pinch != null && touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); move(0, 0, 0, (d - pinch) * .5); pinch = d; if (drag) drag.moved = true; return; } }
    if (!drag || drag.id !== e.pointerId) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) drag.moved = true;
    if (rect) { if (drag.moved) { const c = chunkAt(e.clientX, e.clientY); if (c) applyRect(c); } drag.x = e.clientX; drag.y = e.clientY; return; }
    if (drag.paint) {
      if (!drag.paint.raf) { const x = e.clientX, y = e.clientY; drag.paint.raf = requestAnimationFrame(() => { if (!drag || !drag.paint) return; drag.paint.raf = 0;
        const h = rayHit(x, y, true); if (h && h.s && defOf(h.s.def) === drag.paint.def) paintAt(h, drag.paint); }); }
      return;
    }
    if (drag.struct) {
      if (!drag.moved) return; const st = drag.struct, s = st.s, def = defOf(s.def);
      if (!st.started) { st.started = true; canvas.style.cursor = 'move'; if (selStruct !== s.id) { selStruct = s.id; drawSelBox(); renderStructs(); renderZones(); showTab('structs'); } }
      const p = planeAt(e.clientX, e.clientY, st.y); if (!p || !def) return;
      const cx = st.cx + Math.round((p.x - st.p0.x) / 16), cz = st.cz + Math.round((p.z - st.p0.z) / 16);
      if (cx !== s.cx || cz !== s.cz) { s.cx = cx; s.cz = cz; const o = meshes.get(s.id); if (o) placeMesh(o, def, s); drawSelBox(); redraw();
        const fp = App.footprint(def, s); $('structInfo').textContent = `${def.name}: центр X ${sgn(Math.floor(fp.ox))} · Z ${sgn(Math.floor(fp.oz))}`; }
      return;
    }
    if (drag.moved) look(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY;
  });
  const up = e => {
    touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null; canvas.style.cursor = rectMode ? 'crosshair' : 'grab';
    const wasRect = rect && d.moved; rect = null;
    if (wasRect) { renderSel(); return; }
    if (d.paint) { if (d.paint.n) { storeZones(d.paint.def); App.save('structdefs'); renderZones(); } return; }
    if (d.struct && d.moved) { const st = d.struct; if (st.s.cx !== st.cx || st.s.cz !== st.cz) { buildSurfGrid(); App.save('structures'); App.toast(`Перенесено на ${sgn(st.s.cx - st.cx)}, ${sgn(st.s.cz - st.cz)} чанк.`); } renderStructs(); return; }
    if (!d.moved && Date.now() - d.t < 600 && e.button !== 2) pickAt(e.clientX, e.clientY, d.shift);
  };
  let hoverT = 0;
  canvas.addEventListener('pointermove', e => {
    if (drag || walk.on || !CAN || rectMode || brush.on || !App.pref('plan.dragMove', false) || e.pointerType === 'touch' || !insts().length) return;
    const now = performance.now(); if (now - hoverT < 90) return; hoverT = now;
    canvas.style.cursor = rayHit(e.clientX, e.clientY, true) ? 'move' : 'grab';
  });
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
  /* brush */
  const brush = { on: false, color: 0, erase: false, size: 1 };
  function paintAt(h, st) {
    const s = h.s, def = defOf(s.def), fp = App.footprint(def, s), a = (s.rot || 0) * Math.PI / 2, wx = h.x + .5 - fp.ox, wz = h.z + .5 - fp.oz;
    const lx = Math.floor(wx * Math.cos(a) + wz * Math.sin(a) + 1e-6), lz = Math.floor(-wx * Math.sin(a) + wz * Math.cos(a) + 1e-6);
    const cx = Math.floor(lx / ZC), cy = Math.floor(h.y / ZC), cz = Math.floor(lz / ZC), R = brush.size - 1, zm = zonesOf(def), keys = [];
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dy * dy + dz * dz > R * R + .5) continue;
      const k = (cx + dx) + ',' + (cy + dy) + ',' + (cz + dz);
      if (brush.erase) { if (zm.delete(k)) keys.push(k); } else if (zm.get(k) !== brush.color) { zm.set(k, brush.color); keys.push(k); }
    }
    if (!keys.length) return; st.n += keys.length;
    for (const o of meshes.values()) if (o.userData.def === def.id) recolor(def, o, keys);
    redraw();
  }
  function setBrush(on) {
    brush.on = on; $('brushBtn').setAttribute('aria-pressed', String(on)); $('brushBar').hidden = !on;
    if (on && rectMode) $('rectBtn').click();
    canvas.style.cursor = on ? 'crosshair' : 'grab';
    if (on) App.toast('Зажми мышь на структуре и води — зона закрашивается кубами 4×4×4. Мимо структуры — обычный обзор.', 4500);
  }
  $('brushBtn').onclick = () => { if (!CAN && deny()) return; setBrush(!brush.on); };
  $('brushSw').innerHTML = ZONE_COLORS.map((c, i) => `<button type="button" style="background:${c}" data-zi="${i}" aria-label="Зона ${i + 1}"></button>`).join('');
  const syncBrush = () => { $('brushSw').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(!brush.erase && +b.dataset.zi === brush.color))); $('brushErase').setAttribute('aria-pressed', String(brush.erase)); };
  $('brushSw').onclick = e => { const b = e.target.closest('[data-zi]'); if (!b) return; brush.color = +b.dataset.zi; brush.erase = false; syncBrush(); };
  $('brushErase').onclick = () => { brush.erase = !brush.erase; syncBrush(); };
  $('brushSize').onchange = e => { brush.size = +e.target.value; };
  brush.size = +$("brushSize").value;
  syncBrush();
  // zone legend for the selected structure: colour, size, name
  function renderZones() {
    const s = insts().find(q => q.id === selStruct), def = s && defOf(s.def), box = $('zoneList');
    if (!def || !isModel(def)) { $('zoneSec').hidden = true; return; }
    const zm = zonesOf(def), cnt = new Map(); for (const c of zm.values()) cnt.set(c, (cnt.get(c) || 0) + 1);
    $('zoneSec').hidden = false;
    box.innerHTML = cnt.size ? [...cnt].sort((a, b) => a[0] - b[0]).map(([c, n]) => `<div class="row" style="gap:8px"><span style="width:18px;height:18px;border-radius:5px;background:${ZONE_COLORS[c]};flex:none"></span>
      <input type="text" class="grow" data-zname="${c}" maxlength="40" value="${esc((def.zoneNames || {})[c] || '')}" placeholder="Зона ${c + 1}" ${CAN ? '' : 'disabled'}><span class="note mono">${n} куб.</span>
      ${CAN ? `<button class="btn sm" data-zclear="${c}" title="Стереть зону">✕</button>` : ''}</div>`).join('')
      : `<p class="note">Зон пока нет. ${CAN ? 'Включи «Кисть» сверху над 3D, выбери цвет и води по структуре.' : ''}</p>`;
  }
  $('zoneList').addEventListener('change', e => {
    const i = e.target.closest('[data-zname]'); if (!i) return; const s = insts().find(q => q.id === selStruct), def = s && defOf(s.def); if (!def) return;
    def.zoneNames = Object.assign({}, def.zoneNames, { [i.dataset.zname]: i.value.trim() }); App.save('structdefs');
  });
  $('zoneList').addEventListener('click', e => {
    const b = e.target.closest('[data-zclear]'); if (!b) return; const s = insts().find(q => q.id === selStruct), def = s && defOf(s.def); if (!def) return;
    const c = +b.dataset.zclear, zm = zonesOf(def), keys = []; for (const [k, v] of zm) if (v === c) { zm.delete(k); keys.push(k); }
    for (const o of meshes.values()) if (o.userData.def === def.id) recolor(def, o, keys);
    storeZones(def); App.save('structdefs'); renderZones(); redraw();
  });
  $('rectBtn').onclick = () => { if (brush.on && !rectMode) setBrush(false); rectMode = !rectMode; $('rectBtn').setAttribute('aria-pressed', String(rectMode)); canvas.style.cursor = rectMode ? 'crosshair' : 'grab'; App.toast(rectMode ? 'Тяни мышью по платформе, чтобы выделить прямоугольник чанков. Shift — добавить к выбранным.' : 'Выделение рамкой выключено', 3500); };
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (walk.on) return; move(0, 0, 0, -e.deltaY * 0.12); }, { passive: false });

  const keys = new Set(); let kbRaf = 0, kbLast = 0;
  const KB = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  canvas.addEventListener('keydown', e => {
    if (walk.on) return;
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

  /* ---------- first-person walk, like in Minecraft: gravity, collisions with the blocks, mouse look ---------- */
  const walk = { on: false, vx: 0, vy: 0, vz: 0, ground: false, fly: false, keys: new Set(), raf: 0, last: 0, saved: null, px: 0, py: 0, pz: 0 };
  const EYE = 1.62, PW2 = 0.3, PH = 1.8, GRAV = 28, JUMP = 8.6;
  const solidB = (x, y, z) => y < 0 || (!App.pref('plan.hidden', false) && !!solidAt(x, y, z));
  function hits(px, py, pz) {
    for (let x = Math.floor(px - PW2); x <= Math.floor(px + PW2 - 1e-6); x++) for (let z = Math.floor(pz - PW2); z <= Math.floor(pz + PW2 - 1e-6); z++)
      for (let y = Math.floor(py); y <= Math.floor(py + PH - 1e-6); y++) if (solidB(x, y, z)) return true;
    return false;
  }
  function lockMouse() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
  function startWalk() {
    walk.saved = { ...cam }; walk.on = true; walk.fly = false; walk.vx = walk.vy = walk.vz = 0; walk.keys.clear();
    // stand in front of the south entrance of the selected (or first) structure, looking north at it
    const s = insts().find(q => q.id === selStruct) || insts().find(q => defOf(q.def)), def = s && defOf(s.def);
    if (def) { const fp = App.footprint(def, s); walk.px = fp.ox + .5; walk.pz = fp.z1 + 4; walk.py = 0; cam.yaw = 0; cam.pitch = 0; }
    else { walk.px = cam.x; walk.pz = cam.z; walk.py = 0; cam.pitch = 0; }
    while (hits(walk.px, walk.py, walk.pz) && walk.py < 400) walk.py += 1;
    $('walkBtn').textContent = 'Выйти (Esc)'; $('walkBtn').setAttribute('aria-pressed', 'true'); document.body.classList.add('walking');
    $('hud').dataset.text = $('hud').dataset.text || $('hud').innerHTML;
    $('hud').innerHTML = '<b>W</b><b>A</b><b>S</b><b>D</b> идти · <b>Space</b> прыжок · <b>Shift</b> бег · <b>F</b> полёт (Space/C — вверх/вниз) · мышь — смотреть' + (CAN ? ' · менять блоки — в «Структурах»' : '') + ' · <b>Esc</b> — выйти · <span id="camPos"></span>';
    if (brush.on) setBrush(false); if (rectMode) $('rectBtn').click();
    for (const o of [...compass, ...labels]) o.visible = false; if (compassArrow) compassArrow.visible = false;
    lockMouse(); canvas.focus(); walk.last = performance.now(); walk.raf = requestAnimationFrame(walkTick);
  }
  function stopWalk() {
    if (!walk.on) return; walk.on = false; cancelAnimationFrame(walk.raf); walk.keys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    Object.assign(cam, walk.saved || {}); $('walkBtn').textContent = 'Войти внутрь'; $('walkBtn').setAttribute('aria-pressed', 'false'); document.body.classList.remove('walking');
    for (const o of [...compass, ...labels]) o.visible = true; if (compassArrow) compassArrow.visible = true;
    if ($('hud').dataset.text) $('hud').innerHTML = $('hud').dataset.text; redraw();
  }
  function walkTick(now) {
    if (!walk.on) return;
    const dt = Math.min(0.05, (now - walk.last) / 1000); walk.last = now; const k = c => walk.keys.has(c);
    const f = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0), r = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const sp = walk.fly ? (k('ShiftLeft') || k('ShiftRight') ? 22 : 11) : (k('ShiftLeft') || k('ShiftRight') ? 5.6 : 4.3);
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), len = Math.hypot(f, r) || 1;
    const vx = (-sy * f + cy * r) / len * sp, vz = (-cy * f - sy * r) / len * sp;
    if (walk.fly) walk.vy = ((k('Space') ? 1 : 0) - (k('KeyC') ? 1 : 0)) * sp;
    else { if (k('Space') && walk.ground) { walk.vy = JUMP; walk.ground = false; } walk.vy = Math.max(-60, walk.vy - GRAV * dt); }
    // horizontal: one axis at a time; a one-block step is climbed on its own (like auto-jump)
    for (const [ax, v] of [['px', vx * dt], ['pz', vz * dt]]) {
      if (!v) continue; const old = walk[ax]; walk[ax] += v;
      if (hits(walk.px, walk.py, walk.pz)) {
        if (walk.ground && !hits(walk.px, walk.py + 1.05, walk.pz)) walk.py = Math.floor(walk.py + 1.05);
        else walk[ax] = old;
      }
    }
    const oy = walk.py; walk.py += walk.vy * dt; walk.ground = false;
    if (hits(walk.px, walk.py, walk.pz)) { if (walk.vy < 0) { walk.py = Math.floor(walk.py) + 1; walk.ground = true; if (hits(walk.px, walk.py, walk.pz)) walk.py = oy; } else walk.py = oy; walk.vy = 0; }
    cam.x = walk.px; cam.y = walk.py + EYE; cam.z = walk.pz; draw();
    walk.raf = requestAnimationFrame(walkTick);
  }
  document.addEventListener('keydown', e => {
    if (!walk.on) return;
    if (e.code === 'Escape') { stopWalk(); return; }
    if (e.code === 'KeyF') { walk.fly = !walk.fly; walk.vy = 0; App.toast(walk.fly ? 'Полёт: Space — вверх, C — вниз' : 'Полёт выключен', 1800); return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); walk.keys.add(e.code); }
  });
  document.addEventListener('keyup', e => walk.keys.delete(e.code));
  document.addEventListener('mousemove', e => { if (!walk.on || document.pointerLockElement !== canvas || performance.now() - (walk.lockedAt || 0) < 150 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; cam.yaw -= e.movementX * 0.0022; cam.pitch = Math.min(1.55, Math.max(-1.55, cam.pitch - e.movementY * 0.0022)); });
  document.addEventListener('pointerlockchange', () => { if (walk.on && document.pointerLockElement !== canvas && walk.wasLocked) stopWalk(); walk.wasLocked = document.pointerLockElement === canvas; if (walk.wasLocked) walk.lockedAt = performance.now(); });
  $('walkBtn').onclick = () => walk.on ? stopWalk() : startWalk();

  if (location.hash === '#test') Object.assign(App, { _walk: walk, _cam: cam });

  /* picking: walk the ray through base voxels, fall back to the ground plane */
  function chunkAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
    const v = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
    const o = camera.position.clone(), d = v.sub(o).normalize();
    if (d.y > -1e-4) return null; const t = -o.y / d.y;
    return [App.chunkOf(Math.floor(o.x + d.x * t)), App.chunkOf(Math.floor(o.z + d.z * t))];
  }
  function rayOf(clientX, clientY) {
    const r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
    const v = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
    const o = camera.position.clone(); return { o, d: v.sub(o).normalize() };
  }
  function planeAt(clientX, clientY, y) { const { o, d } = rayOf(clientX, clientY); if (Math.abs(d.y) < 1e-4) return null; const t = (y - o.y) / d.y; return t > 0 ? { x: o.x + d.x * t, z: o.z + d.z * t } : null; }
  // first structure block along the ray ({x, y, z, s}), else the ground point
  function rayHit(clientX, clientY, structOnly) {
    const { o, d } = rayOf(clientX, clientY);
    if (insts().length && !App.pref('plan.hidden', false)) {
      let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
      const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1, tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
      let tx = (d.x > 0 ? (x + 1 - o.x) : (o.x - x)) * tdx, ty = (d.y > 0 ? (y + 1 - o.y) : (o.y - y)) * tdy, tz = (d.z > 0 ? (z + 1 - o.z) : (o.z - z)) * tdz;
      for (let i = 0; i < 3000; i++) {
        if (y >= 0 && y < 400) { const s = solidAt(x, y, z); if (s) return { x, y, z, s }; }
        if (tx < ty && tx < tz) { x += sx; tx += tdx; } else if (ty < tz) { y += sy; ty += tdy; } else { z += sz; tz += tdz; }
        if (y < -1 || Math.min(tx, ty, tz) > 2500) break;
      }
    }
    if (structOnly || d.y > -1e-4) return null;
    const t = -o.y / d.y; return { x: Math.floor(o.x + d.x * t), y: 0, z: Math.floor(o.z + d.z * t), s: null };
  }
  function pickAt(clientX, clientY, add) {
    const hit = rayHit(clientX, clientY, false);
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
    ['plApply', 'plCenter', 'placeRow', 'brushBtn', 'dragRow'].forEach(id => $(id).hidden = true);
    ['plSize', 'plCX', 'plCZ'].forEach(id => $(id).disabled = true);
    $('selInfo').insertAdjacentHTML('afterend', '<p class="note">Размечать чанки и ставить структуры могут модераторы. Ты можешь смотреть и выбирать чанки, чтобы прочитать задачу.</p>');
  }
  if (App.mode === 'server' && !CAN) App.every(async () => {
    const w = await App.api('GET', '/api/world'); if (JSON.stringify(w.plan) === JSON.stringify(P())) return;
    App.world.plan = w.plan; if (w.structdefs) App.world.structdefs = w.structdefs; const keep = [...sel]; refreshAll(); keep.forEach(k => sel.add(k)); colorGround(); renderSel();
  }, 60000);
  resize(); refreshAll(); overview();
})();
