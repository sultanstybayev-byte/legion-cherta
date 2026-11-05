/* Shapes for the structure editor: editable 3D primitives (like objects in Blender) that become blocks when applied.
   A shape: { id, type, name, pos [x, y, z] (centre, or the base for a petal), rot [x, y, z] degrees, size [x, y, z] blocks,
              p: { thick, taper, tube, curl, tip, base, peak }, block, mode: 'add' | 'cut', hidden }
   SH.cells(shape) -> [[x, y, z], …] the blocks it covers. */
(function () {
  const SH = {};
  const D2R = Math.PI / 180;
  SH.TYPES = {
    box: { name: 'Куб', size: [8, 8, 8], p: { thick: 0 } },
    sphere: { name: 'Шар', size: [11, 11, 11], p: { thick: 0 } },
    cyl: { name: 'Цилиндр', size: [9, 10, 9], p: { thick: 0, taper: 1 } },
    cone: { name: 'Конус', size: [11, 12, 11], p: { thick: 0, taper: 0 } },
    torus: { name: 'Тор', size: [17, 5, 17], p: { thick: 0, tube: 0.3 } },
    pyramid: { name: 'Пирамида', size: [11, 8, 11], p: { thick: 0 } },
    petal: { name: 'Лепесток', size: [14, 30, 4], p: { thick: 1, curl: 0.25, tip: 1, base: 0.3, peak: 0.45 } }
  };
  // which parameters a type shows in the panel: [key, label, min, max, step]
  SH.PARAMS = {
    box: [['thick', 'Пустая внутри: стенка, блоков (0 — сплошная)', 0, 20, 1]],
    sphere: [['thick', 'Пустая внутри: стенка (0 — сплошная)', 0, 20, 1]],
    cyl: [['thick', 'Пустая внутри: стенка (0 — сплошная)', 0, 20, 1], ['taper', 'Верх: доля от низа (1 — цилиндр, 0 — конус)', 0, 2, 0.05]],
    cone: [['thick', 'Пустая внутри: стенка (0 — сплошная)', 0, 20, 1], ['taper', 'Верх: доля от низа', 0, 2, 0.05]],
    torus: [['thick', 'Пустая внутри: стенка (0 — сплошная)', 0, 20, 1], ['tube', 'Толщина кольца (доля радиуса)', 0.05, 1, 0.05]],
    pyramid: [['thick', 'Пустая внутри: стенка (0 — сплошная)', 0, 20, 1]],
    petal: [['thick', 'Толщина оболочки, блоков', 1, 8, 1], ['curl', 'Изгиб: наклон кончика (− назад, + вперёд)', -1.5, 1.5, 0.05], ['tip', 'Острота кончика', 0.3, 4, 0.05],
      ['base', 'Ширина у основания (доля)', 0, 1, 0.05], ['peak', 'Где шире всего (доля длины)', 0.1, 0.9, 0.05]]
  };
  SH.make = function (type, pos, block) {
    const t = SH.TYPES[type]; return { id: Math.random().toString(36).slice(2, 10), type, name: t.name, pos: pos.slice(), rot: [0, 0, 0], size: t.size.slice(), p: Object.assign({}, t.p), block, mode: 'add', hidden: false };
  };
  // rotation matrix (Euler XYZ like three.js), as rows
  function rotM(r) {
    const [a, b, c] = r.map(v => (v || 0) * D2R), ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    // R = Rx * Ry * Rz
    return [[cb * cc, -cb * sc, sb], [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb], [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb]];
  }
  SH.rotM = rotM;
  const mul = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
  const mulT = (M, v) => [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2], M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2], M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]];
  // signed distance (approx, in blocks) in the shape's own frame; h = half size
  function sdf(type, q, h, p) {
    const [x, y, z] = q, mn = Math.min(h[0], h[1], h[2]);
    switch (type) {
      case 'box': return Math.max(Math.abs(x) - h[0], Math.abs(y) - h[1], Math.abs(z) - h[2]);
      case 'sphere': { const k = Math.hypot(x / h[0], y / h[1], z / h[2]); return (k - 1) * mn; }
      case 'cyl': case 'cone': {
        const ty = Math.min(1, Math.max(0, (y / h[1] + 1) / 2)), sc = Math.max(1e-3, 1 + ((p.taper ?? 1) - 1) * ty);
        const rr = Math.hypot(x / (h[0] * sc), z / (h[2] * sc)); return Math.max((rr - 1) * Math.min(h[0], h[2]) * sc, Math.abs(y) - h[1]);
      }
      case 'pyramid': { const ty = (y / h[1] + 1) / 2, sc = Math.max(1e-3, 1 - ty), k = Math.max(Math.abs(x) / (h[0] * sc), Math.abs(z) / (h[2] * sc)); return Math.max((k - 1) * Math.min(h[0], h[2]) * sc, Math.abs(y) - h[1]); }
      case 'torus': { const tr = Math.min(0.999, Math.max(0.02, p.tube ?? 0.3)), R = 1 - tr, qq = Math.hypot(x / h[0], z / h[2]); return (Math.hypot(qq - R, (y / h[1]) * tr) - tr) * Math.min(h[0], h[2]); }
    }
    return 1;
  }
  SH.cells = function (s) {
    const out = new Map(), add = (x, y, z) => { const k = x + ',' + y + ',' + z; if (!out.has(k)) out.set(k, [x, y, z]); };
    const M = rotM(s.rot), P = s.pos, h = s.size.map(v => Math.max(0.5, v / 2)), p = s.p || {};
    if (s.type === 'petal') {
      // parametric shell: length along local +Y from the base, width along X, the cup bulges to −Z, the tip leans by curl
      const L = Math.max(1, s.size[1]), Wd = Math.max(1, s.size[0]), cup = s.size[2], th = Math.max(1, Math.round(p.thick || 1));
      const peak = Math.min(0.9, Math.max(0.1, p.peak ?? 0.45)), g = Math.log(0.5) / Math.log(peak), tip = p.tip ?? 1, base = p.base ?? 0.3, curl = p.curl ?? 0;
      const du = 0.35 / L;
      for (let u = 0; u <= 1 + 1e-9; u += du) {
        const sv = Math.sin(Math.PI * Math.pow(Math.min(1, u), g)), half = Wd / 2 * (base * (1 - u) + (1 - base * (1 - u)) * Math.pow(Math.max(0, sv), tip));
        const zc = curl * L * u * u, yc = L * u, bulge = cup * (0.35 + 0.65 * Math.sin(Math.PI * u));
        const nv = Math.max(1, Math.ceil(half * 2 / 0.35));
        for (let i = 0; i <= nv; i++) {
          const v = -1 + 2 * i / nv, x = v * half, zz = zc - bulge * (1 - v * v);
          for (let t = 0; t < th; t += 0.5) {
            const w = mul(M, [x, yc, zz + t]); add(Math.floor(P[0] + w[0]), Math.floor(P[1] + w[1]), Math.floor(P[2] + w[2]));
          }
        }
      }
      return [...out.values()];
    }
    // solids: test every block centre inside the rotated bounding box
    let mnv = [1e9, 1e9, 1e9], mxv = [-1e9, -1e9, -1e9];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const w = mul(M, [sx * h[0], sy * h[1], sz * h[2]]); for (let i = 0; i < 3; i++) { mnv[i] = Math.min(mnv[i], P[i] + w[i]); mxv[i] = Math.max(mxv[i], P[i] + w[i]); } }
    const thick = p.thick || 0;
    if ((mxv[0] - mnv[0]) * (mxv[1] - mnv[1]) * (mxv[2] - mnv[2]) > 2e7) return [];
    for (let y = Math.floor(mnv[1]); y <= Math.ceil(mxv[1]); y++) for (let z = Math.floor(mnv[2]); z <= Math.ceil(mxv[2]); z++) for (let x = Math.floor(mnv[0]); x <= Math.ceil(mxv[0]); x++) {
      const q = mulT(M, [x + .5 - P[0], y + .5 - P[1], z + .5 - P[2]]), d = sdf(s.type, q, h, p);
      if (d <= 0 && (!thick || d > -thick)) add(x, y, z);
    }
    return [...out.values()];
  };
  // a fixed point used to grab/rotate (the shape's origin)
  SH.origin = s => s.pos.slice();
  if (typeof window !== 'undefined') window.SH = SH;
  if (typeof module !== 'undefined') module.exports = SH;
})();
