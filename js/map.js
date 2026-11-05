/* 2D world map: Leaflet in block units. Leaflet latitude = −Z (north is up), longitude = X. */
(async function () {
  const { $, sgn, fmt, esc, uid } = App;
  const CATS = {
    base:    { ru: 'База',            color: '#c0392b', g: 'Б' },
    home:    { ru: 'Постройка',       color: '#d35400', g: 'П' },
    village: { ru: 'Деревня',         color: '#b7950b', g: 'Д' },
    portal:  { ru: 'Портал',          color: '#7d3c98', g: 'О' },
    ore:     { ru: 'Ресурсы',         color: '#1f78b4', g: 'Р' },
    struct:  { ru: 'Структура',       color: '#5d6d7e', g: 'С' },
    danger:  { ru: 'Опасно',          color: '#2c3e50', g: '!' },
    other:   { ru: 'Другое',          color: '#16a085', g: '•' }
  };
  const DIMS = { overworld: 'Верхний мир', nether: 'Незер', end: 'Энд' };
  await App.load();
  App.mountTop('map');
  const W = () => App.world;
  let dim = 'overworld';

  const map = L.map('map', { crs: L.CRS.Simple, minZoom: -6, maxZoom: 5, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 100, attributionControl: false, zoomControl: false, preferCanvas: true });
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(map);
  const ll = (x, z) => L.latLng(-z, x);
  const xz = p => ({ x: p.lng, z: -p.lat });
  map.createPane('img').style.zIndex = 300;
  map.createPane('grid').style.zIndex = 350; map.getPane('grid').style.pointerEvents = 'none';
  map.createPane('plan').style.zIndex = 420;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ---------- grid ---------- */
  const Grid = L.GridLayer.extend({
    createTile(c) {
      const t = document.createElement('canvas'), s = this.getTileSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
      t.width = s.x * dpr; t.height = s.y * dpr; t.style.width = s.x + 'px'; t.style.height = s.y + 'px';
      const g = t.getContext('2d'); g.scale(dpr, dpr);
      const k = Math.pow(2, c.z);                      // pixels per block
      const x0 = c.x * s.x / k, z0 = c.y * s.y / k, x1 = x0 + s.x / k, z1 = z0 + s.y / k;
      const line = (step, color, w, alpha) => {
        g.strokeStyle = color; g.lineWidth = w; g.globalAlpha = alpha; g.beginPath();
        for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) { const p = Math.round((v - x0) * k) + .5; g.moveTo(p, 0); g.lineTo(p, s.y); }
        for (let v = Math.ceil(z0 / step) * step; v <= z1; v += step) { const p = Math.round((v - z0) * k) + .5; g.moveTo(0, p); g.lineTo(s.x, p); }
        g.stroke(); g.globalAlpha = 1;
      };
      const muted = css('--muted') || '#888', fg = css('--fg') || '#111', acc = css('--accent') || '#e07b2a';
      if (k >= 10) line(1, muted, 1, .15);
      if (k * 16 >= 11) line(16, muted, 1, k * 16 >= 30 ? .55 : .3);
      if (k * 512 >= 24) line(512, fg, 1.5, .5);
      // origin axes
      g.strokeStyle = acc; g.globalAlpha = .7; g.lineWidth = 1.5; g.beginPath();
      if (0 >= x0 && 0 <= x1) { const p = Math.round(-x0 * k) + .5; g.moveTo(p, 0); g.lineTo(p, s.y); }
      if (0 >= z0 && 0 <= z1) { const p = Math.round(-z0 * k) + .5; g.moveTo(0, p); g.lineTo(s.x, p); }
      g.stroke(); g.globalAlpha = 1;
      g.font = '11px "JetBrains Mono", monospace'; g.textBaseline = 'top'; g.fillStyle = fg; g.globalAlpha = .75;
      if (k * 16 >= 90) { for (let cx = Math.ceil(x0 / 16) * 16; cx < x1; cx += 16) for (let cz = Math.ceil(z0 / 16) * 16; cz < z1; cz += 16) g.fillText(`${cx / 16},${cz / 16}`, (cx - x0) * k + 3, (cz - z0) * k + 3); }
      else if (k * 512 >= 120) { for (let rx = Math.ceil(x0 / 512) * 512; rx < x1; rx += 512) for (let rz = Math.ceil(z0 / 512) * 512; rz < z1; rz += 512) g.fillText(`регион ${rx / 512},${rz / 512}`, (rx - x0) * k + 4, (rz - z0) * k + 4); }
      g.globalAlpha = 1;
      return t;
    }
  });
  const grid = new Grid({ pane: 'grid', tileSize: 256, minZoom: -6, maxZoom: 5, updateWhenZooming: false });
  grid.addTo(map);
  $('showGrid').onchange = e => e.target.checked ? grid.addTo(map) : grid.remove();
  const mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener && mq.addEventListener('change', () => grid.redraw());

  /* ---------- map image ---------- */
  const idb = {
    db: null,
    open() { return this.db || (this.db = new Promise((res, rej) => { const r = indexedDB.open('mcmap', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
    async get(k) { try { const db = await this.open(); return await new Promise(res => { const q = db.transaction('img').objectStore('img').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } },
    async put(k, v) { try { const db = await this.open(); await new Promise(res => { const t = db.transaction('img', 'readwrite'); t.objectStore('img').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) { } }
  };
  let imgLayer = null, imgSize = null, imgUrl = null;
  async function loadImage() {
    if (imgLayer) { imgLayer.remove(); imgLayer = null; } imgSize = null;
    if (imgUrl && imgUrl.startsWith('blob:')) URL.revokeObjectURL(imgUrl); imgUrl = null;
    const m = W().maps[dim];
    let src = m.image;
    if (src === 'local:') { const blob = await idb.get(dim); if (blob) src = URL.createObjectURL(blob); else src = ''; }
    if (!src) { $('noMap').hidden = dim !== 'overworld' || sessionStorageGet('noMapHidden'); renderImgForm(); return; }
    $('noMap').hidden = true;
    const im = new Image();
    im.onload = () => {
      imgSize = { w: im.naturalWidth, h: im.naturalHeight }; imgUrl = src; placeImage(); renderImgForm();
    };
    im.onerror = () => { App.toast('Не удалось загрузить картинку карты: ' + m.image, 5000); renderImgForm(); };
    im.src = src;
  }
  function placeImage() {
    if (!imgSize) return; const m = W().maps[dim];
    const b = L.latLngBounds(ll(m.x, m.z), ll(m.x + imgSize.w * m.bpp, m.z + imgSize.h * m.bpp));
    if (imgLayer) imgLayer.setBounds(b); else imgLayer = L.imageOverlay(imgUrl, b, { pane: 'img', interactive: false }).addTo(map);
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k) === '1'; } catch (e) { return false; } }
  $('noMapHide').onclick = () => { $('noMap').hidden = true; try { sessionStorage.setItem('noMapHidden', '1'); } catch (e) { } };
  function renderImgForm() {
    const m = W().maps[dim];
    $('mapDimName').textContent = DIMS[dim];
    $('imgPath').value = m.image === 'local:' ? '' : m.image; $('imgX').value = m.x; $('imgZ').value = m.z; $('imgBpp').value = m.bpp;
    $('mapInfo').innerHTML = imgSize
      ? `Картинка ${fmt(imgSize.w)}×${fmt(imgSize.h)} пикс. покрывает X ${sgn(m.x)}…${sgn(Math.round(m.x + imgSize.w * m.bpp))}, Z ${sgn(m.z)}…${sgn(Math.round(m.z + imgSize.h * m.bpp))}.${m.image === 'local:' ? ' Открыта с компьютера, другие её не видят.' : ''}`
      : 'Картинка не задана. Карта показывает сетку, метки и план.';
  }
  $('imgApply').onclick = () => {
    const m = W().maps[dim], p = $('imgPath').value.trim();
    if (p) m.image = p; else if (m.image !== 'local:') m.image = '';
    m.x = Math.round(+$('imgX').value || 0); m.z = Math.round(+$('imgZ').value || 0); m.bpp = Math.max(0.0625, +$('imgBpp').value || 1);
    App.save('map'); loadImage();
  };
  $('imgLocal').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    await idb.put(dim, f); W().maps[dim].image = 'local:'; App.save('map'); await loadImage(); e.target.value = '';
    App.toast('Картинка открыта. Если она стоит не на месте, привяжи её по двум точкам.', 4500);
  };

  /* calibration by two known points */
  let calib = null;
  $('calibBtn').onclick = () => {
    if (!imgSize) { App.toast('Сначала добавь картинку карты'); return; }
    calib = { pts: [] }; showCalib();
  };
  function showCalib(clicked) {
    const box = $('calibBox'); box.hidden = false;
    const n = calib.pts.length;
    if (!clicked) {
      box.innerHTML = `<h3>Привязка: точка ${n + 1} из 2</h3><p class="note">Кликни по месту на картинке, настоящие координаты которого знаешь: угол дома, портал, центр деревни. ${n === 1 ? 'Вторую точку выбирай подальше от первой.' : ''}</p><div class="row" style="margin-top:8px"><button class="btn sm" id="calibCancel">Отмена</button></div>`;
    } else {
      box.innerHTML = `<h3>Точка ${n + 1}: какие у неё координаты в игре?</h3><div class="row" style="margin-top:6px"><label class="f grow">X<input type="number" id="cX" step="1"></label><label class="f grow">Z<input type="number" id="cZ" step="1"></label></div><div class="row" style="margin-top:8px"><button class="btn sm primary" id="calibOk">${n === 0 ? 'Дальше' : 'Привязать'}</button><button class="btn sm" id="calibCancel">Отмена</button></div>`;
      $('cX').focus();
      $('calibOk').onclick = () => {
        const tx = +$('cX').value, tz = +$('cZ').value; if (!isFinite(tx) || !isFinite(tz) || $('cX').value === '' || $('cZ').value === '') { App.toast('Впиши X и Z'); return; }
        calib.pts.push({ px: clicked.px, pz: clicked.pz, tx, tz });
        if (calib.pts.length < 2) { showCalib(); return; }
        const [a, b] = calib.pts, dpx = b.px - a.px, dpz = b.pz - a.pz, est = [];
        if (Math.abs(dpx) >= 8) est.push((b.tx - a.tx) / dpx);
        if (Math.abs(dpz) >= 8) est.push((b.tz - a.tz) / dpz);
        const bpp = est.length ? est.reduce((s, v) => s + v, 0) / est.length : 0;
        if (!(bpp > 0.01)) { App.toast('Точки слишком близко или координаты перепутаны. Попробуй ещё раз.', 5000); calib = null; $('calibBox').hidden = true; return; }
        const m = W().maps[dim]; m.bpp = +bpp.toFixed(4); m.x = Math.round(a.tx - a.px * m.bpp); m.z = Math.round(a.tz - a.pz * m.bpp);
        App.save('map'); placeImage(); renderImgForm(); calib = null; $('calibBox').hidden = true;
        App.toast(`Картинка привязана: ${m.bpp} блока в пикселе`, 4000);
      };
    }
    $('calibCancel').onclick = () => { calib = null; box.hidden = true; };
  }

  /* ---------- markers ---------- */
  $('mCat').innerHTML = Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.ru}</option>`).join('');
  const hiddenCats = new Set();
  $('catFilter').innerHTML = Object.entries(CATS).map(([k, c]) => `<label class="chip"><input type="checkbox" data-cat="${k}" checked><span class="dot" style="background:${c.color}"></span>${c.ru}</label>`).join('');
  $('catFilter').addEventListener('change', e => { const k = e.target.dataset.cat; if (!k) return; e.target.checked ? hiddenCats.delete(k) : hiddenCats.add(k); renderMarkers(); });
  $('search').addEventListener('input', () => renderMarkers());
  const layer = L.layerGroup().addTo(map);
  const icon = cat => { const c = CATS[cat] || CATS.other; return L.divIcon({ className: '', html: `<div class="mk" style="background:${c.color}"><span>${c.g}</span></div>`, iconSize: [28, 28], iconAnchor: [14, 30], popupAnchor: [0, -28] }); };
  const visible = () => { const q = $('search').value.trim().toLowerCase(); return W().markers.filter(m => (m.dim || 'overworld') === dim && !hiddenCats.has(m.cat) && (!q || (m.name + ' ' + (m.note || '')).toLowerCase().includes(q))); };
  const otherDim = m => {
    if ((m.dim || 'overworld') === 'overworld') return `В Незере: X ${sgn(Math.floor(m.x / 8))}, Z ${sgn(Math.floor(m.z / 8))}`;
    if (m.dim === 'nether') return `В верхнем мире: X ${sgn(m.x * 8)}, Z ${sgn(m.z * 8)}`;
    return '';
  };
  const coordText = m => `${m.x} ${m.y ?? '~'} ${m.z}`;
  function popupHtml(m) {
    const c = CATS[m.cat] || CATS.other;
    return `<h4>${esc(m.name || 'Без названия')}</h4><p class="note">${c.ru} · ${DIMS[m.dim || 'overworld']}</p>
      <p class="mono">X ${sgn(m.x)} · Y ${m.y ?? '—'} · Z ${sgn(m.z)}<br>чанк ${sgn(App.chunkOf(m.x))}, ${sgn(App.chunkOf(m.z))}</p>
      ${otherDim(m) ? `<p class="note mono">${otherDim(m)}</p>` : ''}
      ${m.note ? `<p>${esc(m.note).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="copy" data-id="${m.id}">Координаты</button><button class="btn sm" data-act="tp" data-id="${m.id}">/tp</button><button class="btn sm" data-act="edit" data-id="${m.id}">Изменить</button></div>`;
  }
  const mkById = new Map();
  function renderMarkers() {
    layer.clearLayers(); mkById.clear();
    const vis = visible();
    for (const m of vis) { const mk = L.marker(ll(m.x + 0.5, m.z + 0.5), { icon: icon(m.cat), title: m.name, keyboard: true }).bindPopup(() => popupHtml(m)); mk.addTo(layer); mkById.set(m.id, mk); }
    const all = W().markers.filter(m => (m.dim || 'overworld') === dim).length;
    $('mCount').textContent = vis.length === all ? `${all}` : `${vis.length} из ${all}`;
    $('mList').innerHTML = vis.length ? vis.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru')).map(m => {
      const c = CATS[m.cat] || CATS.other;
      return `<div class="item" role="button" tabindex="0" data-id="${m.id}"><span class="pin" style="background:${c.color}"></span><span class="t">${esc(m.name || 'Без названия')}</span><span class="c">${sgn(m.x)} ${m.y ?? '~'} ${sgn(m.z)}</span><span class="r">${c.ru}</span></div>`;
    }).join('') : `<div class="empty">${all ? 'Ничего не найдено. Проверь поиск и фильтры.' : 'Меток пока нет. Нажми «+ Метка» или кликни по карте правой кнопкой.'}</div>`;
  }
  $('mList').addEventListener('click', e => { const it = e.target.closest('.item'); if (it) focusMarker(it.dataset.id); });
  $('mList').addEventListener('keydown', e => { if (e.key === 'Enter') { const it = e.target.closest('.item'); if (it) focusMarker(it.dataset.id); } });
  function focusMarker(id) { const m = W().markers.find(q => q.id === id); if (!m) return; map.flyTo(ll(m.x + .5, m.z + .5), Math.max(map.getZoom(), 1), { duration: .6 }); setTimeout(() => { const mk = mkById.get(id); mk && mk.openPopup(); }, 650); }
  map.on('popupopen', e => {
    const el = e.popup.getElement(); if (!el) return;
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const m = W().markers.find(q => q.id === b.dataset.id); if (!m) return;
      if (b.dataset.act === 'copy') App.copy(coordText(m));
      if (b.dataset.act === 'tp') App.copy(`/tp @s ${m.x} ${m.y ?? '~'} ${m.z}`);
      if (b.dataset.act === 'edit') { map.closePopup(); openForm(m); }
      if (b.dataset.act === 'here') { map.closePopup(); openForm(null, +b.dataset.x, +b.dataset.z); }
      if (b.dataset.act === 'copyxz') App.copy(`${b.dataset.x} ~ ${b.dataset.z}`);
      if (b.dataset.act === 'measure') { map.closePopup(); startMeasure(+b.dataset.x, +b.dataset.z); }
    });
  });

  /* form */
  let editing = null, draft = null;
  const draftLayer = L.layerGroup().addTo(map);
  function openForm(m, x, z) {
    editing = m ? m.id : null;
    $('formSec').hidden = false; $('formTitle').textContent = m ? 'Изменить метку' : 'Новая метка';
    $('mName').value = m ? m.name : ''; $('mCat').value = m ? m.cat : 'other';
    const c = map.getCenter();
    $('mX').value = m ? m.x : (x ?? Math.floor(c.lng)); $('mZ').value = m ? m.z : (z ?? Math.floor(-c.lat)); $('mY').value = m && m.y != null ? m.y : '';
    $('mNote').value = m ? (m.note || '') : ''; $('mDelete').hidden = !m; $('mDelete').textContent = 'Удалить'; delArm = 0;
    updateDraft(); $('formSec').scrollIntoView({ block: 'nearest' }); $('mName').focus();
  }
  function closeForm() { editing = null; $('formSec').hidden = true; draftLayer.clearLayers(); draft = null; }
  function updateDraft() {
    draftLayer.clearLayers();
    const x = Math.floor(+$('mX').value), z = Math.floor(+$('mZ').value); if (!isFinite(x) || !isFinite(z)) return;
    draft = L.marker(ll(x + .5, z + .5), { icon: icon($('mCat').value), opacity: .75, draggable: true }).addTo(draftLayer);
    draft.on('dragend', () => { const p = xz(draft.getLatLng()); $('mX').value = Math.floor(p.x); $('mZ').value = Math.floor(p.z); });
  }
  ['mX', 'mZ', 'mCat'].forEach(id => $(id).addEventListener('input', updateDraft));
  $('addBtn').onclick = () => openForm(null);
  $('mCancel').onclick = closeForm;
  $('mSave').onclick = () => {
    const x = Math.floor(+$('mX').value), z = Math.floor(+$('mZ').value), yv = $('mY').value.trim();
    if ($('mX').value === '' || $('mZ').value === '' || !isFinite(x) || !isFinite(z)) { App.toast('Укажи X и Z или кликни по карте'); return; }
    const rec = { name: $('mName').value.trim() || 'Без названия', cat: $('mCat').value, x, y: yv === '' ? null : Math.floor(+yv), z, dim, note: $('mNote').value.trim() };
    if (editing) Object.assign(W().markers.find(m => m.id === editing), rec);
    else W().markers.push(Object.assign({ id: uid(), created: Date.now() }, rec));
    App.save('markers'); closeForm(); renderMarkers(); App.toast('Метка сохранена');
  };
  let delArm = 0;
  $('mDelete').onclick = () => {
    if (Date.now() - delArm > 3000) { delArm = Date.now(); $('mDelete').textContent = 'Точно удалить?'; return; }
    W().markers = W().markers.filter(m => m.id !== editing); App.save('markers'); closeForm(); renderMarkers(); App.toast('Метка удалена');
  };

  /* ---------- plan overlay ---------- */
  const planLayer = L.layerGroup().addTo(map);
  const rend = L.canvas({ pane: 'plan', padding: .5 });
  function renderPlan() {
    planLayer.clearLayers(); if (!$('showPlan').checked || dim !== 'overworld') return;
    const P = W().plan, pl = P.platform, acc = css('--accent') || '#e07b2a';
    const rect = (x0, z0, x1, z1, o) => L.rectangle([ll(x0, z0), ll(x1, z1)], Object.assign({ renderer: rend, pane: 'plan' }, o)).addTo(planLayer);
    rect(pl.cx0 * 16, pl.cz0 * 16, (pl.cx0 + pl.size) * 16, (pl.cz0 + pl.size) * 16, { color: acc, weight: 2, dashArray: '6 6', fill: false, interactive: false });
    for (const t of P.tasks) for (const [cx, cz] of t.chunks) rect(cx * 16, cz * 16, cx * 16 + 16, cz * 16 + 16, { color: t.color, weight: 1, fillColor: t.color, fillOpacity: .35 }).bindTooltip(`<b>${esc(t.name)}</b><br>чанк ${sgn(cx)}, ${sgn(cz)}`, { className: 'chunk-tip', sticky: true });
    if (P.base.placed) {
      const N = App.BASE_N[String(P.base.scale)] || 73, cx = P.base.cx * 16 + 8, cz = P.base.cz * 16 + 8;
      rect(cx - N, cz - N, cx + N + 1, cz + N + 1, { color: acc, weight: 2, fillColor: acc, fillOpacity: .12 }).bindTooltip(`<b>Лотос Легиона</b><br>центр X ${sgn(cx)}, Z ${sgn(cz)}`, { className: 'chunk-tip', sticky: true });
      L.circleMarker(ll(cx + .5, cz + .5), { renderer: rend, pane: 'plan', radius: 4, color: acc, fillColor: acc, fillOpacity: 1, interactive: false }).addTo(planLayer);
    }
  }
  $('showPlan').onchange = renderPlan;

  /* ---------- interactions ---------- */
  const hud = $('hud');
  map.on('mousemove', e => {
    const p = xz(e.latlng), x = Math.floor(p.x), z = Math.floor(p.z), cx = App.chunkOf(x), cz = App.chunkOf(z);
    const other = dim === 'overworld' ? `Незер ${sgn(Math.floor(x / 8))}, ${sgn(Math.floor(z / 8))}` : dim === 'nether' ? `Верх. мир ${sgn(x * 8)}, ${sgn(z * 8)}` : '';
    hud.innerHTML = `X <b>${sgn(x)}</b> Z <b>${sgn(z)}</b> · чанк ${sgn(cx)}, ${sgn(cz)} (внутри ${((x % 16) + 16) % 16}, ${((z % 16) + 16) % 16}) · регион ${Math.floor(x / 512)}, ${Math.floor(z / 512)}${other ? ' · ' + other : ''}${measure ? ' · ' + measureText() : ''}`;
  });
  map.on('click', e => {
    const p = xz(e.latlng), x = Math.floor(p.x), z = Math.floor(p.z);
    if (calib) { const m = W().maps[dim]; showCalib({ px: (p.x - m.x) / m.bpp, pz: (p.z - m.z) / m.bpp }); return; }
    if (measure) { measure.pts.push(L.latLng(-(z + .5), x + .5)); measure.line.setLatLngs(measure.pts); App.toast(measureText()); return; }
    if (!$('formSec').hidden) { $('mX').value = x; $('mZ').value = z; updateDraft(); }
  });
  map.on('contextmenu', e => {
    const p = xz(e.latlng), x = Math.floor(p.x), z = Math.floor(p.z);
    L.popup({ closeButton: false }).setLatLng(e.latlng).setContent(`<div class="ctx"><p class="mono" style="margin:0 0 4px">X ${sgn(x)} · Z ${sgn(z)}</p>
      <button class="btn sm" data-act="here" data-x="${x}" data-z="${z}">Поставить метку здесь</button>
      <button class="btn sm" data-act="copyxz" data-x="${x}" data-z="${z}">Копировать координаты</button>
      <button class="btn sm" data-act="measure" data-x="${x}" data-z="${z}">Измерить отсюда</button></div>`).openOn(map);
  });

  /* measure */
  let measure = null;
  const measureText = () => { if (!measure || measure.pts.length < 2) return 'кликай по точкам маршрута'; let d = 0; for (let i = 1; i < measure.pts.length; i++) { const a = measure.pts[i - 1], b = measure.pts[i]; d += Math.hypot(a.lng - b.lng, a.lat - b.lat); } return `путь ${fmt(Math.round(d))} бл. (по Незеру ≈ ${fmt(Math.round(d / 8))})`; };
  function startMeasure(x, z) {
    stopMeasure(); measure = { pts: [], line: L.polyline([], { color: css('--accent') || '#e07b2a', weight: 3, dashArray: '4 6' }).addTo(map) };
    if (x != null) { measure.pts.push(L.latLng(-(z + .5), x + .5)); measure.line.setLatLngs(measure.pts); }
    $('measureBtn').setAttribute('aria-pressed', 'true'); $('measureBtn').textContent = 'Линейка: выключить';
  }
  function stopMeasure() { if (measure) { measure.line.remove(); measure = null; } $('measureBtn').setAttribute('aria-pressed', 'false'); $('measureBtn').textContent = 'Линейка'; }
  $('measureBtn').onclick = () => measure ? stopMeasure() : (startMeasure(), App.toast('Кликай по точкам маршрута. Выключить — эта же кнопка или Esc.'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (measure) stopMeasure(); if (calib) { calib = null; $('calibBox').hidden = true; } } });
  $('centerBtn').onclick = () => map.flyTo(ll(0, 0), Math.max(map.getZoom(), -1), { duration: .6 });

  /* go to */
  function goto() {
    const n = ($('goto').value.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    if (n.length < 2) { App.toast('Впиши X и Z, например: 120 -340'); return; }
    const x = n[0], z = n.length >= 3 ? n[2] : n[1];
    map.flyTo(ll(x + .5, z + .5), Math.max(map.getZoom(), 1), { duration: .6 });
    const tmp = L.circleMarker(ll(x + .5, z + .5), { radius: 9, color: css('--accent'), weight: 3, fill: false }).addTo(map); setTimeout(() => tmp.remove(), 3500);
  }
  $('gotoBtn').onclick = goto; $('goto').addEventListener('keydown', e => { if (e.key === 'Enter') goto(); });
  $('dimSel').onchange = e => { dim = e.target.value; closeForm(); loadImage(); renderMarkers(); renderPlan(); };

  function renderSeed() {
    const s = W().seed;
    $('seedInfo').innerHTML = s
      ? `<span class="mono">${esc(s)}</span><br><a href="https://www.chunkbase.com/apps/seed-map#seed=${encodeURIComponent(s)}&platform=java_1_21&dimension=overworld&x=0&z=0&zoom=0" target="_blank" rel="noopener">Открыть сид на Chunkbase</a>. Там ванильный мир: биомы и структуры из модов сборки не показаны.`
      : 'Не указан. Узнать его в игре: команда <span class="mono">/seed</span>. Вписать — в «Настройках».';
  }

  App.onChange(why => { if (why === 'import' || why === 'replace') { loadImage(); } renderMarkers(); renderPlan(); renderSeed(); });
  map.setView(ll(W().plan.base.cx * 16 + 8, W().plan.base.cz * 16 + 8), -1);
  renderMarkers(); renderPlan(); renderSeed(); loadImage();
  const q = new URLSearchParams(location.search); if (q.has('x') && q.has('z')) { $('goto').value = q.get('x') + ' ' + q.get('z'); goto(); }
})();
