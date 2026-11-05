/* Lotus of the Legion: block model generator (same as the Лотос Легиона page). Exposes window.generateLotus(scale, opt). */
// Lotus: A = 6 central petals, B = 8 middle petals (3/4 height), C = 8 entrance petals between B,
// leaning outward with an upward pointed tip and an arch at the bottom. Gaps between petals are left open (light).
// ids: 1 andesite, 2 calcite, 3 smooth quartz, 5 diorite, 6 water, 7 sea lantern, 8 glowstone
function generateLotus(S, opt) {
  opt = opt || {}; const BR = opt.BR ?? 8, BL = opt.BL ?? 0.44;
  const D2R = Math.PI / 180, F = 1;
  const H1 = Math.round(84 * S), R1 = 26 * S;
  const H2 = Math.round(H1 * 0.75), R2 = 40 * S, FL = 2.5 * S;
  const HC = Math.round(20 * S);                               // entrance petal: tip height (its highest point)
  const RC = 40 * S + 0.5, LC = 16 * S, HB = 13 * S;            // vault starts at RC, reaches LC outward; ridge height at the back
  const LOUT = LC;
  const nA = 6, nB = 8, nC = 8;
  const HJA = Math.min(0.75, Math.round(40 * S) / H1), HJB = HC / H2;   // heights where neighbours stop touching
  const baseA = 90, baseC = 90, baseB = 90 + 22.5;           // C entrance on the south axis
  const WC = 13 * S;                                           // half-width of an entrance petal at its back
  const archW = WC * 0.62, archH = HB - 2 * S;                 // opening under the vault (for the card)
  const passW = 6.5 * S, passH = Math.max(HB - 2.5 * S, 7);                          // passage through B and A behind each entrance
  const Rf = R2 + FL + LC + 4 * S, Rp = Math.round(Rf + 10 * S);
  const N = Rp, W = 2 * N + 1, PW = W * W;
  const PH = H1 + 1, H = F + PH + 2;
  const grid = new Uint8Array(PW * H), pet = new Int16Array(PW * H).fill(-1);
  const idx = (x, y, z) => (y * W + (z + N)) * W + (x + N);
  const angDiff = (phi, base, sp) => { const hs = sp / 2; let d = ((phi - base) % sp + sp) % sp; if (d > hs) d -= sp; return d; };
  // which copy a cell belongs to; 15 = joint exactly on the boundary between two neighbours (shared by both)
  const copyOf = (x, z, base, n) => { const sp = 360 / n, phi = Math.atan2(z, x) / D2R, f = (phi - base) / sp;
    const fr = f - Math.floor(f); if (Math.abs(fr - 0.5) < 1e-7) return 15;
    return ((Math.round(f) % n) + n) % n; };
  // folds: A uses both axis mirrors (6-fold set is symmetric to them); B and C also the diagonal (8-fold)
  const foldA = (x, z) => [Math.abs(x), Math.abs(z)];
  const foldD = (x, z) => { const a = Math.abs(x), b = Math.abs(z); return a >= b ? [a, b] : [b, a]; };

  const A = { n: nA, base: baseA, H: H1, ridge: 6.5 * S,
    shape: h => ({ c: R1 * (1 + 0.12 * Math.sin(Math.PI * h * 0.85)) * (1 - 0.9 * Math.pow(h, 1.9)),
                   a: h <= HJA ? 30 : 30 * Math.pow(Math.max(0, 1 - Math.pow((h - HJA) / (1 - HJA), 1.7)), 0.62) }) };
  const B = { n: nB, base: baseB, H: H2, ridge: BR * S,
    shape: h => ({ c: R2 * (1 - BL * Math.pow(h, 1.5)) + FL * Math.pow(1 - h, 4),
                   a: h <= HJB ? 22.5 : 22.5 * Math.pow(Math.max(0, 1 - Math.pow((h - HJB) / (1 - HJB), 1.6)), 0.62) }) };
  // entrance vault: u outward from RC, t across. Edges lift off the ground going outward, tip goes out and up.
  // k = 0 at the outer wall of the middle petals (on the ground), 1 at the tip. Edges rise from the ground, tip goes out and up.
  function vault(k, t) {
    if (k < 0 || k > 1) return null;
    const w = WC * Math.pow(Math.max(0, 1 - Math.pow(k, 2.2)), 0.55);
    if (Math.abs(t) > w || w < 0.3) return null;
    const edge = HC * Math.pow(k, 1.7);
    const ridge = HB + (HC - HB) * Math.pow(k, 1.1);
    const q = Math.abs(t) / w;
    return edge + (ridge - edge) * Math.pow(Math.max(0, 1 - q * q), 0.5);
  }
  function radial(ring, phi, yl, seam) {
    const h = yl / ring.H; if (h < 0 || h > 1) return null;
    const d = angDiff(phi, ring.base, 360 / ring.n), s = ring.shape(h);
    const inP = s.a > 0.05 && Math.abs(d) <= s.a;
    if (!inP && !seam) return null;
    const q = inP ? Math.abs(d) / s.a : 1;
    return { c: s.c + (inP ? ring.ridge * (0.5 + 0.5 * (1 - h)) * Math.pow(1 - q * q, 0.85) : -0.5), d, inP };
  }
  const T = 1.05;
  function slabHit(ring, r, phi, yl) {
    const e = radial(ring, phi, yl, false); if (!e) return null;
    const u = radial(ring, phi, Math.min(ring.H, yl + 0.5), false), l = radial(ring, phi, Math.max(0, yl - 0.5), false);
    const dy = (u && l) ? (u.c - l.c) : 0;
    const dp = 0.5 / Math.max(r, 1) / D2R, p1 = radial(ring, phi + dp, yl, false), p0 = radial(ring, phi - dp, yl, false);
    const ds = (p1 && p0) ? (p1.c - p0.c) : 0;
    const g = Math.sqrt(1 + dy * dy + ds * ds), m0 = e.c - r;
    return (m0 >= -0.5 && m0 <= T * g - 0.5) ? e : null;
  }
  const polar = (fx, fz) => [Math.hypot(fx, fz), Math.atan2(fz, fx) / D2R];
  // passage tube toward each entrance (C directions), through B and A
  // straight passages only along the X and Z axes (north, south, west, east), through the middle and central petals
  const inPassage = (x, yl, z, pad) => { const ax = Math.abs(x), az = Math.abs(z), t = Math.min(ax, az), r = Math.max(ax, az);
    return r > R1 * 0.5 && t <= passW + pad && yl < passH * Math.sqrt(Math.max(0, 1 - Math.pow(t / (passW + 0.7 + pad), 2))) + pad; };
  // arches into the hall: one in the middle of every central petal
  const archAW = 5 * S, archAH = Math.max(8, 12 * S);
  const inArchA = (x, yl, z) => { const [fx, fz] = foldA(x, z), [r, phi] = polar(fx, fz);
    const d = angDiff(phi, baseA, 60), t = r * Math.sin(Math.abs(d) * D2R);
    return Math.abs(d) < 30 && t <= archAW && yl < archAH * Math.sqrt(Math.max(0, 1 - Math.pow(t / (archAW + 0.7), 2))); };
  const inArch = (x, yl, z) => { const [fx, fz] = foldD(x, z), [r, phi] = polar(fx, fz);
    const d = angDiff(phi, baseC, 45), t = r * Math.sin(Math.abs(d) * D2R);
    return t <= archW && yl < archH * Math.sqrt(Math.max(0, 1 - Math.pow(t / (archW + 0.7), 2))); };
  const ridgeLine = () => false; // petals are plain white, no straight stripes

  // signed distance-like values: negative = inside the petal / under the vault; null = outside its outline
  function fB(x, yl, z) { if (yl < 0 || yl > H2) return null; const [gx, gz] = foldD(x, z), [r, phi] = polar(gx, gz);
    const e = radial(B, phi, yl, false); return e ? r - e.c : null; }
  // entrance vault classification of a cell: 1 = inside the roof band, 2 = open air above/outside it, 0 = neither
  function cC(x, yl, z) { if (yl < 0) return 0; const [gx, gz] = foldD(x, z), [r, phi] = polar(gx, gz);
    const d = angDiff(phi, baseC, 45) * D2R, ax = baseC + Math.round((phi - baseC) / 45) * 45;
    const wall = radial(B, ax, Math.min(Math.max(yl, 0), H2), true).c, k = (r * Math.cos(d) - wall) / LC, t = r * Math.sin(d);
    if (Math.abs(d) > 22.5 * D2R + 1e-9) return 2;
    if (k < 0) return 0; if (k > 1) return 2;
    const w = WC * Math.pow(Math.max(0, 1 - Math.pow(k, 2.2)), 0.55), e = HC * Math.pow(k, 1.7);
    if (Math.abs(t) > w || w < 0.3) return yl >= e - 0.5 ? 2 : 0;
    const ys = vault(k, t); if (ys == null) return 2;
    if (yl >= ys) return 2; return yl >= e - 0.5 ? 1 : 0; }
  // ---- A: closed-surface petals (solid -> shell), gaps between petals stay open
  const rA = R1 * 1.25 + 6 * S;
  const NB = PW * (PH + 1);
  const bud = new Uint8Array(NB), budD = new Float32Array(NB), budP = new Uint8Array(NB);
  for (let yl = 0; yl <= PH; yl++) for (let x = -N; x <= N; x++) for (let z = -N; z <= N; z++) {
    const [fx, fz] = foldA(x, z), [r, phi] = polar(fx, fz); if (r > rA) continue;
    const e = radial(A, phi, yl, true);
    if (e && e.c - r >= 0) { const k = yl * PW + (z + N) * W + (x + N); bud[k] = 1; budD[k] = e.d; budP[k] = e.inP ? 1 : 0; }
  }
  const inBud = (x, yl, z) => yl >= 0 && yl <= PH && x >= -N && x <= N && z >= -N && z <= N && bud[yl * PW + (z + N) * W + (x + N)] === 1;

  for (let yl = 0; yl <= PH; yl++) {
    const y = F + 1 + yl;
    for (let x = -N; x <= N; x++) for (let z = -N; z <= N; z++) {
      const i = idx(x, y, z), k = yl * PW + (z + N) * W + (x + N);
      // A
      if (bud[k] && budP[k] && (!inBud(x + 1, yl, z) || !inBud(x - 1, yl, z) || !inBud(x, yl, z + 1) || !inBud(x, yl, z - 1) || !inBud(x, yl + 1, z) || (yl > 0 && !inBud(x, yl - 1, z)))) {
        if (!inPassage(x, yl, z, 0)) {
          const [fx, fz] = foldA(x, z), [r] = polar(fx, fz);
          grid[i] = ridgeLine(r, budD[k]) ? 3 : 2; pet[i] = 0 * 16 + copyOf(x, z, baseA, nA);
        }
        continue;
      }
      const [gx, gz] = foldD(x, z), [r, phi] = polar(gx, gz);
      // B: cells just inside the petal surface that touch the outside (clean 1-block shell)
      if (yl <= H2 && r < R2 + FL + 10 * S && r > R1 * 0.4) {
        const v = fB(x, yl, z);
        if (v != null && v < 0 && [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]].some(([dx,dy,dz]) => { const w = fB(x+dx, yl+dy, z+dz); return w != null && w >= 0; })
            && !inPassage(x, yl, z, 0) && !inBud(x, yl, z)) { grid[i] = 2; pet[i] = 1 * 16 + copyOf(x, z, baseB, nB); continue; }
      }
      // C: roof cells that touch open air
      if (yl <= HC + 1 && r > R2 * 0.8 && r < R2 + FL + 10 * S + LC + 2 && !grid[i] && cC(x, yl, z) === 1
          && [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]].some(([dx,dy,dz]) => cC(x+dx, yl+dy, z+dz) === 2)) {
        const bIn = radial(B, phi, Math.min(yl, H2), true);
        if (!(bIn && r < bIn.c - 0.5)) { grid[i] = 2; pet[i] = 2 * 16 + copyOf(x, z, baseC, nC); }
      }
    }
  }
  // close diagonal-only gaps inside one petal (scan the x<=0 half and mirror, so symmetry stays exact)
  for (let pass = 0; pass < 2; pass++) for (let y = F + 1; y < H; y++) {
    const yl = y - F - 1, adds = [];
    const g = (x, z) => (x < -N || x > N || z < -N || z > N) ? 0 : grid[idx(x, y, z)];
    for (let x = -N; x <= 0; x++) for (let z = -N; z < N; z++) {
      for (const [p, q, A_, B_] of [[[x, z], [x + 1, z + 1], [x + 1, z], [x, z + 1]], [[x + 1, z], [x, z + 1], [x, z], [x + 1, z + 1]]]) {
        if (!g(p[0], p[1]) || !g(q[0], q[1]) || g(A_[0], A_[1]) || g(B_[0], B_[1])) continue;
        const pp = pet[idx(p[0], y, p[1])], pq = pet[idx(q[0], y, q[1])];
        if (pp < 0 || pq < 0 || (pp >> 4) !== (pq >> 4)) continue;
        const ra = Math.hypot(A_[0], A_[1]), rb = Math.hypot(B_[0], B_[1]);
        let Cc = ra >= rb ? A_ : B_; if (ra === rb) Cc = Math.abs(A_[0]) > Math.abs(B_[0]) ? A_ : B_;
        if (inPassage(Cc[0], yl, Cc[1], 0.8)) continue;
        adds.push([Cc[0], Cc[1], pp >> 4]);
      }
    }
    const bases = [[baseA, nA], [baseB, nB], [baseC, nC]];
    for (const [cx, cz, t] of adds) for (const [sx, sz] of (t === 0 ? [[cx, cz], [-cx, cz], [cx, -cz], [-cx, -cz]] : [[cx, cz], [-cx, cz], [cx, -cz], [-cx, -cz], [cz, cx], [-cz, cx], [cz, -cx], [-cz, -cx]])) {
      const i = idx(sx, y, sz); if (!grid[i]) { grid[i] = 2; pet[i] = t * 16 + copyOf(sx, sz, bases[t][0], bases[t][1]); }
    }
  }
  // close 1-block slits in the entrance roofs and where they meet the middle petals (applied all at once, so symmetric)
  for (let pass = 0; pass < 3; pass++) {
    const adds = [];
    for (let y = F + 2; y <= F + 1 + HC + 3; y++) {
      const yl = y - F - 1;
      const pt = (x, yy, z) => (x < -N || x > N || z < -N || z > N || yy < 0 || yy >= H) ? -1 : pet[idx(x, yy, z)];
      for (let x = -N + 1; x < N; x++) for (let z = -N + 1; z < N; z++) {
        if (grid[idx(x, y, z)]) continue;
        const isC = p => p >= 32 && p < 48, isBC = p => p >= 16 && p < 48;
        let hit = null;
        for (const [a1, a2] of [[pt(x - 1, y, z), pt(x + 1, y, z)], [pt(x, y, z - 1), pt(x, y, z + 1)], [pt(x, y - 1, z), pt(x, y + 1, z)]]) {
          if (isBC(a1) && isBC(a2) && (isC(a1) || isC(a2))) { hit = isC(a1) ? a1 : a2; break; }
        }
        if (hit == null || inPassage(x, yl, z, 0.5) || cC(x, yl, z) === 0) continue;
        adds.push([x, y, z]);
      }
    }
    if (!adds.length) break;
    for (const [x, y, z] of adds) { const i = idx(x, y, z); grid[i] = 2; pet[i] = 2 * 16 + copyOf(x, z, baseC, nC); }
  }
  // ---- interior floors: at 20 above the ground floor, then every 9 blocks, with a light well in the middle
  const RH = R1 * 0.45;                                           // matches the small circle on the ground floor
  const atrium = opt.atrium || 'hex';
  const inWell = (x, z) => { if (atrium === 'none') return false; const ax = Math.abs(x), az = Math.abs(z), r = Math.hypot(ax, az), phi = Math.atan2(az, ax);
    let lim = RH;
    if (atrium === 'hex' || atrium === 'oct') {                  // rosette: centre circle plus round lobes
      const n = atrium === 'hex' ? 6 : 8, rd = RH * 0.68, rc = RH * 0.5, rl = rd * Math.sin(Math.PI / n) * 1.12;
      if (r <= rc) return true;
      for (let q = 0; q < n; q++) { const a = Math.PI / 2 + q * 2 * Math.PI / n; if (Math.hypot(ax - rd * Math.cos(a), az - rd * Math.sin(a)) <= rl) return true; }
      return false; }
    if (atrium === 'star') lim = RH * (0.7 + 0.3 * Math.pow(Math.abs(Math.cos(3 * (phi - Math.PI / 2))), 3));
    return r <= lim; };
  const floorLevels = [];
  for (let hgt = Math.round(20 * S); hgt < H1; hgt += Math.max(5, Math.round(9 * S))) {
    const yl = hgt - 1; let minIn = 1e9;
    for (let ph = 0; ph <= 90; ph += 1) { const e = radial(A, ph, yl, true); if (e) minIn = Math.min(minIn, e.c); }
    if (minIn - 1 < RH + 3 || floorLevels.length >= 3) break;   // floors at 20, 29, 38
    floorLevels.push(hgt);
    const y = F + hgt;
    const cand = [];
    for (let x = -N; x <= N; x++) for (let z = -N; z <= N; z++) {
      const i = idx(x, y, z); if (grid[i]) continue;
      let inside = inBud(x, yl, z);
      if (!inside && floorLevels.length === 1) { const [gx, gz] = foldD(x, z), [r, phi] = polar(gx, gz); const b = radial(B, phi, Math.min(yl, H2), true); inside = !!b && r < b.c - 0.5; }
      if (!inside || inWell(x, z)) continue;
      cand.push(i, x, z);
    }
    for (let j = 0; j < cand.length; j += 3) {
      const i = cand[j], x = cand[j + 1], z = cand[j + 2];
      const rim = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz]) => inWell(x + dx, z + dz));
      grid[i] = rim ? 3 : 5;
    }
    // lights in each floor, one in front of every central petal
    for (let kk = 0; kk < nA; kk++) { const a = (baseA + kk * 60) * D2R, rr = RH + 3.5 * S;
      const px = Math.round(rr * Math.cos(a)), pz = Math.round(rr * Math.sin(a));
      for (const [qx, qz] of [[px, pz], [-px, pz], [px, -pz], [-px, -pz]]) { const i = idx(qx, y, qz); if (grid[i] === 5) grid[i] = 7; } }
  }
  // plaza, floor, lights
  const bridgeW = 3 * S + 0.6;
  for (let x = -N; x <= N; x++) for (let z = -N; z <= N; z++) {
    const [fx, fz] = foldD(x, z), [r, phi] = polar(fx, fz);
    grid[idx(x, 0, z)] = 1;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    let fm = 5;
    if (edge >= N - 1) fm = 3;
    else if (r > Rf) {
      const d = angDiff(phi, baseC, 45), tb = r * Math.sin(Math.abs(d) * D2R);
      if (r < Rf + 1) fm = 3;
      else if (tb <= bridgeW) fm = tb <= 0.5 ? 3 : 5;
      else if (edge >= N - 2) fm = 3;
      else fm = 6;
    } else if ([R1 * 0.45, R1 + 2, (R2 + RC) / 2 + 3 * S].some(v => Math.abs(r - v) < 0.55)) fm = 3;
    grid[idx(x, F, z)] = fm;
  }
  const put4 = (px, pz, m) => { for (const [a, b] of [[px, pz], [-px, pz], [px, -pz], [-px, -pz]]) grid[idx(a, F, b)] = m; };
  put4(0, 0, 7);
  for (let k = 0; k < 8; k++) {
    const a = (baseC + k * 45) * D2R;
    put4(Math.round(R1 * 0.7 * Math.cos(a)), Math.round(R1 * 0.7 * Math.sin(a)), 7);
    put4(Math.round(RC * Math.cos(a)), Math.round(RC * Math.sin(a)), 8);
  }
  let top = 0; for (let y = 0; y < H; y++) for (let i = 0; i < PW; i++) if (grid[y * PW + i]) { top = y; break; }

  // per-petal stats and identical-shape groups (exact up to 90° turns and mirrors)
  const sails = {};
  for (let y = 0; y <= top; y++) for (let z = -N; z <= N; z++) for (let x = -N; x <= N; x++) {
    const p = pet[idx(x, y, z)]; if (p < 0) continue;
    let s = sails[p]; if (!s) s = sails[p] = { code: p, type: p >> 4, copy: p & 15, cells: [], minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, minY: 1e9, maxY: -1e9 };
    s.cells.push([x, y, z]);
    if (x < s.minX) s.minX = x; if (x > s.maxX) s.maxX = x; if (z < s.minZ) s.minZ = z; if (z > s.maxZ) s.maxZ = z; if (y < s.minY) s.minY = y; if (y > s.maxY) s.maxY = y;
  }
  const TF = [(x, z) => [x, z], (x, z) => [-z, x], (x, z) => [-x, -z], (x, z) => [z, -x], (x, z) => [-x, z], (x, z) => [z, x], (x, z) => [x, -z], (x, z) => [-z, -x]];
  const bases = [[baseA, nA], [baseB, nB], [baseC, nC]];
  for (const s of Object.values(sails)) {
    let best = null;
    for (const f of TF) { const key = s.cells.map(([x, y, z]) => { const [a, b] = f(x, z); return a + ',' + y + ',' + b; }).sort().join(';'); if (best === null || key < best) best = key; }
    s.canon = best; s.count = s.cells.length; delete s.cells;
    s.angle = (bases[s.type][0] + s.copy * 360 / bases[s.type][1]) % 360;
  }
  for (const t of [0, 1, 2]) {
    const list = Object.values(sails).filter(s => s.type === t).sort((a, b) => a.copy - b.copy);
    const groups = new Map(); let gi = 0;
    for (const s of list) { if (s.copy === 15) { s.group = -1; continue; } if (!groups.has(s.canon)) groups.set(s.canon, gi++); s.group = groups.get(s.canon); }
    for (const s of list) delete s.canon;
  }
  const dims = { archAW, archAH, floorLevels, atrium, H1, R1, H2, R2, HC, RC, LOUT, LC, HB, WC, archW, archH, passW, passH, Rf, Rp, nA, nB, nC, bases: [[baseA, nA], [baseB, nB], [baseC, nC]], joinA: Math.round(HJA * H1), joinB: Math.round(HJB * H2) };
  const _gapFns = { A, B, radial };
  const HMAX = H;
  const out = { _gapFns, N, H: top + 1, HMAX, W, F, grid, sails, dims,
    get: (x, y, z) => (x < -N || x > N || z < -N || z > N || y < 0 || y >= HMAX) ? 0 : grid[idx(x, y, z)],
    petal: (x, y, z) => (x < -N || x > N || z < -N || z > N || y < 0 || y >= HMAX) ? -1 : pet[idx(x, y, z)],
    inside: (x, y, z) => !(x < -N || x > N || z < -N || z > N || y < 0 || y >= HMAX),
    set: (x, y, z, m) => { if (x < -N || x > N || z < -N || z > N || y < 0 || y >= HMAX) return false; const i = idx(x, y, z); grid[i] = m; pet[i] = -1; if (m && y + 1 > out.H) out.H = y + 1; return true; } };
  return out;
}
if (typeof module !== 'undefined') module.exports = { generateLotus }; else window.generateLotus = generateLotus;
