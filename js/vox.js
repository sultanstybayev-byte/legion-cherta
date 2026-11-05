/* Block models for structures (shared by «Структуры» and «План базы").
   Vox: a box of blocks with a palette of Minecraft block names ("minecraft:stone", "minecraft:oak_stairs[facing=north]").
   Local coords: x ∈ [x0, x0+w), y ∈ [0, h), z ∈ [z0, z0+d); the structure's centre is x = 0, z = 0.
   Also: block colours, compact storage (RLE + gzip), NBT, schematic import (.schem .schematic .nbt .litematic) and export (.schem). */
(function () {
  const VX = {};
  const AIR = 'minecraft:air';

  /* ---------- blocks: colours and kinds ---------- */
  const COLORS16 = { white: '#e9ecec', orange: '#f07613', magenta: '#bd44b3', light_blue: '#3aafd9', yellow: '#f8c527', lime: '#70b919', pink: '#ed8dac', gray: '#3e4447',
    light_gray: '#8e8e86', cyan: '#158991', purple: '#792aac', blue: '#35399d', brown: '#724728', green: '#546d1b', red: '#a12722', black: '#141519' };
  VX.COLOR_NAMES = Object.keys(COLORS16);
  const WOOD = { oak: '#a2834f', spruce: '#735531', birch: '#c0af79', jungle: '#a07351', acacia: '#a85a32', dark_oak: '#432b14', mangrove: '#753630', cherry: '#e3b3ad', bamboo: '#c3ad53', crimson: '#653147', warped: '#2b6963', pale_oak: '#e5dbd7' };
  const EXACT = {
    stone: '#7d7d7d', cobblestone: '#7a7a7a', mossy_cobblestone: '#6e7a5a', smooth_stone: '#a0a0a0', stone_bricks: '#7a7979', mossy_stone_bricks: '#6d7860', cracked_stone_bricks: '#767676', chiseled_stone_bricks: '#777777',
    granite: '#9a6a59', polished_granite: '#9a6a55', diorite: '#bcbcbc', polished_diorite: '#c0c0c2', andesite: '#888888', polished_andesite: '#848685',
    deepslate: '#505052', cobbled_deepslate: '#4d4d50', polished_deepslate: '#48484a', deepslate_bricks: '#464646', deepslate_tiles: '#363636', tuff: '#6c6d66', polished_tuff: '#626a64', tuff_bricks: '#626860', calcite: '#dfe0dc', dripstone_block: '#866b5c',
    dirt: '#866043', coarse_dirt: '#77553b', rooted_dirt: '#90684c', grass_block: '#5f9f35', podzol: '#5b3f1d', mycelium: '#6f6265', mud: '#3c3a3d', packed_mud: '#8e6b50', mud_bricks: '#89684f', clay: '#a0a6b3', gravel: '#837e7d', moss_block: '#596e2d',
    sand: '#dbd3a0', red_sand: '#be6621', sandstone: '#d8cb9b', smooth_sandstone: '#dfd6a6', cut_sandstone: '#d9cd9e', chiseled_sandstone: '#d8ca9b', red_sandstone: '#b5621f', smooth_red_sandstone: '#b5621f', cut_red_sandstone: '#bd6a24',
    snow_block: '#f9fefe', snow: '#f9fefe', powder_snow: '#f8fdfd', ice: '#91b7fd', packed_ice: '#8db4fa', blue_ice: '#74a7fd',
    obsidian: '#0f0b19', crying_obsidian: '#20102f', bedrock: '#555555', netherrack: '#6f3534', nether_bricks: '#2c1519', red_nether_bricks: '#450709', chiseled_nether_bricks: '#2f171c', cracked_nether_bricks: '#28141a',
    basalt: '#4f4f53', polished_basalt: '#636266', smooth_basalt: '#48484e', blackstone: '#2a2328', polished_blackstone: '#35303b', polished_blackstone_bricks: '#302a32', gilded_blackstone: '#382b26', soul_sand: '#513e32', soul_soil: '#4b3a2e', magma_block: '#8e3f1f', nether_wart_block: '#730302', warped_wart_block: '#167879', shroomlight: '#f09351',
    end_stone: '#dbdea0', end_stone_bricks: '#dae0a2', purpur_block: '#a97ea9', purpur_pillar: '#ab81ab', prismarine: '#63a397', prismarine_bricks: '#63aba0', dark_prismarine: '#335b4b', sea_lantern: '#acc8be', glowstone: '#ab8452',
    quartz_block: '#ece6df', smooth_quartz: '#ece6df', quartz_bricks: '#eae5dd', quartz_pillar: '#ebe6e0', chiseled_quartz_block: '#e7e2da', bricks: '#966153', terracotta: '#985e43',
    copper_block: '#c06c50', cut_copper: '#bf6b51', exposed_copper: '#a17e68', exposed_cut_copper: '#9b7a65', weathered_copper: '#6c9d6c', weathered_cut_copper: '#6d916b', oxidized_copper: '#52a385', oxidized_cut_copper: '#4f997f',
    iron_block: '#dcdcdc', gold_block: '#f6d03d', diamond_block: '#62dbd5', emerald_block: '#2ab446', lapis_block: '#1f43a0', redstone_block: '#af1906', coal_block: '#101010', netherite_block: '#433f41', amethyst_block: '#8561bf', bone_block: '#e1ddc9',
    hay_block: '#a68b0c', bookshelf: '#6b5a3b', crafting_table: '#7a5a37', furnace: '#6e6e6e', chest: '#a6792e', barrel: '#86643a', glass: '#c6dfe3', tinted_glass: '#2c2630', glass_pane: '#c6dfe3',
    water: '#3f76e4', lava: '#d0560e', torch: '#f5c53f', wall_torch: '#f5c53f', lantern: '#c48b3a', soul_lantern: '#5ab4b4', redstone_lamp: '#8c5a2d', jack_o_lantern: '#d98a1e', pumpkin: '#c67515', melon: '#6f9425',
    slime_block: '#6fc05b', honey_block: '#fbb931', sponge: '#c4c04c', target: '#e2aa9f', note_block: '#59392a', tnt: '#d23a2e', iron_bars: '#8b8c8b', chain: '#3a3f4b', ladder: '#8c6c3c', scaffolding: '#c9a95b',
    white_concrete: '#cfd5d6', light_gray_concrete: '#7d7d73', gray_concrete: '#36393d', black_concrete: '#080a0f'
  };
  const TRANSPARENT = /glass|ice$|^ice|water|slime|honey|iron_bars|chain$|scaffolding|leaves|barrier/;
  const NOT_SOLID = /^(air|cave_air|void_air|water|lava|light|short_grass|grass|tall_grass|fern|large_fern|dead_bush|vine|.*_vine|.*sapling|.*_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|torch|wall_torch|.*_torch|redstone_wire|rail|.*_rail|sugar_cane|kelp|kelp_plant|seagrass|tall_seagrass|.*_carpet|carpet|snow|.*_button|lever|.*_pressure_plate|tripwire|tripwire_hook|.*_sign|.*_wall_sign|.*_banner|cobweb|.*_mushroom|nether_sprouts|crimson_roots|warped_roots|.*_coral|.*_coral_fan)$/;
  const SKIP = /^(air|cave_air|void_air|structure_void|light|barrier)$/;
  const base = name => String(name || '').replace(/^minecraft:/, '').replace(/\[.*$/, '');
  const hexToRgb = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const mix = (a, b, t) => '#' + [0, 1, 2].map(i => Math.round((hexToRgb(a)[i] * (1 - t) + hexToRgb(b)[i] * t) * 255).toString(16).padStart(2, '0')).join('');
  const shade = (a, k) => '#' + hexToRgb(a).map(v => Math.round(Math.min(1, v * k) * 255).toString(16).padStart(2, '0')).join('');
  const colorCache = new Map();
  VX.colorOf = function (name) {
    let c = colorCache.get(name); if (c) return c;
    const b = base(name);
    const strip = b.replace(/_(stairs|slab|wall|fence_gate|fence|button|pressure_plate|door|trapdoor|pane|carpet)$/, '');
    if (EXACT[b]) c = EXACT[b];
    else if (EXACT[strip]) c = EXACT[strip];
    else if (EXACT[strip + 's']) c = EXACT[strip + 's'];
    else if (EXACT[strip + '_block']) c = EXACT[strip + '_block'];
    else {
      const col = VX.COLOR_NAMES.slice().sort((p, q) => q.length - p.length).find(k => b.startsWith(k + '_'));
      if (col) { c = COLORS16[col]; if (/terracotta/.test(b)) c = mix(c, '#985e43', 0.5); else if (/concrete_powder/.test(b)) c = mix(c, '#ffffff', 0.15); else if (/glazed/.test(b)) c = mix(c, '#ffffff', 0.1); }
      else {
        const w = Object.keys(WOOD).sort((p, q) => q.length - p.length).find(k => b.startsWith(k + '_'));
        if (w) { c = WOOD[w]; if (/_log|_wood|_stem|_hyphae/.test(b) && !/stripped/.test(b)) c = w === 'birch' ? '#d8d7d2' : shade(c, 0.62); if (/leaves/.test(b)) c = w === 'cherry' ? '#e8a7c3' : '#3d7a24'; }
        else if (/leaves/.test(b)) c = '#3d7a24';
        else if (/deepslate/.test(b)) c = '#4a4a4d'; else if (/blackstone/.test(b)) c = '#302a32'; else if (/sandstone/.test(b)) c = /red/.test(b) ? '#b5621f' : '#d8cb9b';
        else if (/quartz/.test(b)) c = '#ece6df'; else if (/prismarine/.test(b)) c = '#5f9d90'; else if (/copper/.test(b)) c = '#b36c52'; else if (/brick/.test(b)) c = '#8f5d4f';
        else if (/stone/.test(b)) c = '#7d7d7d'; else if (/ore$/.test(b)) c = '#7a7a7a'; else if (/nether/.test(b)) c = '#4a1f22'; else if (/purpur/.test(b)) c = '#a97ea9';
        else { let hsh = 0; for (const ch of b) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0; const g = 110 + (Math.abs(hsh) % 80); c = '#' + [g, g - 6, g - 12].map(v => v.toString(16).padStart(2, '0')).join(''); }
      }
    }
    colorCache.set(name, c); return c;
  };
  VX.isTransparent = name => TRANSPARENT.test(base(name));
  VX.isSolid = name => !NOT_SOLID.test(base(name));
  VX.isAir = name => SKIP.test(base(name));
  VX.baseName = base;
  // blocks offered in the block picker
  VX.COMMON = ['smooth_quartz', 'quartz_block', 'quartz_bricks', 'quartz_pillar', 'calcite', 'white_concrete', 'polished_diorite', 'diorite', 'andesite', 'polished_andesite', 'stone', 'smooth_stone', 'stone_bricks', 'cobblestone',
    'deepslate_bricks', 'deepslate_tiles', 'polished_deepslate', 'tuff_bricks', 'polished_blackstone_bricks', 'bricks', 'mud_bricks', 'sandstone', 'smooth_sandstone', 'prismarine_bricks', 'dark_prismarine', 'end_stone_bricks', 'purpur_block',
    'glass', 'tinted_glass', 'sea_lantern', 'glowstone', 'shroomlight', 'lantern', 'iron_block', 'gold_block', 'copper_block', 'oxidized_copper', 'obsidian', 'water', 'grass_block', 'dirt', 'moss_block', 'gravel', 'sand', 'clay',
    'oak_planks', 'spruce_planks', 'birch_planks', 'dark_oak_planks', 'cherry_planks', 'oak_log', 'spruce_log', 'oak_leaves', 'bookshelf', 'hay_block',
    'smooth_quartz_slab', 'smooth_quartz_stairs', 'quartz_slab', 'stone_brick_stairs', 'stone_brick_slab', 'stone_brick_wall', 'glass_pane', 'iron_bars', 'chain', 'torch']
    .concat(VX.COLOR_NAMES.flatMap(c => [c + '_concrete', c + '_terracotta', c + '_wool', c + '_stained_glass'])).map(n => 'minecraft:' + n);
  VX.RU = { smooth_quartz: 'Гладкий кварц', quartz_block: 'Кварцевый блок', quartz_bricks: 'Кварцевые кирпичи', quartz_pillar: 'Кварцевая колонна', calcite: 'Кальцит', white_concrete: 'Белый бетон', polished_diorite: 'Полир. диорит',
    diorite: 'Диорит', andesite: 'Андезит', polished_andesite: 'Полир. андезит', stone: 'Камень', smooth_stone: 'Гладкий камень', stone_bricks: 'Каменные кирпичи', cobblestone: 'Булыжник', glass: 'Стекло', sea_lantern: 'Морской фонарь',
    glowstone: 'Светокамень', orange_concrete: 'Оранжевый бетон', obsidian: 'Обсидиан', water: 'Вода', grass_block: 'Дёрн', dirt: 'Земля', air: 'Воздух' };
  VX.label = name => { const b = base(name), st = (String(name).match(/\[(.*)\]$/) || [])[1]; return (VX.RU[b] || b.replace(/_/g, ' ')) + (st ? ` [${st}]` : ''); };
  VX.normName = s => { s = String(s || '').trim().toLowerCase(); if (!s) return null; if (s === 'air' || s === '0') return AIR; return s.includes(':') ? s : 'minecraft:' + s; };

  /* ---------- the block box ---------- */
  class Vox {
    constructor(w, h, d, x0, z0, palette) {
      this.w = w; this.h = h; this.d = d; this.x0 = x0 ?? -Math.floor(w / 2); this.z0 = z0 ?? -Math.floor(d / 2);
      this.palette = (palette && palette.length ? palette.slice() : [AIR]); if (this.palette[0] !== AIR) this.palette.unshift(AIR);
      this.pmap = new Map(this.palette.map((n, i) => [n, i])); this.data = new Uint16Array(w * h * d);
    }
    i(x, y, z) { const a = x - this.x0, c = z - this.z0; return (a < 0 || c < 0 || y < 0 || a >= this.w || c >= this.d || y >= this.h) ? -1 : (y * this.d + c) * this.w + a; }
    inside(x, y, z) { return this.i(x, y, z) >= 0; }
    get(x, y, z) { const i = this.i(x, y, z); return i < 0 ? 0 : this.data[i]; }
    name(x, y, z) { return this.palette[this.get(x, y, z)]; }
    id(name) { name = name || AIR; if (VX.isAir(name)) return 0; let v = this.pmap.get(name); if (v === undefined) { v = this.palette.length; this.palette.push(name); this.pmap.set(name, v); } return v; }
    set(x, y, z, v) { const i = this.i(x, y, z); if (i < 0) return false; this.data[i] = v; return true; }
    clone() { const o = new Vox(this.w, this.h, this.d, this.x0, this.z0, this.palette); o.data.set(this.data); return o; }
    // make room for (x, y, z) with a margin; returns true if the box changed
    ensure(x, y, z, margin = 8) {
      if (this.inside(x, y, z)) return false;
      const nx0 = Math.min(this.x0, x - margin), nx1 = Math.max(this.x0 + this.w, x + margin + 1), nz0 = Math.min(this.z0, z - margin), nz1 = Math.max(this.z0 + this.d, z + margin + 1);
      if (y < 0) return false;
      this.resize(nx0, nz0, nx1 - nx0, Math.max(this.h, y + margin + 1), nz1 - nz0); return true;
    }
    resize(x0, z0, w, h, d) {
      if (w > 1024 || d > 1024 || h > 512) throw new Error('Слишком большая структура (предел 1024×512×1024)');
      const old = this.data, ow = this.w, oh = this.h, od = this.d, ox = this.x0, oz = this.z0;
      this.data = new Uint16Array(w * h * d); this.w = w; this.h = h; this.d = d; this.x0 = x0; this.z0 = z0;
      for (let y = 0; y < Math.min(oh, h); y++) for (let c = 0; c < od; c++) for (let a = 0; a < ow; a++) { const v = old[(y * od + c) * ow + a]; if (v) this.set(a + ox, y, c + oz, v); }
    }
    count() { let n = 0; for (const v of this.data) if (v) n++; return n; }
    bounds() {   // tight box of non-air blocks
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let y = 0; y < this.h; y++) for (let c = 0; c < this.d; c++) for (let a = 0; a < this.w; a++) if (this.data[(y * this.d + c) * this.w + a]) {
        const x = a + this.x0, z = c + this.z0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      return x0 > x1 ? null : { x0, x1, y0, y1, z0, z1 };
    }
  }
  VX.Vox = Vox;

  /* ---------- storage: "VOX1" + header JSON + RLE varints, gzipped ---------- */
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  VX.gzip = b => pipe(b, new CompressionStream('gzip'));
  VX.gunzip = b => pipe(b, new DecompressionStream('gzip'));
  class Buf { constructor(n) { this.a = new Uint8Array(n || 1024); this.n = 0; } need(k) { if (this.n + k > this.a.length) { const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
    u8(v) { this.need(1); this.a[this.n++] = v; } bytes(b) { this.need(b.length); this.a.set(b, this.n); this.n += b.length; }
    varint(v) { while (v > 127) { this.u8((v & 127) | 128); v >>>= 7; } this.u8(v); } out() { return this.a.subarray(0, this.n); } }
  VX.encode = async function (vox) {
    const head = new TextEncoder().encode(JSON.stringify({ v: 1, w: vox.w, h: vox.h, d: vox.d, x0: vox.x0, z0: vox.z0, palette: vox.palette }));
    const b = new Buf(65536); b.bytes([86, 79, 88, 49]); b.bytes([head.length >>> 24, (head.length >>> 16) & 255, (head.length >>> 8) & 255, head.length & 255]); b.bytes(head);
    const d = vox.data; let i = 0; while (i < d.length) { const v = d[i]; let j = i + 1; while (j < d.length && d[j] === v) j++; b.varint(j - i); b.varint(v); i = j; }
    return VX.gzip(b.out());
  };
  VX.decode = async function (bytes) {
    const u = await VX.gunzip(bytes); if (u[0] !== 86 || u[1] !== 79 || u[2] !== 88) throw new Error('Это не модель структуры');
    const hl = (u[4] << 24) | (u[5] << 16) | (u[6] << 8) | u[7], h = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + hl)));
    const vox = new Vox(h.w, h.h, h.d, h.x0, h.z0, h.palette); let p = 8 + hl, i = 0; const d = vox.data;
    const rd = () => { let v = 0, s = 0, c; do { c = u[p++]; v |= (c & 127) << s; s += 7; } while (c & 128); return v >>> 0; };
    while (p < u.length && i < d.length) { const n = rd(), v = rd(); d.fill(v, i, i + n); i += n; }
    return vox;
  };

  /* ---------- the Lotus Temple model from js/temple.js ---------- */
  const TEMPLE_IDS = { 1: 'minecraft:andesite', 2: 'minecraft:calcite', 3: 'minecraft:smooth_quartz', 4: 'minecraft:orange_concrete', 5: 'minecraft:polished_diorite', 7: 'minecraft:sea_lantern', 8: 'minecraft:glowstone', 9: 'minecraft:white_concrete', 10: 'minecraft:white_concrete', 11: 'minecraft:glass' };
  VX.TEMPLE_IDS = TEMPLE_IDS;
  VX.templeVox = function (edits) {
    const L = generateTemple(); let ext = 0;
    for (let y = 0; y < L.HMAX; y++) for (let z = -L.N; z <= L.N; z++) for (let x = -L.N; x <= L.N; x++) if (L.get(x, y, z)) ext = Math.max(ext, Math.abs(x), Math.abs(z));
    const v = new Vox(2 * ext + 1, L.HMAX, 2 * ext + 1, -ext, -ext, [AIR]);
    const ids = {}; for (const [k, n] of Object.entries(TEMPLE_IDS)) ids[k] = v.id(n);
    for (const e of edits || []) if (Array.isArray(e) && e.length === 4) L.set(e[0] | 0, e[1] | 0, e[2] | 0, e[3] | 0);
    for (let y = 0; y < L.HMAX; y++) for (let z = -ext; z <= ext; z++) for (let x = -ext; x <= ext; x++) { const m = L.get(x, y, z); if (m) v.set(x, y, z, ids[m] || v.id('minecraft:smooth_quartz')); }
    return v;
  };

  /* ---------- server storage ---------- */
  const cache = new Map();   // def id -> { key, vox }
  const keyOf = def => def.kind + ':' + (def.dataV || 0) + ':' + (def.edits || []).length;
  VX.cached = def => { const c = cache.get(def.id); return c && c.key === keyOf(def) ? c.vox : null; };
  VX.loadModel = async function (def) {
    const c = cache.get(def.id); if (c && c.key === keyOf(def)) return c.vox;
    let vox = null;
    if (def.dataV) { try { vox = await VX.decode(await App.raw('GET', '/api/structdata/' + encodeURIComponent(def.id))); } catch (e) { console.warn('model', def.id, e); } }
    if (!vox && (def.kind === 'temple' || def.kind === 'lotus')) vox = VX.templeVox(def.edits);
    if (!vox && def.kind === 'voxel') vox = new Vox(32, 24, 32);
    if (vox) cache.set(def.id, { key: keyOf(def), vox });
    return vox;
  };
  VX.isModel = def => !!def && (def.kind === 'temple' || def.kind === 'lotus' || def.kind === 'voxel');
  VX.saveModel = async function (def, vox) {
    const bytes = await VX.encode(vox);
    if (bytes.length > 1900000) throw new Error('Модель слишком большая для сервера: ' + Math.round(bytes.length / 1024) + ' КБ (предел 1,9 МБ).');
    await App.raw('PUT', '/api/structdata/' + encodeURIComponent(def.id), bytes);
    Object.assign(def, { dataV: Date.now(), edits: [], bw: vox.w, bd: vox.d, vx0: vox.x0, vz0: vox.z0, h: vox.h });
    cache.set(def.id, { key: keyOf(def), vox });
    return bytes.length;
  };
  VX.saveBackup = async function (def, vox) { await App.raw('PUT', '/api/structdata/' + encodeURIComponent(def.id) + '?slot=backup', await VX.encode(vox)); def.backupV = Date.now(); };
  VX.loadBackup = async def => VX.decode(await App.raw('GET', '/api/structdata/' + encodeURIComponent(def.id) + '?slot=backup'));
  VX.forget = id => cache.delete(id);

  /* visible blocks (at least one side open to air or glass): { n, pos Int16Array, rgb Float32Array, glass Uint8Array } */
  VX.surface = function (vox) {
    const P = vox.palette, open = P.map(n => !n || n === AIR || VX.isTransparent(n)), glassP = P.map(n => VX.isTransparent(n)), rgb = P.map(n => hexToRgb(VX.colorOf(n)));
    const pos = [], col = [], gl = [], { w, h, d, x0, z0, data } = vox;
    const at = (a, y, c) => (a < 0 || c < 0 || y < 0 || a >= w || c >= d || y >= h) ? 0 : data[(y * d + c) * w + a];
    for (let y = 0; y < h; y++) for (let c = 0; c < d; c++) for (let a = 0; a < w; a++) {
      const v = data[(y * d + c) * w + a]; if (!v) continue;
      const g = glassP[v], o = (q => q === 0 || (open[q] && q !== v));
      if (!(o(at(a + 1, y, c)) || o(at(a - 1, y, c)) || o(at(a, y + 1, c)) || o(at(a, y - 1, c)) || o(at(a, y, c + 1)) || o(at(a, y, c - 1)))) continue;
      pos.push(a + x0, y, c + z0); col.push(...rgb[v]); gl.push(g ? 1 : 0);
    }
    return { n: gl.length, pos: Int16Array.from(pos), rgb: Float32Array.from(col), glass: Uint8Array.from(gl) };
  };
  VX.rgb = name => hexToRgb(VX.colorOf(name));

  /* ---------- symmetry ---------- */
  // images of a column (x, z) under the structure's symmetry: n rotations about the centre, optionally mirrored
  VX.symImages = function (x, z, sym) {
    const n = sym && sym.n > 1 ? sym.n : 1, mir = !!(sym && sym.mirror), out = [], seen = new Set();
    const add = (a, b, k, m) => { const key = a + ',' + b; if (!seen.has(key)) { seen.add(key); out.push([a, b, k, m]); } };
    const srcs = mir ? (sym.axis === 'z' ? [[x, z, false], [x, -z, true]] : [[x, z, false], [-x, z, true]]) : [[x, z, false]];
    for (const [sx, sz, m] of srcs) for (let k = 0; k < n; k++) {
      if (n === 4 || n === 2) { let a = sx, b = sz; for (let t = 0; t < k * (4 / n); t++) [a, b] = [-b, a]; add(a, b, k * (4 / n), m); }
      else { const t = 2 * Math.PI * k / n, c = Math.cos(t), s = Math.sin(t); add(Math.round(sx * c - sz * s), Math.round(sx * s + sz * c), -1, m); }
    }
    return out;
  };
  // rotate (quarter turns clockwise seen from above) and mirror block states
  const FACE_CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
  VX.rotateName = function (name, q) {
    q = ((q % 4) + 4) % 4; if (!q || !/\[/.test(name)) return name;
    return name.replace(/\[(.*)\]$/, (m, st) => '[' + st.split(',').map(kv => {
      let [k, v] = kv.split('='); if (k === 'facing' || k === 'horizontal_facing') { for (let i = 0; i < q; i++) v = FACE_CW[v] || v; }
      else if (k === 'axis' && q % 2) v = v === 'x' ? 'z' : v === 'z' ? 'x' : v; else if (k === 'rotation') v = String((+v + 4 * q) % 16);
      else if (['north', 'east', 'south', 'west'].includes(k)) { let kk = k; for (let i = 0; i < q; i++) kk = FACE_CW[kk]; return kk + '=' + v; }
      return k + '=' + v; }).sort().join(',') + ']');
  };
  VX.flipName = function (name, axis) {
    if (!/\[/.test(name)) return name;
    const sw = axis === 'x' ? { east: 'west', west: 'east' } : axis === 'z' ? { north: 'south', south: 'north' } : { up: 'down', down: 'up', top: 'bottom', bottom: 'top' };
    return name.replace(/\[(.*)\]$/, (m, st) => '[' + st.split(',').map(kv => { let [k, v] = kv.split('=');
      if (['facing', 'half', 'type'].includes(k) && sw[v]) v = sw[v];
      else if (k === 'shape' && axis !== 'y') v = v.replace('left', '#').replace('right', 'left').replace('#', 'right');
      else if (k === 'hinge' && axis !== 'y') v = v === 'left' ? 'right' : 'left';
      else if (sw[k] && axis !== 'y') k = sw[k];
      return k + '=' + v; }).sort().join(',') + ']');
  };

  /* ---------- NBT ---------- */
  function readNBT(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), td = new TextDecoder(); let p = 0;
    const str = () => { const n = dv.getUint16(p); p += 2; const s = td.decode(buf.subarray(p, p + n)); p += n; return s; };
    const pay = t => {
      switch (t) {
        case 1: return dv.getInt8(p++);
        case 2: { const v = dv.getInt16(p); p += 2; return v; }
        case 3: { const v = dv.getInt32(p); p += 4; return v; }
        case 4: { const v = dv.getBigInt64(p); p += 8; return v; }
        case 5: { const v = dv.getFloat32(p); p += 4; return v; }
        case 6: { const v = dv.getFloat64(p); p += 8; return v; }
        case 7: { const n = dv.getInt32(p); p += 4; const a = buf.slice(p, p + n); p += n; return a; }
        case 8: return str();
        case 9: { const et = dv.getInt8(p++), n = dv.getInt32(p); p += 4; const a = []; for (let i = 0; i < n; i++) a.push(pay(et)); return a; }
        case 10: { const o = {}; for (;;) { const tt = dv.getInt8(p++); if (tt === 0) break; const k = str(); o[k] = pay(tt); } return o; }
        case 11: { const n = dv.getInt32(p); p += 4; const a = new Int32Array(n); for (let i = 0; i < n; i++) { a[i] = dv.getInt32(p); p += 4; } return a; }
        case 12: { const n = dv.getInt32(p); p += 4; const a = new Uint32Array(n * 2); for (let i = 0; i < n; i++) { a[2 * i + 1] = dv.getUint32(p); a[2 * i] = dv.getUint32(p + 4); p += 8; } return { longs: a }; }
        default: throw new Error('Повреждённый файл (тег ' + t + ')');
      }
    };
    const t = dv.getInt8(p++); if (t !== 10) throw new Error('Это не файл NBT'); const name = str(); return { name, value: pay(10) };
  }
  VX.readNBT = readNBT;
  const num = v => typeof v === 'bigint' ? Number(v) : v;
  const stateName = (n, props) => { const ks = props ? Object.keys(props).sort() : []; return ks.length ? `${n}[${ks.map(k => k + '=' + props[k]).join(',')}]` : n; };

  /* ---------- schematic import ---------- */
  const LEGACY = { 1: ['stone', 'granite', 'polished_granite', 'diorite', 'polished_diorite', 'andesite', 'polished_andesite'], 2: 'grass_block', 3: 'dirt', 4: 'cobblestone', 5: 'W_planks', 7: 'bedrock', 8: 'water', 9: 'water', 10: 'lava', 11: 'lava',
    12: 'sand', 13: 'gravel', 14: 'gold_ore', 15: 'iron_ore', 16: 'coal_ore', 17: 'W_log', 18: 'W_leaves', 20: 'glass', 22: 'lapis_block', 24: 'sandstone', 35: 'C_wool', 41: 'gold_block', 42: 'iron_block', 43: 'smooth_stone', 44: 'smooth_stone_slab',
    45: 'bricks', 47: 'bookshelf', 48: 'mossy_cobblestone', 49: 'obsidian', 50: 'torch', 53: 'oak_stairs', 54: 'chest', 57: 'diamond_block', 58: 'crafting_table', 61: 'furnace', 65: 'ladder', 67: 'cobblestone_stairs', 78: 'snow', 79: 'ice', 80: 'snow_block',
    82: 'clay', 85: 'oak_fence', 86: 'pumpkin', 87: 'netherrack', 88: 'soul_sand', 89: 'glowstone', 95: 'C_stained_glass', 98: ['stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks'], 101: 'iron_bars', 102: 'glass_pane', 103: 'melon',
    108: 'brick_stairs', 109: 'stone_brick_stairs', 112: 'nether_bricks', 114: 'nether_brick_stairs', 121: 'end_stone', 125: 'W_planks', 126: 'W_slab', 128: 'sandstone_stairs', 133: 'emerald_block', 134: 'spruce_stairs', 135: 'birch_stairs', 136: 'jungle_stairs',
    139: 'cobblestone_wall', 152: 'redstone_block', 155: 'quartz_block', 156: 'quartz_stairs', 159: 'C_terracotta', 160: 'C_stained_glass_pane', 161: 'oak_leaves', 162: 'acacia_log', 163: 'acacia_stairs', 164: 'dark_oak_stairs', 165: 'slime_block',
    168: 'prismarine', 169: 'sea_lantern', 170: 'hay_block', 171: 'C_carpet', 172: 'terracotta', 173: 'coal_block', 174: 'packed_ice', 179: 'red_sandstone', 201: 'purpur_block', 206: 'end_stone_bricks', 251: 'C_concrete', 252: 'C_concrete_powder' };
  const WOODS6 = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
  function legacyName(id, data) {
    let e = LEGACY[id]; if (e === undefined) return id ? 'minecraft:stone' : AIR;
    if (Array.isArray(e)) e = e[data] || e[0];
    if (e.startsWith('W_')) e = WOODS6[(e === 'W_log' || e === 'W_leaves' ? data & 3 : data & 7) % 6] + e.slice(1);
    if (e.startsWith('C_')) e = VX.COLOR_NAMES[data & 15] + e.slice(1);
    return 'minecraft:' + e;
  }
  function readVarints(bytes, n) { const out = new Uint32Array(n); let p = 0; for (let i = 0; i < n; i++) { let v = 0, s = 0, c; do { c = bytes[p++] & 255; v |= (c & 127) << s; s += 7; } while (c & 128); out[i] = v; } return out; }
  function fill(w, h, l, get) {   // get(x, y, z) -> block name; returns a Vox centred on x, z
    const v = new Vox(w, h, l); const idc = new Map();
    for (let y = 0; y < h; y++) for (let z = 0; z < l; z++) for (let x = 0; x < w; x++) { const n = get(x, y, z); if (!n || VX.isAir(n)) continue; let k = idc.get(n); if (k === undefined) { k = v.id(n); idc.set(n, k); } v.set(x + v.x0, y, z + v.z0, k); }
    return v;
  }
  VX.importFile = async function (file) {
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await VX.gunzip(bytes);
    const { value: root } = readNBT(bytes), name = String(file.name || '').toLowerCase();
    let S = root.Schematic || root;
    // Sponge .schem v2 / v3
    if (S.Palette || (S.Blocks && S.Blocks.Palette)) {
      const pal = S.Palette || S.Blocks.Palette, data = S.BlockData || S.Blocks.Data, W = num(S.Width) & 0xffff, H = num(S.Height) & 0xffff, L = num(S.Length) & 0xffff;
      const names = []; for (const [k, i] of Object.entries(pal)) names[num(i)] = k;
      const idx = readVarints(data, W * H * L);
      return fill(W, H, L, (x, y, z) => names[idx[(y * L + z) * W + x]]);
    }
    // MCEdit / old WorldEdit .schematic with numeric ids
    if (S.Blocks instanceof Uint8Array && S.Width !== undefined) {
      const W = num(S.Width), H = num(S.Height), L = num(S.Length), B = S.Blocks, D = S.Data || new Uint8Array(B.length);
      return fill(W, H, L, (x, y, z) => { const i = (y * L + z) * W + x; return legacyName(B[i] & 255, D[i] & 15); });
    }
    // vanilla structure block .nbt
    if (Array.isArray(root.size) && Array.isArray(root.blocks)) {
      const [W, H, L] = root.size.map(num), pal = (root.palette || (root.palettes && root.palettes[0]) || []).map(p => stateName(p.Name, p.Properties)), grid = new Map();
      for (const b of root.blocks) { const [x, y, z] = b.pos.map(num); grid.set((y * L + z) * W + x, pal[num(b.state)]); }
      return fill(W, H, L, (x, y, z) => grid.get((y * L + z) * W + x));
    }
    // Litematica .litematic: one or more regions with bit-packed block states
    if (root.Regions) {
      const regs = Object.values(root.Regions).map(r => {
        const sx = num(r.Size.x), sy = num(r.Size.y), sz = num(r.Size.z), px = num(r.Position.x), py = num(r.Position.y), pz = num(r.Position.z);
        return { r, ax: Math.abs(sx), ay: Math.abs(sy), az: Math.abs(sz), mx: sx < 0 ? px + sx + 1 : px, my: sy < 0 ? py + sy + 1 : py, mz: sz < 0 ? pz + sz + 1 : pz };
      });
      const gx0 = Math.min(...regs.map(q => q.mx)), gy0 = Math.min(...regs.map(q => q.my)), gz0 = Math.min(...regs.map(q => q.mz));
      const W = Math.max(...regs.map(q => q.mx + q.ax)) - gx0, H = Math.max(...regs.map(q => q.my + q.ay)) - gy0, L = Math.max(...regs.map(q => q.mz + q.az)) - gz0;
      const v = new Vox(W, H, L);
      for (const q of regs) {
        const pal = q.r.BlockStatePalette.map(p => stateName(p.Name, p.Properties)), ids = pal.map(n => v.id(n));
        const bits = Math.max(2, Math.ceil(Math.log2(pal.length))), mask = (1 << bits) - 1, words = q.r.BlockStates.longs, total = q.ax * q.ay * q.az;
        for (let i = 0; i < total; i++) {
          const b = i * bits, wi = b >>> 5, off = b & 31; let val = words[wi] >>> off; if (off + bits > 32) val |= words[wi + 1] << (32 - off); val &= mask;
          const id = ids[val]; if (!id) continue;
          const x = i % q.ax, z = Math.floor(i / q.ax) % q.az, y = Math.floor(i / (q.ax * q.az));
          v.set(q.mx - gx0 + x + v.x0, q.my - gy0 + y, q.mz - gz0 + z + v.z0, id);
        }
      }
      return v;
    }
    throw new Error('Не понял формат файла' + (name ? ' «' + file.name + '»' : '') + '. Подходят .schem, .schematic, .litematic и .nbt.');
  };

  /* ---------- export: Sponge schematic v2 (.schem), opens in WorldEdit / FAWE / Litematica / Amulet ---------- */
  VX.exportSchem = async function (vox) {
    const b = vox.bounds() || { x0: vox.x0, x1: vox.x0, y0: 0, y1: 0, z0: vox.z0, z1: vox.z0 };
    const W = b.x1 - b.x0 + 1, H = b.y1 + 1, L = b.z1 - b.z0 + 1;
    const used = new Map([[0, 0]]), names = [AIR], data = new Buf(W * H * L + 16);
    for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
      const v = vox.get(x + b.x0, y, z + b.z0); let k = used.get(v); if (k === undefined) { k = names.length; used.set(v, k); names.push(vox.palette[v]); } data.varint(k);
    }
    const o = new Buf(data.n + names.length * 40 + 256), te = new TextEncoder();
    const s16 = v => { o.u8((v >> 8) & 255); o.u8(v & 255); }, s32 = v => { o.u8((v >>> 24) & 255); o.u8((v >>> 16) & 255); o.u8((v >>> 8) & 255); o.u8(v & 255); };
    const nm = (t, n) => { o.u8(t); const e = te.encode(n); s16(e.length); o.bytes(e); };
    nm(10, 'Schematic');
    nm(3, 'Version'); s32(2); nm(3, 'DataVersion'); s32(3955);
    nm(2, 'Width'); s16(W); nm(2, 'Height'); s16(H); nm(2, 'Length'); s16(L);
    nm(11, 'Offset'); s32(3); s32(0); s32(0); s32(0);
    nm(3, 'PaletteMax'); s32(names.length);
    nm(10, 'Palette'); names.forEach((n, i) => { nm(3, n); s32(i); }); o.u8(0);
    nm(7, 'BlockData'); s32(data.n); o.bytes(data.out());
    o.u8(0);
    return VX.gzip(o.out());
  };

  if (typeof window !== 'undefined') window.VX = VX;
  if (typeof module !== 'undefined') module.exports = VX;
})();
