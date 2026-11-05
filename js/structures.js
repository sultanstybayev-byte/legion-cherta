/* Structures: the library and the block editor (orbit view, first person, brush, selection, WorldEdit commands, schematics). */
(async function () {
  const { $, esc, fmt, uid } = App;
  await App.init();
  await App.load();
  App.mountShell('structs');
  const CAN = App.can('plan');
  const W = () => App.world, defs = () => W().structdefs, defOf = id => defs().find(d => d.id === id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const isModel = VX.isModel;
  const SYMS = { none: { n: 1, mirror: false, axis: 'x' }, mx: { n: 1, mirror: true, axis: 'x' }, mz: { n: 1, mirror: true, axis: 'z' }, mxz: { n: 2, mirror: true, axis: 'x' }, r4: { n: 4, mirror: false, axis: 'x' },
    r4m: { n: 4, mirror: true, axis: 'x' }, r6m: { n: 6, mirror: true, axis: 'x' }, r8m: { n: 8, mirror: true, axis: 'x' }, r9m: { n: 9, mirror: true, axis: 'x' } };
  const symKey = s => { if (!s || (s.n <= 1 && !s.mirror)) return 'none'; for (const [k, v] of Object.entries(SYMS)) if (v && v.n === s.n && v.mirror === !!s.mirror && (!v.mirror || v.axis === (s.axis || 'x'))) return k; return 'none'; };
  const symOf = d => { if (!d) return null; const s = d.sym || ((d.kind === 'temple' || d.kind === 'lotus') ? SYMS.r9m : null); return s && (s.n > 1 || s.mirror) ? s : null; };
  let cur = null, vox = null, dirty = false, saveTimer = 0, saving = false;
  const undoS = [], redoS = [];
  const sel = { p1: null, p2: null };
  let clip = null, tool = 'block';
  const slots = ['smooth_quartz', 'calcite', 'glass', 'polished_diorite', 'white_concrete', 'sea_lantern', 'stone_bricks', 'andesite', 'orange_concrete'].map(n => 'minecraft:' + n);
  let slot = 0; const block = () => slots[slot];
  const brush = { size: 1, mode: 'sphere' };
  const placed = id => W().plan.structures.filter(s => s.def === id).length;
  const deny = () => { App.toast(App.user ? 'Менять структуры могут модераторы.' : 'Войди через Telegram. Менять структуры могут модераторы.', 3500); return true; };

  /* ================= library list & properties ================= */
  if (!CAN) { $('addRow').hidden = true; $('edButtons').hidden = true; $('resetRow').hidden = true; $('schemIntoLbl').hidden = true; }
  function renderList() {
    $('defList').innerHTML = defs().map(d => `<div class="item" data-id="${esc(d.id)}" role="button" tabindex="0" ${d.id === cur ? 'style="background:var(--accent-soft)"' : ''}>
      <span style="width:18px;height:18px;border-radius:5px;background:${esc(d.color)}"></span><span class="t">${esc(d.name)}</span>
      <span class="c">${isModel(d) ? `модель${d.bw ? ` ${d.bw}×${d.h}×${d.bd}` : ''}${symKey(symOf(d)) !== 'none' ? ' · симметричная' : ''}` : `заготовка ${d.w}×${d.d} чанк.`}</span><span class="r">${placed(d.id) ? 'на платформе: ' + placed(d.id) : ''}</span></div>`).join('')
      || '<div class="empty">Структур пока нет.</div>';
  }
  function renderEditor() {
    const d = defOf(cur); $('editor').hidden = !d; $('toolsSec').hidden = !d || !isModel(d) || !CAN; $('weSec').hidden = !d || !isModel(d) || !CAN;
    if (!d) return;
    const model = isModel(d);
    $('edHead').textContent = d.name; $('dName').value = d.name; $('dColor').value = d.color || '#e07b2a'; $('dNote').value = d.note || '';
    $('dSym').value = symKey(symOf(d)); $('dSym').disabled = !CAN || !model; $('dSym').parentElement.hidden = !model;
    $('boxDims').hidden = model; $('toModel').hidden = model || !CAN; $('modelButtons').hidden = !model; $('resetRow').hidden = !model || !CAN;
    $('dKind').textContent = model ? (d.kind === 'voxel' ? 'Модель из блоков.' : 'Модель из блоков по образцу Храма Лотоса.') : 'Заготовка: на платформе это цветной блок нужного размера.';
    $('dW').value = d.w; $('dD').value = d.d; $('dH').value = d.h;
    ['dName', 'dColor', 'dNote', 'dW', 'dD', 'dH'].forEach(id => $(id).disabled = !CAN);
    $('dDel').textContent = 'Удалить'; delArm = 0; $('resetBtn').textContent = 'Сбросить правки'; resetArm = 0;
    $('restoreBtn').hidden = !d.backupV;
    $('resetNote').textContent = d.backupV ? `Есть копия от ${new Date(d.backupV).toLocaleString('ru-RU')}: «Вернуть правки» поменяет её местами с текущей моделью.` : (d.kind === 'voxel' ? 'Сброс очистит модель, но копия сохранится, и её можно вернуть.' : 'Сброс вернёт исходный храм, правки сохранятся в копии, и их можно вернуть.');
    renderInfo();
  }
  function renderInfo() {
    const d = defOf(cur); if (!d) return;
    $('dInfo').textContent = isModel(d) && vox ? `Размер ${vox.w}×${vox.h}×${vox.d} блоков (ширина × высота × глубина), блоков в модели: ${fmt(vox.count())}, видов блоков: ${vox.palette.length - 1}.` : '';
  }
  async function select(id) {
    if (dirty) await saveNow();
    cur = id; vox = null; undoS.length = redoS.length = 0; sel.p1 = sel.p2 = null; drawSel();
    renderList(); renderEditor(); await loadCurrent();
  }
  $('defList').addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it && it.dataset.id !== cur) select(it.dataset.id); });
  $('dSave').onclick = () => {
    const d = defOf(cur); if (!d || (!CAN && deny())) return;
    d.name = $('dName').value.trim() || 'Структура'; d.color = $('dColor').value; d.note = $('dNote').value.trim();
    if (!isModel(d)) { d.w = Math.min(32, Math.max(1, Math.round(+$('dW').value || 1))); d.d = Math.min(32, Math.max(1, Math.round(+$('dD').value || 1))); d.h = Math.min(320, Math.max(1, Math.round(+$('dH').value || 8))); }
    App.save('structdefs'); renderList(); renderEditor(); if (!isModel(d)) loadCurrent(); App.toast('Сохранено');
  };
  $('dSym').onchange = () => { const d = defOf(cur); if (!d) return; d.sym = SYMS[$('dSym').value] || SYMS.none; App.save('structdefs'); renderList(); App.toast(symOf(d) ? 'Симметрия включена: правки будут повторяться.' : 'Симметрия выключена'); };
  let delArm = 0;
  $('dDel').onclick = () => {
    const d = defOf(cur); if (!d) return; const n = placed(d.id);
    if (Date.now() - delArm > 3500) { delArm = Date.now(); $('dDel').textContent = n ? `Точно? Уберётся и с платформы (${n})` : 'Точно удалить?'; return; }
    W().structdefs = defs().filter(q => q.id !== d.id); VX.forget(d.id); dirty = false;
    if (n) { W().plan.structures = W().plan.structures.filter(s => s.def !== d.id); App.save('structures'); }
    App.save('structdefs'); select(defs()[0] ? defs()[0].id : null);
  };
  $('toModel').onclick = async () => {
    const d = defOf(cur); if (!d || (!CAN && deny())) return;
    const v = new VX.Vox(d.w * 16, Math.max(16, d.h), d.d * 16); d.kind = 'voxel'; d.sym = SYMS.none;
    await withBusy('Сохраняю модель…', async () => { await VX.saveModel(d, v); App.save('structdefs'); });
    renderList(); renderEditor(); loadCurrent();
  };
  // new structure
  document.querySelectorAll('dialog [data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  $('addDef').onclick = () => { if (!CAN && deny()) return; $('newDlg').showModal(); $('nName').select(); };
  $('nOk').onclick = async () => {
    const w = clampI($('nW').value, 4, 512, 32), d = clampI($('nD').value, 4, 512, 32), h = clampI($('nH').value, 4, 320, 32);
    const v = new VX.Vox(w, h, d); if ($('nBase').value === 'floor') { const st = v.id('minecraft:smooth_stone'); for (let z = v.z0; z < v.z0 + d; z++) for (let x = v.x0; x < v.x0 + w; x++) v.set(x, 0, z, st); }
    const def = { id: uid(), name: $('nName').value.trim() || 'Новая структура', kind: 'voxel', sym: SYMS[$('nSym').value] || SYMS.none, color: '#2e86c1', note: '', edits: [], zones: [], w: Math.ceil(w / 16), d: Math.ceil(d / 16), h };
    $('newDlg').close();
    await withBusy('Создаю…', async () => { await VX.saveModel(def, v); defs().push(def); App.save('structdefs'); });
    select(def.id);
  };
  const clampI = (v, lo, hi, dflt) => Math.min(hi, Math.max(lo, Math.round(+v || dflt)));
  // schematics
  $('schemFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || (!CAN && deny())) return;
    await withBusy('Читаю схематику…', async () => {
      const v = await VX.importFile(f);
      const def = { id: uid(), name: f.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Схематика', kind: 'voxel', sym: SYMS.none, color: '#2e86c1', note: `Загружено из ${f.name}`, edits: [], zones: [], w: Math.ceil(v.w / 16), d: Math.ceil(v.d / 16), h: v.h };
      await VX.saveModel(def, v); defs().push(def); App.save('structdefs');
      App.toast(`Загружено: ${v.w}×${v.h}×${v.d}, блоков ${fmt(v.count())}`, 5000); await select(def.id);
    });
  };
  $('schemInto').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; const d = defOf(cur); if (!f || !d || (!CAN && deny())) return;
    await withBusy('Читаю схематику…', async () => {
      const v = await VX.importFile(f);
      if (vox) await VX.saveBackup(d, vox);
      await VX.saveModel(d, v); App.save('structdefs'); vox = v; undoS.length = redoS.length = 0; rebuild(true); renderEditor(); renderList();
      App.toast('Модель заменена. Старая — в копии, её можно вернуть.', 5000);
    });
  };
  $('exportBtn').onclick = async () => {
    const d = defOf(cur); if (!d || !vox) return;
    await withBusy('Готовлю файл…', async () => {
      const bytes = await VX.exportSchem(vox), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); a.download = (d.name.replace(/[^\p{L}\p{N}_ -]+/gu, '').trim() || 'structure') + '.schem';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
    App.toast('Файл .schem: в игре — //schem load через WorldEdit, или открой в Litematica / Amulet.', 6000);
  };
  // reset with a backup, and restore (swaps backup and current)
  let resetArm = 0;
  $('resetBtn').onclick = async () => {
    const d = defOf(cur); if (!d || !vox || (!CAN && deny())) return;
    if (Date.now() - resetArm > 3500) { resetArm = Date.now(); $('resetBtn').textContent = 'Точно? Нажми ещё раз'; return; }
    await withBusy('Сбрасываю…', async () => {
      await flushSave(); await VX.saveBackup(d, vox);
      if (d.kind === 'temple' || d.kind === 'lotus') { d.dataV = 0; d.edits = []; VX.forget(d.id); vox = await VX.loadModel(d); }
      else { const v = new VX.Vox(vox.w, vox.h, vox.d, vox.x0, vox.z0); await VX.saveModel(d, v); vox = v; }
      App.save('structdefs'); undoS.length = redoS.length = 0; rebuild(true); renderEditor(); renderList();
    });
    App.toast('Сброшено. Правки лежат в копии — «Вернуть правки».', 5000);
  };
  $('restoreBtn').onclick = async () => {
    const d = defOf(cur); if (!d || (!CAN && deny())) return;
    await withBusy('Возвращаю правки…', async () => {
      await flushSave(); const back = await VX.loadBackup(d);
      if (vox) await VX.saveBackup(d, vox);
      await VX.saveModel(d, back); App.save('structdefs'); vox = back; undoS.length = redoS.length = 0; rebuild(true); renderEditor(); renderList();
    });
    App.toast('Правки вернулись. Прежняя модель теперь в копии.', 5000);
  };
  async function withBusy(title, fn) {
    $('busyTitle').textContent = title; $('busy').hidden = false;
    try { await new Promise(r => setTimeout(r, 30)); await fn(); } catch (e) { App.toast(e.message || String(e), 7000); console.error(e); } finally { $('busy').hidden = true; }
  }

  /* ================= saving ================= */
  function setState(t, warn) { $('saveState').textContent = t; $('saveState').classList.toggle('warn', !!warn); }
  function markDirty() { dirty = true; setState('есть изменения…', true); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 4000); }
  async function saveNow() {
    clearTimeout(saveTimer); const d = defOf(cur); if (!dirty || !d || !vox || saving) return;
    saving = true; setState('сохраняю…', true);
    try { const n = await VX.saveModel(d, vox); dirty = false; App.save('structdefs'); setState(`сохранено (${Math.max(1, Math.round(n / 1024))} КБ)`); renderInfo(); renderList(); }
    catch (e) { setState('не сохранено', true); App.toast(e.message, 7000); }
    finally { saving = false; }
  }
  async function flushSave() { while (saving) await new Promise(r => setTimeout(r, 100)); if (dirty) await saveNow(); }
  window.addEventListener('beforeunload', e => { if (dirty) { saveNow(); e.preventDefault(); e.returnValue = ''; } });

  /* ================= 3D ================= */
  if (!window.THREE) { $('stage').innerHTML = '<div class="banner"><h3>3D не загрузился</h3><p class="note">Не удалось загрузить three.js.</p></div>'; renderList(); return; }
  const canvas = $('view'), renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 6000); camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(0.6, 1, 0.35); scene.add(sun);
  const sun2 = new THREE.DirectionalLight(0xffffff, 0.16); sun2.position.set(-0.5, 0.4, -0.8); scene.add(sun2);
  const orbit = { th: 0.8, ph: 1.05, r: 200, tx: 0, ty: 20, tz: 0 };
  const fp = { on: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vy: 0, ground: false, fly: true, keys: new Set(), last: 0, raf: 0, locked: false };
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), geo = new THREE.BoxGeometry(1, 1, 1);
  function draw() {
    if (fp.on) { camera.position.set(fp.x, fp.y + 1.62, fp.z); camera.rotation.set(fp.pitch, fp.yaw, 0); }
    else { camera.position.set(orbit.tx + orbit.r * Math.sin(orbit.ph) * Math.cos(orbit.th), orbit.ty + orbit.r * Math.cos(orbit.ph), orbit.tz + orbit.r * Math.sin(orbit.ph) * Math.sin(orbit.th)); camera.lookAt(orbit.tx, orbit.ty, orbit.tz); }
    scene.background = new THREE.Color(css('--stage') || '#dbe1e5'); renderer.render(scene, camera);
  }
  let queued = false; const redraw = () => { if (queued || fp.on) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
  function resize() { const r = $('stage').getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); draw(); }
  new ResizeObserver(resize).observe($('stage'));
  window.addEventListener('themechange', redraw);

  /* palette lookups, extended as the palette grows */
  let pal = { n: 0, rgb: [], glass: [], solid: [], open: [] };
  function palInfo() {
    if (vox && pal.n === vox.palette.length) return pal;
    const P = vox ? vox.palette : [];
    pal = { n: P.length, rgb: P.map(VX.rgb), glass: P.map(VX.isTransparent), solid: P.map((n, i) => i > 0 && VX.isSolid(n)), open: P.map((n, i) => i === 0 || VX.isTransparent(n)) };
    return pal;
  }
  /* visible blocks as two instanced meshes (opaque, glass) that can be updated block by block */
  const view = { meshes: [null, null], pos: [null, null], n: [0, 0], cap: [0, 0], index: new Map() };
  function visible(x, y, z) {
    const v = vox.get(x, y, z); if (!v) return false; const p = palInfo(), o = q => q === 0 || (p.open[q] && q !== v);
    return o(vox.get(x + 1, y, z)) || o(vox.get(x - 1, y, z)) || o(vox.get(x, y + 1, z)) || o(vox.get(x, y - 1, z)) || o(vox.get(x, y, z + 1)) || o(vox.get(x, y, z - 1));
  }
  function rebuild(recenter) {
    hmDirty = true;
    for (const m of view.meshes) if (m) { scene.remove(m); m.material.dispose(); m.dispose(); }
    view.meshes = [null, null]; view.index.clear(); view.n = [0, 0];
    if (box) { scene.remove(box); box.traverse(x => { if (x.geometry && x.geometry !== geo) x.geometry.dispose(); if (x.material) x.material.dispose(); }); box = null; }
    const d = defOf(cur);
    if (!vox) { if (d && !isModel(d)) drawBox(d); drawGrid(); redraw(); return; }
    const s = VX.surface(vox), p = palInfo();
    for (const g of [0, 1]) {
      let cnt = 0; for (let i = 0; i < s.n; i++) if (s.glass[i] === g) cnt++;
      const cap = cnt + 30000, mat = g ? new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }) : new THREE.MeshLambertMaterial({ color: 0xffffff });
      const m = new THREE.InstancedMesh(geo, mat, cap); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); m.count = 0; m.renderOrder = g;
      view.meshes[g] = m; view.pos[g] = new Int16Array(cap * 3); view.cap[g] = cap; scene.add(m);
    }
    for (let i = 0; i < s.n; i++) addInst(s.glass[i], s.pos[3 * i], s.pos[3 * i + 1], s.pos[3 * i + 2]);
    for (const m of view.meshes) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    void p; drawGrid(); if (recenter) frame(); renderInfo(); redraw();
  }
  function addInst(g, x, y, z) {
    const m = view.meshes[g], i = view.n[g]++, p = palInfo(), rgb = p.rgb[vox.get(x, y, z)] || [1, 0, 1];
    tmpM.makeTranslation(x + .5, y + .5, z + .5); m.setMatrixAt(i, tmpM); m.instanceColor.setXYZ(i, rgb[0], rgb[1], rgb[2]);
    view.pos[g][3 * i] = x; view.pos[g][3 * i + 1] = y; view.pos[g][3 * i + 2] = z; view.index.set(x + ',' + y + ',' + z, g * 1e8 + i); m.count = view.n[g];
  }
  function removeInst(code) {
    const g = code >= 1e8 ? 1 : 0, i = code - g * 1e8, m = view.meshes[g], last = --view.n[g], P = view.pos[g];
    view.index.delete(P[3 * i] + ',' + P[3 * i + 1] + ',' + P[3 * i + 2]);
    if (i !== last) {
      m.instanceMatrix.array.copyWithin(i * 16, last * 16, last * 16 + 16); m.instanceColor.array.copyWithin(i * 3, last * 3, last * 3 + 3); P.copyWithin(3 * i, 3 * last, 3 * last + 3);
      view.index.set(P[3 * i] + ',' + P[3 * i + 1] + ',' + P[3 * i + 2], g * 1e8 + i);
    }
    m.count = view.n[g];
  }
  // refresh one block and its neighbours; false when a mesh is full (then rebuild)
  function touch(x, y, z) {
    const p = palInfo();
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = x + dx, b = y + dy, c = z + dz, code = view.index.get(a + ',' + b + ',' + c), want = visible(a, b, c), g = want ? (p.glass[vox.get(a, b, c)] ? 1 : 0) : -1;
      if (code !== undefined && (!want || (code >= 1e8 ? 1 : 0) !== g)) removeInst(code);
      if (want) { const k = view.index.get(a + ',' + b + ',' + c); if (k !== undefined) { const gi = k >= 1e8 ? 1 : 0, ii = k - gi * 1e8, rgb = p.rgb[vox.get(a, b, c)]; view.meshes[gi].instanceColor.setXYZ(ii, rgb[0], rgb[1], rgb[2]); }
        else { if (view.n[g] >= view.cap[g]) return false; addInst(g, a, b, c); } }
    }
    return true;
  }
  function flushView() { for (const m of view.meshes) if (m) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; } }
  // placeholder box for structures that are not block models yet
  let box = null;
  function drawBox(d) {
    const w = d.w * 16, dd = d.d * 16, h = d.h; box = new THREE.Group();
    const body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(d.color), transparent: true, opacity: .7 })); body.scale.set(w, h, dd); body.position.y = h / 2; box.add(body);
    scene.add(box); orbit.tx = 0; orbit.tz = 0; orbit.ty = h * .4; orbit.r = Math.max(w, dd, h) * 1.7 + 20;
  }
  // chunk grid and a ground plane (y = 0 is the top of the ground)
  let grid = null, groundPl = null;
  function drawGrid() {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); } if (groundPl) { scene.remove(groundPl); groundPl.geometry.dispose(); groundPl.material.dispose(); }
    const x0 = vox ? vox.x0 : -32, z0 = vox ? vox.z0 : -32, w = vox ? vox.w : 64, d = vox ? vox.d : 64;
    const [ox, oz] = gridOff(), cx0 = Math.floor((x0 - 16 + ox) / 16) * 16 - ox, cx1 = Math.ceil((x0 + w + 16 + ox) / 16) * 16 - ox, cz0 = Math.floor((z0 - 16 + oz) / 16) * 16 - oz, cz1 = Math.ceil((z0 + d + 16 + oz) / 16) * 16 - oz, pts = [];
    for (let x = cx0; x <= cx1; x += 16) pts.push(x, 0.02, cz0, x, 0.02, cz1);
    for (let z = cz0; z <= cz1; z += 16) pts.push(cx0, 0.02, z, cx1, 0.02, z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x777f86, transparent: true, opacity: .6 })); scene.add(grid);
    groundPl = new THREE.Mesh(new THREE.PlaneGeometry(cx1 - cx0, cz1 - cz0), new THREE.MeshLambertMaterial({ color: 0x8a9488, transparent: true, opacity: .35, depthWrite: false }));
    groundPl.rotation.x = -Math.PI / 2; groundPl.position.set((cx0 + cx1) / 2, -0.01, (cz0 + cz1) / 2); scene.add(groundPl);
    drawSurfGrid();
  }
  // chunk borders as on the platform: the structure's centre block (x 0, z 0) sits on block 8 of a chunk (plus its shift there)
  function gridOff() {
    const s = W().plan.structures.find(q => q.def === cur && !((q.rot || 0) % 2));
    return [(((8 + ((s && s.dx) || 0)) % 16) + 16) % 16, (((8 + ((s && s.dz) || 0)) % 16) + 16) % 16];
  }
  let surf = null, hmap = null, hmDirty = true;
  const topAt = (x, z) => { const i = x - vox.x0, k = z - vox.z0; return (i < 0 || k < 0 || i >= vox.w || k >= vox.d) ? 0 : hmap[k * vox.w + i]; };
  function drawSurfGrid() {
    if (surf) { scene.remove(surf); surf.geometry.dispose(); surf.material.dispose(); surf = null; }
    if (!vox || !$('surfOn').checked) { renderChunks(); redraw(); return; }
    if (hmDirty || !hmap || hmap.length !== vox.w * vox.d) { hmap = VX.heightMap(vox); hmDirty = false; }
    const [ox, oz] = gridOff(), pts = VX.chunkGridLines(topAt, vox.x0, vox.x0 + vox.w, vox.z0, vox.z0 + vox.d, ox, oz, 0.1);
    if (pts.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); surf = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(css('--accent') || '#e07b2a') })); surf.renderOrder = 4; scene.add(surf); }
    renderChunks(); redraw();
  }
  function renderChunks() {
    if (!vox) { $('chunkInfo').textContent = ''; return; }
    if (hmDirty || !hmap || hmap.length !== vox.w * vox.d) { hmap = VX.heightMap(vox); hmDirty = false; }
    const [ox, oz] = gridOff(), u = VX.chunksUsed(topAt, vox.x0, vox.x0 + vox.w, vox.z0, vox.z0 + vox.d, ox, oz);
    $('chunkInfo').textContent = u.n ? `Занимает чанков: ${u.n} (${u.cx1 - u.cx0 + 1}×${u.cz1 - u.cz0 + 1}). Центр модели — X 0, Z 0; сетка чанков — как на платформе.` : 'Пока пусто.';
  }
  let gridTimer = 0; const gridLater = () => { hmDirty = true; clearTimeout(gridTimer); gridTimer = setTimeout(drawSurfGrid, 600); };
  function frame() {
    if (!vox) return; const b = vox.bounds() || { x0: vox.x0, x1: vox.x0 + vox.w, y0: 0, y1: vox.h, z0: vox.z0, z1: vox.z0 + vox.d };
    orbit.tx = (b.x0 + b.x1 + 1) / 2; orbit.tz = (b.z0 + b.z1 + 1) / 2; orbit.ty = (b.y1 + 1) * 0.4; orbit.r = Math.max(b.x1 - b.x0, b.z1 - b.z0, (b.y1 + 1) * 1.2) * 1.6 + 20;
  }
  $('viewBtn').onclick = () => { if (fp.on) stopFP(); frame(); redraw(); };

  async function loadCurrent() {
    const d = defOf(cur); vox = null;
    if (!d) { rebuild(); return; }
    if (!isModel(d)) { rebuild(); renderEditor(); return; }
    $('busyTitle').textContent = 'Загружаю модель…'; $('busy').hidden = false;
    await new Promise(r => setTimeout(r, 30));
    try { const v = await VX.loadModel(d); if (cur !== d.id) return; vox = v ? v.clone() : null; }
    catch (e) { App.toast('Модель не загрузилась: ' + e.message, 6000); }
    finally { $('busy').hidden = true; }
    pal.n = -1; rebuild(true); renderEditor(); renderPalette(); setState(''); hud();
  }

  /* ================= changes: symmetry, growth, undo ================= */
  const symActive = () => $('symOn').checked && !!symOf(defOf(cur));
  // list: array of [x, y, z, name]; returns number of changed blocks
  function apply(list, label, opt) {
    if (!vox) return 0; if (!CAN) { deny(); return 0; }
    opt = opt || {};
    let items = list;
    if (symActive() && !opt.noSym) {
      const sym = symOf(defOf(cur)), out = new Map();
      for (const [x, y, z, name] of list) for (const [a, b, k, m] of VX.symImages(x, z, sym)) {
        let nm = name; if (k > 0) nm = VX.rotateName(nm, k); if (m) nm = VX.flipName(nm, sym.axis === 'z' ? 'z' : 'x');
        out.set(a + ',' + y + ',' + b, [a, y, b, nm]);
      }
      items = [...out.values()];
    }
    if (items.length > 4e6) { App.toast('Слишком большая операция (больше 4 млн блоков).', 5000); return 0; }
    // grow the box once if anything lands outside
    let gx0 = vox.x0, gx1 = vox.x0 + vox.w, gz0 = vox.z0, gz1 = vox.z0 + vox.d, gh = vox.h, grow = false;
    for (const [x, y, z, name] of items) { if (y < 0 || name === 'minecraft:air') continue; if (x < gx0) { gx0 = x - 4; grow = true; } if (x >= gx1) { gx1 = x + 5; grow = true; } if (z < gz0) { gz0 = z - 4; grow = true; } if (z >= gz1) { gz1 = z + 5; grow = true; } if (y >= gh) { gh = y + 5; grow = true; } }
    if (grow) { try { vox.resize(gx0, gz0, gx1 - gx0, gh, gz1 - gz0); } catch (e) { App.toast(e.message, 5000); return 0; } }
    const rec = []; const ids = new Map();
    for (const [x, y, z, name] of items) {
      if (!vox.inside(x, y, z)) continue;
      let id = ids.get(name); if (id === undefined) { id = vox.id(name); ids.set(name, id); }
      const old = vox.get(x, y, z); if (old === id) continue;
      vox.set(x, y, z, id); rec.push(x, y, z, old, id);
    }
    const n = rec.length / 5; if (!n) { if (grow) rebuild(); return 0; }
    undoS.push({ label, rec: Int32Array.from(rec) }); if (undoS.length > 60) undoS.shift(); redoS.length = 0;
    refreshAfter(rec, grow); markDirty(); return n;
  }
  function refreshAfter(rec, force) {
    gridLater();
    const n = rec.length / 5; let ok = !force && n < 6000;
    if (ok) { for (let i = 0; i < rec.length && ok; i += 5) ok = touch(rec[i], rec[i + 1], rec[i + 2]); }
    if (ok) { flushView(); redraw(); } else rebuild();
    renderInfo();
  }
  function undo(steps) {
    let done = 0; for (let s = 0; s < (steps || 1); s++) { const op = undoS.pop(); if (!op) break; const r = op.rec; for (let i = r.length - 5; i >= 0; i -= 5) vox.set(r[i], r[i + 1], r[i + 2], r[i + 3]); redoS.push(op); refreshAfter(r); done++; }
    if (done) markDirty(); return done;
  }
  function redo(steps) {
    let done = 0; for (let s = 0; s < (steps || 1); s++) { const op = redoS.pop(); if (!op) break; const r = op.rec; for (let i = 0; i < r.length; i += 5) vox.set(r[i], r[i + 1], r[i + 2], r[i + 4]); undoS.push(op); refreshAfter(r); done++; }
    if (done) markDirty(); return done;
  }
  $('undoBtn').onclick = () => { if (!undo()) App.toast('Нечего отменять', 1500); };
  $('redoBtn').onclick = () => { if (!redo()) App.toast('Нечего возвращать', 1500); };

  /* ================= aiming ================= */
  function rayFrom(o, d, maxT) {   // DDA through the model; hits the ground (y < 0) too
    let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    const st = d.map(v => v > 0 ? 1 : -1), td = d.map(v => Math.abs(1 / (v || 1e-12)));
    const t = [0, 1, 2].map(i => (d[i] > 0 ? (Math.floor(o[i]) + 1 - o[i]) : (o[i] - Math.floor(o[i]))) * td[i]);
    for (let i = 0; i < 6000; i++) {
      const px = x, py = y, pz = z; let tt;
      if (t[0] < t[1] && t[0] < t[2]) { tt = t[0]; x += st[0]; t[0] += td[0]; } else if (t[1] < t[2]) { tt = t[1]; y += st[1]; t[1] += td[1]; } else { tt = t[2]; z += st[2]; t[2] += td[2]; }
      if (tt > maxT) return null;
      if (y < 0) return { x, y, z, px, py, pz, ground: true };
      if (vox && vox.get(x, y, z)) return { x, y, z, px, py, pz };
    }
    return null;
  }
  function aimCenter() { const cp = Math.cos(fp.pitch); return rayFrom([fp.x, fp.y + 1.62, fp.z], [-Math.sin(fp.yaw) * cp, Math.sin(fp.pitch), -Math.cos(fp.yaw) * cp], 10); }
  function aimMouse(cx, cy) {
    const r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
    const v = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5).unproject(camera), o = camera.position.clone(), d = v.sub(o).normalize();
    return rayFrom([o.x, o.y, o.z], [d.x, d.y, d.z], 5000);
  }
  let aimBox = null;
  function showAim(a) {
    if (!aimBox) { aimBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)), new THREE.LineBasicMaterial({ color: 0x111111, depthTest: false })); aimBox.renderOrder = 9; scene.add(aimBox); }
    aimBox.visible = !!(a && !a.ground); if (aimBox.visible) aimBox.position.set(a.x + .5, a.y + .5, a.z + .5);
    if (aimBox.visible && tool === 'brush' && brush.size > 1) aimBox.scale.setScalar(brush.size * 2 - 1); else aimBox.scale.setScalar(1);
  }

  /* ================= tools ================= */
  function setTool(t) { tool = t; document.querySelectorAll('#toolSeg [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t))); $('brushOpts').hidden = t !== 'brush'; helpText(); hud(); }
  document.querySelectorAll('#toolSeg [data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('brushSize').onchange = e => { brush.size = +e.target.value; }; $('brushMode').onchange = e => { brush.mode = e.target.value; };
  function helpText() {
    $('toolHelp').innerHTML = tool === 'block' ? '<b>ЛКМ</b> — сломать блок, <b>ПКМ</b> — поставить выбранный, <b>колёсико-клик</b> — взять блок под прицелом.'
      : tool === 'brush' ? '<b>ЛКМ</b> (можно водить с зажатой) — кисть по режиму, <b>ПКМ</b> — стереть шаром. Размер 1 — один блок. В обзоре вращай камеру правой кнопкой.'
      : '<b>ЛКМ</b> — точка 1, <b>ПКМ</b> — точка 2. Дальше — кнопки WorldEdit или команды внизу.';
  }
  function sphereCells(cx, cy, cz, size) { const r = size - 0.5, R = Math.ceil(r), out = []; for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) if (dx * dx + dy * dy + dz * dz <= r * r) out.push([cx + dx, cy + dy, cz + dz]); return out; }
  function useTool(a, button) {
    if (!a) return; if (!CAN) { deny(); return; }
    if (button === 1) { if (!a.ground) { setSlotBlock(vox.name(a.x, a.y, a.z)); App.toast('Взят блок: ' + VX.label(block()), 1500); } return; }
    if (tool === 'select') { const p = a.ground ? [a.px, a.py, a.pz] : [a.x, a.y, a.z]; if (button === 0) sel.p1 = p; else sel.p2 = p; drawSel(); weLog(`точка ${button === 0 ? 1 : 2}: ${p.join(', ')}${selBox() ? ' · ' + selSize() : ''}`); return; }
    if (tool === 'block') {
      if (button === 0) { if (!a.ground) apply([[a.x, a.y, a.z, 'minecraft:air']], 'сломать'); }
      else { if (fp.on && blocksPlayer(a.px, a.py, a.pz)) return; apply([[a.px, a.py, a.pz, block()]], 'поставить'); }
      return;
    }
    if (tool === 'brush') {
      const c = a.ground ? [a.px, a.py, a.pz] : [a.x, a.y, a.z], cells = sphereCells(c[0], c[1], c[2], brush.size);
      if (button === 2 || brush.mode === 'erase') apply(cells.map(([x, y, z]) => [x, y, z, 'minecraft:air']), 'кисть: стереть');
      else if (brush.mode === 'paint') apply(cells.filter(([x, y, z]) => vox.get(x, y, z)).map(([x, y, z]) => [x, y, z, block()]), 'кисть: перекрасить');
      else apply(cells.map(([x, y, z]) => [x, y, z, block()]), 'кисть: шар');
    }
  }
  function blocksPlayer(x, y, z) { return x + 1 > fp.x - .3 && x < fp.x + .3 && z + 1 > fp.z - .3 && z < fp.z + .3 && y + 1 > fp.y && y < fp.y + 1.8; }

  /* hotbar & block picker */
  function setSlotBlock(name) { if (!name || name === 'minecraft:air') return; slots[slot] = name; renderHotbar(); $('blockSearch').value = ''; renderPalette(); }
  function renderHotbar() {
    $('hotbar').innerHTML = slots.map((n, i) => `<div class="slot${i === slot ? ' on' : ''}" data-slot="${i}" title="${esc(VX.label(n))}"><i style="background:${VX.colorOf(n)}${VX.isTransparent(n) ? ';opacity:.55' : ''}"></i><span>${i + 1}</span></div>`).join('') + `<div class="slotname">${esc(VX.label(block()))}</div>`;
  }
  $('hotbar').addEventListener('click', e => { const s = e.target.closest('[data-slot]'); if (s) { slot = +s.dataset.slot; renderHotbar(); } });
  function renderPalette() {
    const names = vox ? vox.palette.slice(1) : [];
    $('palette').innerHTML = names.slice(0, 60).map(n => `<button type="button" data-b="${esc(n)}" title="${esc(VX.label(n))}" aria-pressed="${n === block()}"><i style="background:${VX.colorOf(n)}"></i>${esc(VX.label(n).replace(/ \[.*$/, ''))}</button>`).join('') || '<span class="note">В модели пока нет блоков.</span>';
    $('blockList').innerHTML = [...new Set(VX.COMMON.concat(names))].map(n => `<option value="${esc(n.replace(/^minecraft:/, ''))}">${esc(VX.label(n))}</option>`).join('');
  }
  $('palette').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) setSlotBlock(b.dataset.b); });
  $('blockSearch').addEventListener('change', e => { const n = VX.normName(e.target.value); if (n) { setSlotBlock(n); App.toast('Блок в руке: ' + VX.label(n), 1800); } });

  /* selection box */
  let selMesh = null;
  const selBox = () => { if (!sel.p1 || !sel.p2) return null; const [a, b] = [sel.p1, sel.p2]; return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), z0: Math.min(a[2], b[2]), z1: Math.max(a[2], b[2]) }; };
  const selSize = () => { const s = selBox(); return s ? `${s.x1 - s.x0 + 1}×${s.y1 - s.y0 + 1}×${s.z1 - s.z0 + 1} = ${fmt((s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1) * (s.z1 - s.z0 + 1))} бл.` : ''; };
  function drawSel() {
    if (selMesh) { scene.remove(selMesh); selMesh.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); }); selMesh = null; }
    const g = new THREE.Group(), mk = (p, col) => { const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)), new THREE.LineBasicMaterial({ color: col, depthTest: false })); m.position.set(p[0] + .5, p[1] + .5, p[2] + .5); m.renderOrder = 8; g.add(m); };
    if (sel.p1) mk(sel.p1, 0xe74c3c); if (sel.p2) mk(sel.p2, 0x3498db);
    const s = selBox(); if (s) { const w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1, d = s.z1 - s.z0 + 1, m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + .04, h + .04, d + .04)), new THREE.LineBasicMaterial({ color: 0xf1c40f, depthTest: false })); m.position.set(s.x0 + w / 2, s.y0 + h / 2, s.z0 + d / 2); m.renderOrder = 8; g.add(m); }
    selMesh = g; scene.add(g); $('selInfo').textContent = s ? selSize() : (sel.p1 || sel.p2 ? 'нужна вторая точка' : ''); redraw();
  }

  /* ================= WorldEdit commands ================= */
  const logLines = [];
  function weLog(t) { logLines.push(t); while (logLines.length > 7) logLines.shift(); $('weLog').textContent = logLines.join('\n'); }
  const HELP = [
    '//pos1  //pos2 — точки выделения (куда смотришь / где стоишь)', '//desel — снять выделение   //size — размер', '//set <блок> — заполнить (можно: 70%stone,30%andesite)', '//replace [что] <чем> — заменить (без «что» — все блоки)',
    '//walls <блок> — стены   //faces <блок> — коробка   //hollow — пустая внутри', '//overlay <блок> — слой сверху на всём выделенном', '//copy  //cut  //paste — буфер (вставка в точку прицела или точку 1)',
    '//rotate 90|180|270 — повернуть буфер   //flip [x|z|y] — отразить буфер', '//stack [раз] [куда] — повторить выделение   //move [на] [куда] — сдвинуть',
    '//expand <n> [куда|vert]  //contract <n> [куда]  //shift <n> [куда]', '//sphere <блок> <r>  //hsphere — шар (пустой)   //cyl <блок> <r> [h]  //hcyl', '//pyramid <блок> <размер>  //hpyramid   //line <блок> — от точки 1 к 2',
    '//count <блок> — посчитать   //undo [n]  //redo [n]', 'куда: me (куда смотришь), up, down, north, south, east, west, left, right, back', '<блок>: stone, minecraft:glass, oak_stairs[facing=north]; без блока — блок в руке'];
  function parseBlock(s) { if (!s || s === 'hand' || s === '#') return block(); return VX.normName(s); }
  function parsePattern(s) {
    const parts = String(s || '').split(',').filter(Boolean); if (!parts.length) return () => block();
    const opts = parts.map(p => { const m = p.match(/^(\d+(?:\.\d+)?)%(.+)$/); return m ? [+m[1], parseBlock(m[2])] : [1, parseBlock(p)]; }), tot = opts.reduce((a, o) => a + o[0], 0);
    if (opts.length === 1) { const n = opts[0][1]; return () => n; }
    return () => { let r = Math.random() * tot; for (const o of opts) { if ((r -= o[0]) <= 0) return o[1]; } return opts[opts.length - 1][1]; };
  }
  function lookDir() {
    let fx, fy, fz; if (fp.on) { const cp = Math.cos(fp.pitch); fx = -Math.sin(fp.yaw) * cp; fy = Math.sin(fp.pitch); fz = -Math.cos(fp.yaw) * cp; }
    else { fx = orbit.tx - camera.position.x; fy = orbit.ty - camera.position.y; fz = orbit.tz - camera.position.z; const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l; }
    return [fx, fy, fz];
  }
  function dirVec(s) {
    s = String(s || 'me').toLowerCase(); const D = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], n: [0, 0, -1], north: [0, 0, -1], s: [0, 0, 1], south: [0, 0, 1], e: [1, 0, 0], east: [1, 0, 0], w: [-1, 0, 0], west: [-1, 0, 0], u: [0, 1, 0], up: [0, 1, 0], d: [0, -1, 0], down: [0, -1, 0] };
    if (D[s]) return D[s];
    const [fx, fy, fz] = lookDir(), hz = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0, 0] : [0, 0, Math.sign(fz)];
    const f = Math.abs(fy) > 0.78 ? [0, Math.sign(fy), 0] : hz;
    if (s === 'me' || s === 'f' || s === 'forward') return f;
    if (s === 'b' || s === 'back') return f.map(v => -v);
    if (s === 'l' || s === 'left') return [hz[2], 0, -hz[0]];
    if (s === 'r' || s === 'right') return [-hz[2], 0, hz[0]];
    throw new Error('Не понял направление: ' + s);
  }
  function needSel() { const s = selBox(); if (!s) throw new Error('Сначала выдели область: инструмент «Выделение», ЛКМ и ПКМ.'); return s; }
  function forSel(s, fn) { for (let y = s.y0; y <= s.y1; y++) for (let z = s.z0; z <= s.z1; z++) for (let x = s.x0; x <= s.x1; x++) fn(x, y, z); }
  function anchor() {   // where pastes and shapes go
    if (fp.on) { const a = aimCenter(); if (a) return [a.px, a.py, a.pz]; return [Math.floor(fp.x), Math.floor(fp.y), Math.floor(fp.z)]; }
    if (sel.p1) return sel.p1.slice(); throw new Error('Поставь точку 1 (инструмент «Выделение») или войди внутрь и посмотри, куда.');
  }
  const N = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  function run(line) {
    line = String(line || '').trim(); if (!line) return;
    const args = line.replace(/^\/+/, '').split(/\s+/), c = (args.shift() || '').toLowerCase();
    const res = m => { weLog('> ' + line + (m ? '\n  ' + m : '')); if (m) App.toast(m, 2500); };
    const did = (n, what) => res(`${what}: ${fmt(n)} бл.${symActive() ? ' (с симметрией)' : ''}`);
    switch (c) {
      case 'help': case '?': weLog(HELP.join('\n')); $('weLog').scrollTop = 0; logLines.length = 0; HELP.forEach(h => logLines.push(h)); return;
      case 'pos1': case 'hpos1': case 'pos2': case 'hpos2': {
        if (!fp.on) throw new Error('В обзоре точки ставятся мышью: инструмент «Выделение».');
        let p = [Math.floor(fp.x), Math.floor(fp.y), Math.floor(fp.z)];
        if (c.startsWith('h')) { const a = aimCenter(); if (!a) throw new Error('Не вижу блок под прицелом.'); p = a.ground ? [a.px, a.py, a.pz] : [a.x, a.y, a.z]; }
        if (c.endsWith('1')) sel.p1 = p; else sel.p2 = p; drawSel(); return res(`точка ${c.slice(-1)}: ${p.join(', ')}`);
      }
      case 'desel': case 'sel': sel.p1 = sel.p2 = null; drawSel(); return res('выделение снято');
      case 'size': { needSel(); return res(selSize()); }
      case 'set': { const s = needSel(), pat = parsePattern(args.join(',')), L = []; forSel(s, (x, y, z) => L.push([x, y, z, pat()])); return did(apply(L, '//set'), 'заполнено'); }
      case 'replace': case 'rep': {
        const s = needSel(); let from = null, to; if (args.length >= 2) { from = new Set(args[0].split(',').map(parseBlock)); to = parsePattern(args.slice(1).join(',')); } else to = parsePattern(args[0]);
        const L = []; forSel(s, (x, y, z) => { const v = vox.get(x, y, z), nm = vox.palette[v]; if (from ? from.has(nm) || (from.has(VX.normName(VX.baseName(nm)))) : v) L.push([x, y, z, to()]); }); return did(apply(L, '//replace'), 'заменено');
      }
      case 'walls': { const s = needSel(), pat = parsePattern(args.join(',')), L = []; forSel(s, (x, y, z) => { if (x === s.x0 || x === s.x1 || z === s.z0 || z === s.z1) L.push([x, y, z, pat()]); }); return did(apply(L, '//walls'), 'стены'); }
      case 'faces': case 'outline': { const s = needSel(), pat = parsePattern(args.join(',')), L = []; forSel(s, (x, y, z) => { if (x === s.x0 || x === s.x1 || z === s.z0 || z === s.z1 || y === s.y0 || y === s.y1) L.push([x, y, z, pat()]); }); return did(apply(L, '//faces'), 'коробка'); }
      case 'hollow': { const s = needSel(), L = []; forSel(s, (x, y, z) => { if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && y > s.y0 && y < s.y1 && vox.get(x, y, z)) L.push([x, y, z, 'minecraft:air']); }); return did(apply(L, '//hollow'), 'выдолблено'); }
      case 'overlay': { const s = needSel(), pat = parsePattern(args.join(',')), L = []; for (let z = s.z0; z <= s.z1; z++) for (let x = s.x0; x <= s.x1; x++) { for (let y = s.y1; y >= s.y0; y--) if (vox.get(x, y, z)) { L.push([x, y + 1, z, pat()]); break; } } return did(apply(L, '//overlay'), 'слой сверху'); }
      case 'count': { const s = needSel(), want = args.length ? new Set(args.join(',').split(',').map(parseBlock)) : null; let n = 0; forSel(s, (x, y, z) => { const v = vox.get(x, y, z); if (want ? want.has(vox.palette[v]) : v) n++; }); return res(`в выделении ${want ? [...want].map(VX.label).join(', ') : 'блоков'}: ${fmt(n)}`); }
      case 'copy': case 'cut': {
        const s = needSel(), w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1, d = s.z1 - s.z0 + 1, names = new Array(w * h * d); let k = 0;
        forSel(s, (x, y, z) => { names[k++] = vox.get(x, y, z) ? vox.name(x, y, z) : null; }); clip = { w, h, d, names };
        if (c === 'cut') { const L = []; forSel(s, (x, y, z) => { if (vox.get(x, y, z)) L.push([x, y, z, 'minecraft:air']); }); apply(L, '//cut', { noSym: true }); }
        return res(`в буфере ${w}×${h}×${d}${c === 'cut' ? ', вырезано' : ''}`);
      }
      case 'paste': {
        if (!clip) throw new Error('Буфер пуст: сначала //copy.'); const [ax, ay, az] = anchor(), L = []; let k = 0;
        for (let y = 0; y < clip.h; y++) for (let z = 0; z < clip.d; z++) for (let x = 0; x < clip.w; x++) { const n = clip.names[k++]; if (n) L.push([ax + x, ay + y, az + z, n]); }
        const n = apply(L, '//paste'); sel.p1 = [ax, ay, az]; sel.p2 = [ax + clip.w - 1, ay + clip.h - 1, az + clip.d - 1]; drawSel(); return did(n, 'вставлено');
      }
      case 'rotate': {
        if (!clip) throw new Error('Буфер пуст: сначала //copy.'); const q = ((Math.round((N(args[0]) ?? 90) / 90) % 4) + 4) % 4;
        for (let t = 0; t < q; t++) { const { w, h, d, names } = clip, out = new Array(w * h * d);   // clockwise: (x, z) -> (d-1-z, x)
          for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) { const nm = names[(y * d + z) * w + x]; out[(y * w + x) * d + (d - 1 - z)] = nm ? VX.rotateName(nm, 1) : null; }
          clip = { w: d, h, d: w, names: out }; }
        return res(`буфер повёрнут на ${q * 90}°`);
      }
      case 'flip': {
        if (!clip) throw new Error('Буфер пуст: сначала //copy.'); const dv = dirVec(args[0] || 'me'), ax = dv[1] ? 'y' : dv[0] ? 'x' : 'z', { w, h, d, names } = clip, out = new Array(w * h * d);
        for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) { const nm = names[(y * d + z) * w + x], X = ax === 'x' ? w - 1 - x : x, Y = ax === 'y' ? h - 1 - y : y, Z = ax === 'z' ? d - 1 - z : z; out[(Y * d + Z) * w + X] = nm ? VX.flipName(nm, ax) : null; }
        clip.names = out; return res(`буфер отражён по ${ax.toUpperCase()}`);
      }
      case 'stack': {
        const s = needSel(), times = Math.max(1, N(args[0]) ?? 1), dv = dirVec(args[1] || (N(args[0]) == null ? args[0] : 'me')), sz = [s.x1 - s.x0 + 1, s.y1 - s.y0 + 1, s.z1 - s.z0 + 1], L = [];
        for (let t = 1; t <= times; t++) forSel(s, (x, y, z) => { const v = vox.get(x, y, z); if (v) L.push([x + dv[0] * sz[0] * t, y + dv[1] * sz[1] * t, z + dv[2] * sz[2] * t, vox.palette[v]]); });
        return did(apply(L, '//stack'), `повторено ${times} раз`);
      }
      case 'move': {
        const s = needSel(), n = N(args[0]) ?? 1, dv = dirVec(args[1] || (N(args[0]) == null ? args[0] : 'me')), map = new Map();
        forSel(s, (x, y, z) => { if (vox.get(x, y, z)) map.set(x + ',' + y + ',' + z, [x, y, z, 'minecraft:air']); });
        forSel(s, (x, y, z) => { const v = vox.get(x, y, z); if (v) { const a = x + dv[0] * n, b = y + dv[1] * n, cc = z + dv[2] * n; map.set(a + ',' + b + ',' + cc, [a, b, cc, vox.palette[v]]); } });
        const cnt = apply([...map.values()], '//move'); sel.p1 = [s.x0 + dv[0] * n, s.y0 + dv[1] * n, s.z0 + dv[2] * n]; sel.p2 = [s.x1 + dv[0] * n, s.y1 + dv[1] * n, s.z1 + dv[2] * n]; drawSel(); return did(cnt, 'сдвинуто');
      }
      case 'expand': case 'contract': case 'shift': {
        const s = needSel(); if (args[0] === 'vert') { sel.p1 = [s.x0, 0, s.z0]; sel.p2 = [s.x1, Math.max(vox.h - 1, s.y1), s.z1]; drawSel(); return res(selSize()); }
        const n = N(args[0]) ?? 1, dv = dirVec(args[1] || 'me'), b = [[s.x0, s.y0, s.z0], [s.x1, s.y1, s.z1]];
        for (let i = 0; i < 3; i++) { if (!dv[i]) continue; const hi = dv[i] > 0 ? 1 : 0;
          if (c === 'expand') b[hi][i] += dv[i] * n; else if (c === 'contract') b[1 - hi][i] += dv[i] * n; else { b[0][i] += dv[i] * n; b[1][i] += dv[i] * n; } }
        sel.p1 = b[0]; sel.p2 = b[1]; drawSel(); return res(selSize());
      }
      case 'sphere': case 'hsphere': {
        const pat = parsePattern(args[0]), r = Math.max(1, +(args[1] || 5)), [cx, cy, cz] = anchor(), R = Math.ceil(r), L = [];
        for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) { const d2 = x * x + y * y + z * z; if (d2 > r * r) continue; if (c === 'hsphere' && d2 <= (r - 1) * (r - 1)) continue; L.push([cx + x, cy + y, cz + z, pat()]); }
        return did(apply(L, '//' + c), c === 'sphere' ? 'шар' : 'пустой шар');
      }
      case 'cyl': case 'hcyl': {
        const pat = parsePattern(args[0]), r = Math.max(1, +(args[1] || 5)), h = Math.max(1, N(args[2]) ?? 1), [cx, cy, cz] = anchor(), R = Math.ceil(r), L = [];
        for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) { const d2 = x * x + z * z; if (d2 > r * r) continue; if (c === 'hcyl' && d2 <= (r - 1) * (r - 1)) continue; for (let y = 0; y < h; y++) L.push([cx + x, cy + y, cz + z, pat()]); }
        return did(apply(L, '//' + c), 'цилиндр');
      }
      case 'pyramid': case 'hpyramid': {
        const pat = parsePattern(args[0]), size = Math.max(1, N(args[1]) ?? 5), [cx, cy, cz] = anchor(), L = [];
        for (let y = 0; y < size; y++) { const r = size - 1 - y; for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) { if (c === 'hpyramid' && Math.abs(x) < r && Math.abs(z) < r && y < size - 1 && y > 0) continue; L.push([cx + x, cy + y, cz + z, pat()]); } }
        return did(apply(L, '//' + c), 'пирамида');
      }
      case 'line': {
        if (!sel.p1 || !sel.p2) throw new Error('Нужны точки 1 и 2.'); const pat = parsePattern(args[0]), [a, b] = [sel.p1, sel.p2], n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])), L = [];
        for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; L.push([Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), pat()]); }
        return did(apply(L, '//line'), 'линия');
      }
      case 'undo': return res(`отменено шагов: ${undo(N(args[0]) || 1)}`);
      case 'redo': return res(`возвращено шагов: ${redo(N(args[0]) || 1)}`);
      default: throw new Error('Не знаю команду //' + c + '. Список: //help');
    }
  }
  function runSafe(line) { try { if (!vox) throw new Error('Выбери модель из блоков.'); if (!CAN && !/^\/*(help|size|count|pos|hpos|desel|sel)/.test(line.trim())) { deny(); return; } run(line); } catch (e) { weLog('> ' + line + '\n  ' + e.message); App.toast(e.message, 3500); } }
  // buttons fill the command line when the command needs more input
  document.querySelectorAll('[data-we]').forEach(b => b.onclick = () => {
    const c = b.dataset.we, bl = block().replace(/^minecraft:/, ''), ask = { '//replace': `//replace ${bl} air`, '//stack': '//stack 1 me', '//move': '//move 1 me', '//sphere': `//sphere ${bl} 5`, '//cyl': `//cyl ${bl} 5 3`, '//pyramid': `//pyramid ${bl} 6` };
    if (ask[c]) { $('cmd').value = ask[c]; $('cmd').focus(); $('cmd').setSelectionRange(ask[c].length, ask[c].length); App.toast('Поправь числа и нажми Enter', 2500); return; }
    runSafe(['//set', '//walls', '//faces', '//line', '//count'].includes(c) && c !== '//count' ? c + ' ' + bl : c);
  });
  let resumeFP = false;
  $('cmdForm').onsubmit = e => { e.preventDefault(); const v = $('cmd').value; $('cmd').value = ''; runSafe(v); if (resumeFP) { resumeFP = false; lockMouse(); canvas.focus(); } };
  $('cmd').addEventListener('keydown', e => { if (e.key === 'Escape') { $('cmd').blur(); if (resumeFP) { resumeFP = false; lockMouse(); } } e.stopPropagation(); });

  /* ================= input ================= */
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  let drag = null, stroke = null, hoverQ = false;
  canvas.addEventListener('pointerdown', e => {
    canvas.focus({ preventScroll: true });
    if (fp.on) {
      if (document.pointerLockElement !== canvas) { lockMouse(); return; }
      const a = aimCenter(); useTool(a, e.button);
      if (tool === 'brush' && e.button !== 1) { stroke = { button: e.button, last: a ? a.x + ',' + a.y + ',' + a.z : '', timer: setInterval(() => { const b = aimCenter(); const k = b ? b.x + ',' + b.y + ',' + b.z : ''; if (b && k !== stroke.last) { stroke.last = k; useTool(b, stroke.button); } }, 90) }; }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, b: e.button, moved: false, paint: tool === 'brush' && e.button === 0 && !!vox };
    if (drag.paint) { const a = aimMouse(e.clientX, e.clientY); drag.lastKey = a ? a.x + ',' + a.y + ',' + a.z : ''; useTool(a, 0); }
  });
  canvas.addEventListener('pointermove', e => {
    if (fp.on) return;
    if (!drag) { if (vox && !hoverQ) { hoverQ = true; const x = e.clientX, y = e.clientY; requestAnimationFrame(() => { hoverQ = false; if (drag || fp.on) return; const a = aimMouse(x, y); if (CAN) showAim(a); hoverInfo(a); redraw(); }); } return; }
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.paint) { const a = aimMouse(e.clientX, e.clientY), k = a ? a.x + ',' + a.y + ',' + a.z : ''; if (a && k !== drag.lastKey) { drag.lastKey = k; useTool(a, 0); } showAim(a); return; }
    if (drag.moved) { orbit.th += (e.clientX - drag.x) * 0.008; orbit.ph = Math.min(1.55, Math.max(0.05, orbit.ph - (e.clientY - drag.y) * 0.008)); redraw(); }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const up = e => {
    if (stroke) { clearInterval(stroke.timer); stroke = null; }
    if (!drag) return; const d = drag; drag = null;
    if (!d.moved && !d.paint && vox) useTool(aimMouse(e.clientX, e.clientY), d.b);
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', () => { drag = null; });
  window.addEventListener('pointerup', () => { if (stroke) { clearInterval(stroke.timer); stroke = null; } });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (fp.on) { slot = (slot + (e.deltaY > 0 ? 1 : -1) + 9) % 9; renderHotbar(); return; }
    orbit.r = Math.min(3000, Math.max(4, orbit.r * Math.pow(1.0015, e.deltaY))); redraw();
  }, { passive: false });
  // keyboard: shortcuts work unless typing in a field
  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };
  document.addEventListener('keydown', e => {
    if (typing()) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    if (/^Digit[1-9]$/.test(e.code)) { slot = +e.code.slice(5) - 1; renderHotbar(); return; }
    if (e.code === 'KeyB') return setTool('block'); if (e.code === 'KeyN') return setTool('brush'); if (e.code === 'KeyV') return setTool('select');
    if (e.code === 'KeyT' || e.key === '/') { e.preventDefault(); if (fp.on && document.pointerLockElement === canvas) { resumeFP = true; document.exitPointerLock(); } $('cmd').focus(); if (e.key === '/') $('cmd').value = '//'; return; }
    if (!fp.on) return;
    if (e.code === 'Escape') { stopFP(); return; }
    if (e.code === 'KeyF') { fp.fly = !fp.fly; fp.vy = 0; App.toast(fp.fly ? 'Полёт: Space — вверх, Shift — вниз' : 'Ходьба: Space — прыжок', 1800); return; }
    // sprint: hold R or double-tap W (Ctrl would make Ctrl+W, which closes the browser tab)
    if (e.code === 'KeyW' && !e.repeat) { const t = performance.now(); if (t - (fp.lastW || 0) < 300) fp.sprint = true; fp.lastW = t; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyC', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); fp.keys.add(e.code); }
  });
  document.addEventListener('keyup', e => { fp.keys.delete(e.code); if (e.code === 'KeyW') fp.sprint = false; });
  window.addEventListener('blur', () => fp.keys.clear());

  /* ================= first person ================= */
  function lockMouse() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
  const solidB = (x, y, z) => y < 0 || (!!vox && (() => { const v = vox.get(x, y, z); return v && palInfo().solid[v]; })());
  function hits(px, py, pz) {
    for (let x = Math.floor(px - .3); x <= Math.floor(px + .3 - 1e-6); x++) for (let z = Math.floor(pz - .3); z <= Math.floor(pz + .3 - 1e-6); z++)
      for (let y = Math.floor(py); y <= Math.floor(py + 1.8 - 1e-6); y++) if (solidB(x, y, z)) return true;
    return false;
  }
  function startFP() {
    if (!vox) { App.toast('Выбери модель из блоков', 2500); return; }
    fp.on = true; fp.fly = true; fp.vy = 0; fp.keys.clear();
    const b = vox.bounds() || { x0: 0, x1: 0, z1: 0 }; fp.x = (b.x0 + b.x1 + 1) / 2; fp.z = b.z1 + 6; fp.y = 0; fp.yaw = 0; fp.pitch = -0.1;
    while (hits(fp.x, fp.y, fp.z) && fp.y < 600) fp.y += 1;
    camera.fov = 70; camera.updateProjectionMatrix(); document.body.classList.add('walking');
    $('walkBtn').textContent = 'Выйти (Esc)'; $('walkBtn').setAttribute('aria-pressed', 'true'); hud();
    lockMouse(); canvas.focus(); fp.last = performance.now(); fp.raf = requestAnimationFrame(tickFP);
  }
  function stopFP() {
    if (!fp.on) return; fp.on = false; cancelAnimationFrame(fp.raf); fp.keys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    camera.fov = 50; camera.updateProjectionMatrix(); document.body.classList.remove('walking');
    $('walkBtn').textContent = 'Войти внутрь'; $('walkBtn').setAttribute('aria-pressed', 'false'); showAim(null); hud(); draw();
  }
  $('walkBtn').onclick = () => fp.on ? stopFP() : startFP();
  let lockedAt = 0;
  document.addEventListener('pointerlockchange', () => { fp.locked = document.pointerLockElement === canvas; if (fp.locked) lockedAt = performance.now(); hud(); });
  document.addEventListener('mousemove', e => {
    if (!fp.on || !fp.locked || performance.now() - lockedAt < 150 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
    fp.yaw -= e.movementX * 0.0022; fp.pitch = Math.min(1.55, Math.max(-1.55, fp.pitch - e.movementY * 0.0022));
  });
  function tickFP(now) {
    if (!fp.on) return;
    const dt = Math.min(0.05, (now - fp.last) / 1000); fp.last = now; const k = c => fp.keys.has(c);
    const f = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0), r = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const fast = k('KeyR') || fp.sprint, sp = fp.fly ? (fast ? 26 : 11) : (fast ? 5.6 : 4.3), sy = Math.sin(fp.yaw), cy = Math.cos(fp.yaw), len = Math.hypot(f, r) || 1;
    const vx = (-sy * f + cy * r) / len * sp, vz = (-cy * f - sy * r) / len * sp;
    if (fp.fly) fp.vy = ((k('Space') ? 1 : 0) - (k('ShiftLeft') || k('ShiftRight') || k('KeyC') ? 1 : 0)) * sp;
    else { if (k('Space') && fp.ground) { fp.vy = 8.6; fp.ground = false; } fp.vy = Math.max(-60, fp.vy - 28 * dt); }
    for (const [ax, v] of [['x', vx * dt], ['z', vz * dt]]) {
      if (!v) continue; const old = fp[ax]; fp[ax] += v;
      if (hits(fp.x, fp.y, fp.z)) { if (!fp.fly && fp.ground && !hits(fp.x, fp.y + 1.05, fp.z)) fp.y = Math.floor(fp.y + 1.05); else fp[ax] = old; }
    }
    const oy = fp.y; fp.y += fp.vy * dt; fp.ground = false;
    if (hits(fp.x, fp.y, fp.z)) { if (fp.vy < 0) { fp.y = Math.floor(fp.y) + 1; fp.ground = true; if (hits(fp.x, fp.y, fp.z)) fp.y = oy; } else fp.y = oy; fp.vy = 0; }
    if (CAN) showAim(aimCenter());
    draw(); hudPos(); fp.raf = requestAnimationFrame(tickFP);
  }
  function hud() {
    const t = { block: 'ЛКМ — сломать · ПКМ — поставить · колёсико-клик — взять блок', brush: 'ЛКМ — кисть (держи и води) · ПКМ — стереть', select: 'ЛКМ — точка 1 · ПКМ — точка 2' }[tool];
    $('hud').innerHTML = fp.on
      ? (fp.locked ? `<b>W</b><b>A</b><b>S</b><b>D</b> · <b>Space</b>/<b>Shift</b> вверх/вниз · <b>R</b> или двойное <b>W</b> — быстрее · <b>F</b> полёт/ходьба · ${t} · <b>1–9</b> блок · <b>T</b> или <b>/</b> — команда · <b>Esc</b> — выйти<br><span id="fpPos"></span>`
        : 'Мышь отпущена. <b>Кликни по 3D</b>, чтобы продолжить, или «Выйти».')
      : `Тяни мышью — вращать · колесо — приблизить · ${tool === 'brush' ? 'тяни левой — красить, правой — вращать' : t} · <b>B</b>/<b>N</b>/<b>V</b> — инструмент · <b>Ctrl+Z</b> — отменить · <b>/</b> — команда<br><span id="hoverPos"></span>`;
  }
  function hoverInfo(a) {
    const el = document.getElementById('hoverPos'); if (!el) return;
    if (!a) { el.textContent = ''; return; }
    const p = a.ground ? [a.px, 0, a.pz] : [a.x, a.y, a.z], [ox, oz] = gridOff();
    el.textContent = `под курсором: X ${p[0]} · Y ${p[1]} · Z ${p[2]} от центра · чанк ${Math.floor((p[0] + ox) / 16)}, ${Math.floor((p[2] + oz) / 16)}${a.ground ? '' : ' · ' + VX.label(vox.name(a.x, a.y, a.z))}`;
  }
  function hudPos() { const el = document.getElementById('fpPos'); if (el) { const [ox, oz] = gridOff(); el.textContent = `X ${Math.floor(fp.x)} · Y ${Math.floor(fp.y)} · Z ${Math.floor(fp.z)} от центра модели · чанк ${Math.floor((Math.floor(fp.x) + ox) / 16)}, ${Math.floor((Math.floor(fp.z) + oz) / 16)}${fp.fly ? ' · полёт' : ''}`; } }

  /* ================= start ================= */
  setTool('block'); renderHotbar(); helpText();
  $('surfOn').checked = App.pref('struct.surfGrid', true);
  $('surfOn').onchange = e => { App.setPref('struct.surfGrid', e.target.checked); drawSurfGrid(); };
  if (location.hash === '#test') Object.assign(App, { _ed: { fp, orbit, run: runSafe, get vox() { return vox; }, sel, apply, undo, redo, aimCenter, useTool, setTool, brush, saveNow, get dirty() { return dirty; }, select } });
  resize(); renderList();
  const first = defs().find(d => isModel(d)) || defs()[0]; if (first) await select(first.id); else renderEditor();
  weLog('Подсказка: //help — все команды WorldEdit.');
})();
