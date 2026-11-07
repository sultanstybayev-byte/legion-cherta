/* Block textures taken from the user's own game files (.jar of Minecraft and mods, resource packs .zip).
   Everything happens in the browser and is kept in IndexedDB on this device only: nothing is uploaded anywhere.
   TX.ready() → loads what was imported before; TX.importFiles(files, onProgress); TX.clear();
   TX.has(name) / TX.faces(name) → [top, side, bottom] tile numbers in the atlas; TX.tint(name) → face tint bits;
   TX.atlasCanvas (2048×2048, 16 px tiles); TX.label(name); TX.list() → [{name, label, ns, tab}]; TX.icon(name, px) → dataURL of a little cube. */
(function () {
  const TX = { loaded: false, count: 0, atlasCanvas: null, version: 0 };
  const TILE = 16, GRID = 128;                      // 128 × 128 tiles of 16 px = 2048 px atlas (16 384 textures)
  let blocks = new Map();                           // name -> { f: [top, side, bottom], tint: bits, label, ns }
  const DB = 'legion-textures', ST = 'kv';

  /* ---------- IndexedDB ---------- */
  function db() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function put(k, v) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
  async function get(k) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(ST).objectStore(ST).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
  async function del(k) { const d = await db(); return new Promise((res) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).delete(k); t.oncomplete = res; t.onerror = res; }); }

  /* ---------- zip reader (central directory, stored / deflate), reads only the entries it needs ---------- */
  async function zipIndex(file) {
    const tailLen = Math.min(file.size, 70000), tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let eo = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eo = i; break; }
    if (eo < 0) throw new Error('не zip/jar');
    let count = tail.getUint16(eo + 10, true), size = tail.getUint32(eo + 12, true), off = tail.getUint32(eo + 16, true);
    if (count === 0xffff || off === 0xffffffff) {   // zip64
      const lo = eo - 20; if (lo >= 0 && tail.getUint32(lo, true) === 0x07064b50) {
        const z64 = Number(tail.getBigUint64(lo + 8, true)), r = new DataView(await file.slice(z64, z64 + 56).arrayBuffer());
        count = Number(r.getBigUint64(32, true)); size = Number(r.getBigUint64(40, true)); off = Number(r.getBigUint64(48, true)); }
    }
    const cd = new DataView(await file.slice(off, off + size).arrayBuffer()), dec = new TextDecoder(), out = new Map();
    for (let p = 0, n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true); let csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
      const nl = cd.getUint16(p + 28, true), el = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true); let lho = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
      if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) {   // zip64 extra field
        let q = p + 46 + nl; const end = q + el; while (q + 4 <= end) { const id = cd.getUint16(q, true), sz = cd.getUint16(q + 2, true); if (id === 1) { let r = q + 4;
          if (usize === 0xffffffff) { usize = Number(cd.getBigUint64(r, true)); r += 8; } if (csize === 0xffffffff) { csize = Number(cd.getBigUint64(r, true)); r += 8; } if (lho === 0xffffffff) lho = Number(cd.getBigUint64(r, true)); } q += 4 + sz; } }
      out.set(name, { method, csize, lho });
      p += 46 + nl + el + cl;
    }
    return out;
  }
  async function zipRead(file, e) {
    const h = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer()), start = e.lho + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const raw = file.slice(start, start + e.csize);
    if (e.method === 0) return new Uint8Array(await raw.arrayBuffer());
    if (e.method !== 8) throw new Error('сжатие ' + e.method);
    return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  const json = u8 => { try { return JSON.parse(new TextDecoder().decode(u8).replace(/^﻿/, '')); } catch (e) { return null; } };

  /* ---------- resolving block models ---------- */
  const rl = (s, ns) => { s = String(s || ''); const i = s.indexOf(':'); return i < 0 ? [ns || 'minecraft', s] : [s.slice(0, i), s.slice(i + 1)]; };
  function pickModel(bs) {
    const one = v => Array.isArray(v) ? v[0] : v;
    if (bs && bs.variants) { const keys = Object.keys(bs.variants); if (!keys.length) return null;
      const k = keys.find(q => q === '') ?? keys.find(q => /axis=y|facing=north|half=bottom|type=bottom/.test(q)) ?? keys[0]; return one(bs.variants[k]); }
    if (bs && Array.isArray(bs.multipart)) { const p = bs.multipart.find(q => !q.when) || bs.multipart[0]; return p && one(p.apply); }
    return null;
  }

  /* ---------- import ---------- */
  TX.importFiles = async function (files, progress) {
    files = [...files].filter(f => /\.(jar|zip)$/i.test(f.name));
    if (!files.length) throw new Error('Выбери файлы .jar (игра, моды) или .zip (ресурспак).');
    const states = new Map(), models = new Map(), texSrc = new Map(), lang = { ru: {}, en: {} };   // key "ns:path" -> {file, e}
    let fi = 0;
    for (const f of files) {
      progress && progress(`Читаю ${++fi}/${files.length}: ${f.name}`);
      let idx; try { idx = await zipIndex(f); } catch (e) { console.warn(f.name, e); continue; }
      for (const [name, e] of idx) {
        const m = name.match(/^assets\/([^/]+)\/(blockstates|models|textures|lang)\/(.+)$/); if (!m) continue;
        const [, ns, kind, rest] = m;
        if (kind === 'blockstates' && rest.endsWith('.json')) states.set(ns + ':' + rest.slice(0, -5), { f, e });
        else if (kind === 'models' && rest.endsWith('.json')) models.set(ns + ':' + rest.slice(0, -5), { f, e });
        else if (kind === 'textures' && rest.endsWith('.png')) texSrc.set(ns + ':' + rest.slice(0, -4), { f, e });
        else if (kind === 'lang' && /^(ru_ru|en_us)\.json$/.test(rest)) { const j = json(await zipRead(f, e)); if (j) Object.assign(lang[rest.startsWith('ru') ? 'ru' : 'en'], j); }
      }
    }
    if (!states.size) throw new Error('В файлах нет блоков (assets/…/blockstates). Нужен .jar самой игры или модов.');
    const mcache = new Map();
    async function model(key, depth) {
      if (depth > 12) return null; if (mcache.has(key)) return mcache.get(key);
      const src = models.get(key); let m = src ? json(await zipRead(src.f, src.e)) : null; if (!m) { mcache.set(key, null); return null; }
      let tex = Object.assign({}, m.textures || {}), elements = m.elements || null;
      if (m.parent) { const [pn, pp] = rl(m.parent, key.split(':')[0]); const par = await model(pn + ':' + pp, depth + 1); if (par) { tex = Object.assign({}, par.tex, tex); if (!elements) elements = par.elements; } }
      const r = { tex, elements }; mcache.set(key, r); return r;
    }
    const resolve = (tex, ref, ns) => { for (let i = 0; i < 10 && ref && ref[0] === '#'; i++) ref = tex[ref.slice(1)]; if (!ref || ref[0] === '#') return null; const [n, p] = rl(ref, ns); return n + ':' + p; };
    const used = new Map(), list = [];   // texture key -> tile
    let bi = 0;
    for (const [name, src] of states) {
      if (++bi % 200 === 0) progress && progress(`Модели блоков: ${bi}/${states.size}`);
      const ns = name.split(':')[0], bs = json(await zipRead(src.f, src.e)), mref = pickModel(bs); if (!mref || !mref.model) continue;
      const [mn, mp] = rl(mref.model, ns), m = await model(mn + ':' + mp, 0); if (!m) continue;
      let faces = [null, null, null], tint = 0;
      if (m.elements && m.elements.length) {   // the biggest element decides the look
        const el = m.elements.slice().sort((a, b) => vol(b) - vol(a))[0], fc = el.faces || {};
        const f = k => fc[k] ? [resolve(m.tex, fc[k].texture, mn), fc[k].tintindex != null] : [null, false];
        const up = f('up'), dn = f('down'), sd = ['north', 'south', 'east', 'west'].map(f).find(q => q[0]) || [null, false];
        faces = [up[0] || sd[0], sd[0] || up[0], dn[0] || up[0] || sd[0]]; tint = (up[1] ? 1 : 0) | (sd[1] ? 2 : 0) | (dn[1] ? 4 : 0);
      } else {
        const t = k => resolve(m.tex, '#' + k, mn) || null, any = t('all') || t('particle') || t('texture') || t('side');
        faces = [t('top') || t('end') || t('up') || any, t('side') || any, t('bottom') || t('end') || t('down') || any];
      }
      if (!faces[1]) continue;
      // overlay sides of grass-like blocks are tinted only in the overlay; keep the side untinted
      if (/grass_block$/.test(name)) tint &= ~2;
      const tiles = faces.map(k => { if (!k || !texSrc.has(k)) return -1; if (!used.has(k)) used.set(k, used.size); return used.get(k); });
      if (tiles[1] < 0) continue;
      const lk = 'block.' + ns + '.' + name.slice(ns.length + 1);
      blocks.set(name, { f: tiles.map(t => t < 0 ? tiles[1] : t), tint, label: lang.ru[lk] || lang.en[lk] || '', ns });
      list.push(name);
      if (used.size >= GRID * GRID) break;
    }
    // atlas
    const cv = document.createElement('canvas'); cv.width = cv.height = GRID * TILE; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    let ti = 0;
    for (const [k, tile] of used) {
      if (++ti % 300 === 0) progress && progress(`Текстуры: ${ti}/${used.size}`);
      try { const s = texSrc.get(k), bmp = await createImageBitmap(new Blob([await zipRead(s.f, s.e)], { type: 'image/png' })), w = bmp.width;
        g.drawImage(bmp, 0, 0, w, w, (tile % GRID) * TILE, Math.floor(tile / GRID) * TILE, TILE, TILE); bmp.close && bmp.close(); } catch (e) { /* broken png: tile stays empty */ }
    }
    const meta = { v: 1, blocks: [...blocks].filter(([n]) => list.includes(n)) };
    blocks = new Map(meta.blocks);
    progress && progress('Сохраняю у тебя в браузере…');
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    await put('atlas', blob); await put('meta', meta);
    TX.atlasCanvas = cv; TX.loaded = true; TX.count = blocks.size; TX.version++; iconCache.clear();
    return { blocks: blocks.size, textures: used.size, files: files.length };
  };
  const vol = e => Math.abs((e.to[0] - e.from[0]) * (e.to[1] - e.from[1]) * (e.to[2] - e.from[2])) + 0.01;

  TX.ready = async function () {
    try {
      const meta = await get('meta'), blob = await get('atlas'); if (!meta || !blob) return false;
      const bmp = await createImageBitmap(blob), cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0);
      blocks = new Map(meta.blocks); TX.atlasCanvas = cv; TX.loaded = true; TX.count = blocks.size; TX.version++; return true;
    } catch (e) { console.warn('textures', e); return false; }
  };
  TX.clear = async function () { await del('meta'); await del('atlas'); blocks = new Map(); TX.loaded = false; TX.atlasCanvas = null; TX.count = 0; TX.version++; iconCache.clear(); };

  const base = n => String(n || '').replace(/\[.*$/, '');
  TX.has = n => blocks.has(base(n));
  TX.faces = n => { const b = blocks.get(base(n)); return b ? b.f : null; };
  TX.tint = n => { const b = blocks.get(base(n)); return b ? b.tint : 0; };
  TX.label = n => { const b = blocks.get(base(n)); return b ? b.label : ''; };
  TX.GRID = GRID;
  TX.tintColor = n => /leaves|vine/.test(n) ? [0.47, 0.67, 0.18] : /water/.test(n) ? [0.25, 0.46, 0.89] : [0.57, 0.74, 0.35];

  /* ---------- creative tabs ---------- */
  const TABS = [
    ['build', 'Строительные', /(stone|brick|planks|slab|stairs|wall|deepslate|tuff|granite|diorite|andesite|calcite|quartz|prismarine|purpur|sandstone|blackstone|basalt|concrete$|terracotta|tiles|polished|chiseled|cut_|smooth|block_of|_block$|copper|mud|end_stone|obsidian|log$|wood$|stem$|hyphae)/],
    ['color', 'Цветные', /(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(wool|carpet|concrete|concrete_powder|terracotta|glazed_terracotta|stained_glass|stained_glass_pane|bed|banner|candle|shulker_box)/],
    ['nature', 'Природные', /(grass|dirt|sand|gravel|clay|ore$|_ore|leaves|sapling|flower|tulip|rose|daisy|poppy|orchid|allium|bluet|cornflower|lily|fern|bush|vine|moss|coral|ice|snow|mushroom|nylium|netherrack|soul|amethyst|dripstone|cactus|kelp|seagrass|bamboo|sugar_cane|pumpkin|melon|hay|honey|nest|sculk|root|azalea|petal|lichen)/],
    ['deco', 'Декор и функции', /(lantern|torch|lamp|glass|pane|bars|chain|door|trapdoor|fence|gate|ladder|scaffold|sign|banner|carpet|bed|chest|barrel|furnace|table|anvil|bell|campfire|candle|pot|head|skull|shelf|lectern|loom|stonecutter|grindstone|composter|cauldron|beacon|conduit|end_rod|rail|button|pressure_plate|lever)/],
    ['redstone', 'Редстоун', /(redstone|repeater|comparator|piston|observer|dropper|dispenser|hopper|target|daylight|tripwire|sculk_sensor|lightning_rod|note_block|tnt)/]
  ];
  TX.list = function () {
    const out = [];
    for (const [name, b] of blocks) {
      const id = name.split(':')[1]; let tab = 'mod:' + b.ns;
      if (b.ns === 'minecraft') { tab = 'other'; for (const [k, , re] of TABS) if (re.test(id)) { tab = k; if (k !== 'build') break; } if (TABS[1][2].test(id)) tab = 'color'; }
      out.push({ name, label: b.label || id.replace(/_/g, ' '), ns: b.ns, tab });
    }
    return out;
  };
  TX.TABS = TABS.map(t => [t[0], t[1]]).concat([['other', 'Прочее (Minecraft)']]);
  TX.modName = ns => ns.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  /* ---------- icons: little isometric cubes ---------- */
  const iconCache = new Map();
  TX.icon = function (name, px) {
    px = px || 32; const k = base(name) + '@' + px; if (iconCache.has(k)) return iconCache.get(k);
    const b = blocks.get(base(name)); if (!b || !TX.atlasCanvas) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = px; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const src = t => [(t % GRID) * TILE, Math.floor(t / GRID) * TILE];
    const s = px / 2, h = px / 4;   // projected cube: top rhombus + two sides
    const face = (t, tint, m, shade) => { g.save(); g.setTransform(...m); const [sx, sy] = src(t); g.drawImage(TX.atlasCanvas, sx, sy, TILE, TILE, 0, 0, TILE, TILE);
      if (tint) { g.globalCompositeOperation = 'multiply'; const c = TX.tintColor(name).map(v => Math.round(v * 255)); g.fillStyle = `rgb(${c})`; g.fillRect(0, 0, TILE, TILE); g.globalCompositeOperation = 'source-over'; }
      if (shade) { g.fillStyle = `rgba(0,0,0,${shade})`; g.fillRect(0, 0, TILE, TILE); } g.restore(); };
    const k1 = s / TILE, k2 = h / TILE;
    face(b.f[0], b.tint & 1, [k1, k2, -k1, k2, s, 0], 0);                         // top
    face(b.f[1], b.tint & 2, [k1, k2, 0, s / TILE, 0, h], 0.22);   // left side
    face(b.f[1], b.tint & 2, [k1, -k2, 0, s / TILE, s, 2 * h], 0.38);             // right side
    const url = cv.toDataURL(); iconCache.set(k, url); return url;
  };

  window.TX = TX;
})();
