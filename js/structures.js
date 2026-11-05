/* Structure library: list, edit and preview the buildings that the planner places on the platform. */
(async function () {
  const { $, esc, fmt, uid, sgn } = App;
  await App.init();
  await App.load();
  App.mountShell('structs');
  const CAN = App.can('plan');
  const W = () => App.world, defs = () => W().structdefs;
  const MATS = { 1: '#8b8f8e', 2: '#dcdedb', 3: '#f3ede4', 4: '#e0782b', 5: '#bdbdc1', 6: '#3c68c9', 7: '#a9d9cf', 8: '#e9b85a', 9: '#e6edf0', 10: '#e9ebec' };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let cur = defs()[0] ? defs()[0].id : null;
  const placed = id => W().plan.structures.filter(s => s.def === id).length;

  /* ---------- list & editor ---------- */
  $('dScale').innerHTML = App.SCALES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  if (!CAN) { $('addRow').hidden = true; $('edButtons').hidden = true; }
  function renderList() {
    $('defList').innerHTML = defs().map(d => `<div class="item" data-id="${esc(d.id)}" role="button" tabindex="0" ${d.id === cur ? 'style="background:var(--accent-soft)"' : ''}>
      <span style="width:18px;height:18px;border-radius:5px;background:${esc(d.color)}"></span><span class="t">${esc(d.name)}</span>
      <span class="c">${d.kind === 'lotus' ? 'готовая модель' : `заготовка ${d.w}×${d.d} чанк., ${d.h} бл.`}</span><span class="r">${placed(d.id) ? 'на платформе: ' + placed(d.id) : ''}</span></div>`).join('')
      || '<div class="empty">Структур пока нет.</div>';
  }
  function renderEditor() {
    const d = defs().find(q => q.id === cur); $('editor').hidden = !d; if (!d) return;
    $('edHead').textContent = d.name; $('dName').value = d.name; $('dColor').value = d.color || '#e07b2a'; $('dNote').value = d.note || '';
    const lot = d.kind === 'lotus';
    $('boxDims').hidden = lot; $('lotusOpts').hidden = !lot; $('lotusOpts').style.display = lot ? 'flex' : 'none';
    $('dKind').textContent = lot ? 'Готовая модель из блоков. Размер задаётся масштабом.' : 'Заготовка: на платформе это цветной блок нужного размера. Модель сделаем позже.';
    $('dW').value = d.w; $('dD').value = d.d; $('dH').value = d.h; $('dScale').value = String(d.scale || 1);
    $('dEdits').textContent = (d.edits || []).length ? `Правки модели: ${fmt(d.edits.length)} блоков.` : 'Правок нет: исходная модель.';
    $('dDel').textContent = 'Удалить'; delArm = 0;
    ['dName', 'dColor', 'dNote', 'dW', 'dD', 'dH', 'dScale'].forEach(id => $(id).disabled = !CAN);
    ['importEdits', 'clearEdits'].forEach(id => $(id).hidden = !CAN);
  }
  function select(id) { cur = id; renderList(); renderEditor(); preview(); }
  $('defList').addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) select(it.dataset.id); });
  $('addDef').onclick = () => {
    const d = { id: uid(), name: 'Новая структура', kind: 'box', w: 2, d: 2, h: 12, color: '#2e86c1', note: '', scale: 1, edits: [] };
    defs().push(d); App.save('structdefs'); select(d.id); $('dName').focus(); $('dName').select();
  };
  $('dSave').onclick = () => {
    const d = defs().find(q => q.id === cur); if (!d) return;
    d.name = $('dName').value.trim() || 'Структура'; d.color = $('dColor').value; d.note = $('dNote').value.trim();
    if (d.kind === 'lotus') { const s = +$('dScale').value; if (s !== d.scale && (d.edits || []).length) App.toast('Правки сделаны для другого масштаба и могут лечь не туда.', 5000); d.scale = s; }
    else { d.w = Math.min(32, Math.max(1, Math.round(+$('dW').value || 1))); d.d = Math.min(32, Math.max(1, Math.round(+$('dD').value || 1))); d.h = Math.min(320, Math.max(1, Math.round(+$('dH').value || 8))); }
    App.save('structdefs'); renderList(); renderEditor(); preview(); App.toast('Структура сохранена');
  };
  let delArm = 0;
  $('dDel').onclick = () => {
    const d = defs().find(q => q.id === cur); if (!d) return; const n = placed(d.id);
    if (Date.now() - delArm > 3500) { delArm = Date.now(); $('dDel').textContent = n ? `Точно? Уберётся и с платформы (${n})` : 'Точно удалить?'; return; }
    W().structdefs = defs().filter(q => q.id !== d.id);
    if (n) { W().plan.structures = W().plan.structures.filter(s => s.def !== d.id); App.save('structures'); }
    App.save('structdefs'); cur = defs()[0] ? defs()[0].id : null; select(cur);
  };
  $('importEdits').onclick = () => { $('importText').value = ''; $('importMsg').textContent = ''; $('importDlg').showModal(); $('importText').focus(); };
  $('importDlg').querySelector('[data-close]').onclick = () => $('importDlg').close();
  $('importOk').onclick = () => {
    let j; try { j = JSON.parse($('importText').value); } catch (e) { $('importMsg').textContent = 'Не получилось прочитать текст. Скопируй его целиком ещё раз.'; return; }
    if (!j || j.kind !== 'lotus-base' || !Array.isArray(j.edits)) { $('importMsg').textContent = 'Это не данные модели. Нужна кнопка «Скопировать для планировщика» на странице «Лотос Легиона».'; return; }
    const d = defs().find(q => q.id === cur); if (!d) return;
    d.scale = [0.55, 0.75, 1].includes(+j.scale) ? +j.scale : 1; d.edits = j.edits.filter(e => Array.isArray(e) && e.length === 4 && e.every(Number.isFinite));
    App.save('structdefs'); $('importDlg').close(); renderEditor(); preview(); App.toast(`Правки применены: ${fmt(d.edits.length)} блоков`);
  };
  $('clearEdits').onclick = () => { const d = defs().find(q => q.id === cur); if (!d) return; d.edits = []; App.save('structdefs'); renderEditor(); preview(); };

  /* ---------- 3D preview with an orbit camera ---------- */
  if (!window.THREE) { $('stage').innerHTML = '<div class="banner"><h3>3D не загрузился</h3><p class="note">Не удалось загрузить three.js.</p></div>'; renderList(); renderEditor(); return; }
  const canvas = $('view'), renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(0.6, 1, 0.35); scene.add(sun);
  const orbit = { th: 0.8, ph: 1.05, r: 200, ty: 30 };
  let model = null, ground = null;
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), geo = new THREE.BoxGeometry(1, 1, 1);
  function draw() {
    camera.position.set(orbit.r * Math.sin(orbit.ph) * Math.cos(orbit.th), orbit.ty + orbit.r * Math.cos(orbit.ph), orbit.r * Math.sin(orbit.ph) * Math.sin(orbit.th));
    camera.lookAt(0, orbit.ty, 0); scene.background = new THREE.Color(css('--stage') || '#dbe1e5'); renderer.render(scene, camera);
  }
  function resize() { const r = $('stage').getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); draw(); }
  new ResizeObserver(resize).observe($('stage'));
  let drag = null;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', e => { if (!drag) return; orbit.th += (e.clientX - drag.x) * 0.008; orbit.ph = Math.min(1.5, Math.max(0.1, orbit.ph - (e.clientY - drag.y) * 0.008)); drag = { x: e.clientX, y: e.clientY }; draw(); });
  const up = () => { drag = null; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); orbit.r = Math.min(2000, Math.max(10, orbit.r * Math.pow(1.0015, e.deltaY))); draw(); }, { passive: false });
  window.addEventListener('themechange', draw);
  function clear() { for (const o of [model, ground]) if (o) { scene.remove(o); o.traverse(x => { if (x.geometry && x.geometry !== geo) x.geometry.dispose(); if (x.material) x.material.dispose(); }); } model = ground = null; }
  function preview() {
    clear(); const d = defs().find(q => q.id === cur); if (!d) { draw(); return; }
    const build = () => {
      let wBlocks, dBlocks, h;
      if (d.kind === 'lotus') {
        const L = generateLotus(d.scale || 1);
        for (const e of d.edits || []) if (Array.isArray(e) && e.length === 4) L.set(e[0] | 0, e[1] | 0, e[2] | 0, e[3] | 0);
        const N = L.N, list = [], occ = (x, y, z) => L.get(x, y, z) > 0;
        for (let y = 0; y < L.H; y++) for (let z = -N; z <= N; z++) for (let x = -N; x <= N; x++) {
          const m = L.get(x, y, z); if (!m) continue;
          if (occ(x + 1, y, z) && occ(x - 1, y, z) && occ(x, y + 1, z) && occ(x, y - 1, z) && occ(x, y, z + 1) && occ(x, y, z - 1)) continue;
          list.push(x, y, z, m);
        }
        const n = list.length / 4; model = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, n));
        for (let i = 0; i < n; i++) { tmpM.makeTranslation(list[4 * i] + .5, list[4 * i + 1] + .5, list[4 * i + 2] + .5); model.setMatrixAt(i, tmpM); model.setColorAt(i, tmpC.set(MATS[list[4 * i + 3]] || '#ddd')); }
        model.count = n; wBlocks = dBlocks = 2 * N + 1; h = L.H;
        $('dims').textContent = `${wBlocks}×${dBlocks} блоков, ${h} в высоту, ${fmt(n)} видимых блоков`;
      } else {
        wBlocks = d.w * 16; dBlocks = d.d * 16; h = d.h;
        model = new THREE.Group();
        const body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(d.color), transparent: true, opacity: .7 })); body.scale.set(wBlocks, h, dBlocks); body.position.y = h / 2; model.add(body);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(wBlocks, h, dBlocks)), new THREE.LineBasicMaterial({ color: new THREE.Color(d.color) })); edges.position.y = h / 2; model.add(edges);
        $('dims').textContent = `${d.w}×${d.d} чанков = ${wBlocks}×${dBlocks} блоков, ${h} в высоту`;
      }
      scene.add(model);
      // chunk grid under the structure
      const cw = Math.ceil(wBlocks / 16) + 2, cd = Math.ceil(dBlocks / 16) + 2, pts = [], x0 = -cw * 8, z0 = -cd * 8;
      for (let i = 0; i <= cw; i++) pts.push(x0 + i * 16, 0.02, z0, x0 + i * 16, 0.02, z0 + cd * 16);
      for (let j = 0; j <= cd; j++) pts.push(x0, 0.02, z0 + j * 16, x0 + cw * 16, 0.02, z0 + j * 16);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      ground = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x777f86, transparent: true, opacity: .6 })); scene.add(ground);
      const span = Math.max(wBlocks, dBlocks, h * 1.2); orbit.r = span * 1.7 + 20; orbit.ty = h * 0.4; draw(); $('busy').hidden = true;
    };
    if (d.kind === 'lotus') { $('busy').hidden = false; setTimeout(build, 30); } else build();
  }
  renderList(); renderEditor(); resize(); preview();
})();
