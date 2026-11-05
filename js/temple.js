/* Храм Лотоса (Lotus Temple, Delhi) as a block model. Exposes window.generateTemple(opt).
   Real building: 27 petals in three rings of 9 (every part repeats every 40°).
   - entrance leaves: 9 low shells over the entrances, their tips open outward and up;
   - outer leaves: 9 petals right behind the entrances, standing on their corners like arches, tips lean in to the bud;
   - inner leaves: 9 petals of the closed bud, turned 20° to the others; above +24.8 m they separate, tips open.
   Sizes are taken from the real building in metres and multiplied by K (1 m = K blocks).
   Interior is left empty: just the floor, a glass skylight under the bud tips, glass between the outer petals.
   Block ids: 3 white petals (smooth quartz), 2 roof between the outer petals (calcite), 5 floor (polished diorite), 11 glass. */
function generateTemple(opt) {
  opt = opt || {};
  const K = opt.K || 2.4, F = 1;                       // blocks per metre, floor thickness
  const D2R = Math.PI / 180, SP = 40;                  // 9 parts → one every 40°
  const BASE = 90;                                     // entrance 0 faces south (+Z in Minecraft)
  // monotone cubic through points [t, v]
  const spline = pts => {
    const n = pts.length, x = pts.map(p => p[0]), y = pts.map(p => p[1]), d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    return t => { if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1]; let i = 0; while (t > x[i + 1]) i++;
      const h = x[i + 1] - x[i], s = (t - x[i]) / h, s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h * m[i + 1]; };
  };
  const angDiff = (phi, base) => { let d = ((phi - base) % SP + SP) % SP; if (d > SP / 2) d -= SP; return d; };

  /* ---- real dimensions, metres ---- */
  // inner leaves (the bud): 34.3 m high, separate above 24.8 m; arched doorways into the hall under every seam
  const HI = 34.3, ZS = 24.8, I_LOBE = 0.06, DOOR_I_W = 8.5, DOOR_I_H = 9;
  const RI = spline([[0, 20], [0.3, 22.4], [0.55, 22.2], [0.7, 20.8], [0.82, 17.6], [0.92, 13], [0.97, 9.8], [1, 8.6]]);
  const hwI = z => z <= ZS ? 20 : 20 * Math.pow(Math.max(0, 1 - Math.pow((z - ZS) / (HI - ZS), 1.6)), 0.6);
  const rInner = (z, d) => RI(z / HI) * (1 - I_LOBE * (d / 20) * (d / 20));
  // outer leaves: 22.5 m high, 15.4 m wide; stand on their corners, glass arch under each; tips lean onto the bud
  const HO = 22.5, O_LOBE = 0.07, ARCH_H = 11, O_TOUCH = 0.55;
  const RO = spline([[0, 27.5], [0.4, 27.7], [0.7, 26.2], [0.9, 23.8], [1, 22.2]]);
  // roof of the outer hall: a cone from the outer leaves (where neighbours still touch) up to the bud
  const ZR = 12, ROOF_SLOPE = 0.85;
  const hwO = t => t <= O_TOUCH ? 20 : 20 * Math.pow(Math.max(0, 1 - Math.pow((t - O_TOUCH) / (1 - O_TOUCH), 1.4)), 0.75);
  const archO = a => ARCH_H * Math.pow(Math.max(0, 1 - Math.pow(a / 20, 1.6)), 0.6);   // bottom edge of an outer leaf
  const rOuter = (z, d) => RO(z / HO) * (1 - O_LOBE * (d / 20) * (d / 20));
  // entrance leaves: 18.2 m wide at the entrance; the tip goes out and up, edges lift off the ground going outward
  const U0 = 25.5, U1 = 37, HW0 = 9.8, TIP_H = 17;
  const crownE = s => ARCH_H + 0.7 + (TIP_H - ARCH_H - 0.7) * Math.pow(s, 1.3);
  const edgeE = s => TIP_H * Math.pow(s, 1.6);
  const hwE = s => HW0 * Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 0.75);

  /* ---- grid ---- */
  const N = Math.ceil(U1 * K) + 2, W = 2 * N + 1, PW = W * W, CW = W + 1;
  const HMAX = F + Math.ceil(HI * K) + 3;
  const grid = new Uint8Array(PW * HMAX);
  const idx = (x, y, z) => (y * W + (z + N)) * W + (x + N);
  // corner lattice in the horizontal plane: corner (i, k) sits at block coords (i - N - 0.5, k - N - 0.5)
  const cr = new Float32Array(CW * CW), cphi = new Float32Array(CW * CW);
  for (let k = 0; k < CW; k++) for (let i = 0; i < CW; i++) { const X = (i - N - 0.5) / K, Z = (k - N - 0.5) / K; cr[k * CW + i] = Math.hypot(X, Z); cphi[k * CW + i] = Math.atan2(Z, X) / D2R; }

  // signed distances (metres) of the three surfaces; NaN where the surface does not exist
  function fInner(r, phi, z) {
    if (z < 0 || z > HI) return NaN;
    const d = angDiff(phi, BASE + 20), a = Math.abs(d);
    if (a > hwI(z)) return NaN;
    if (a > 20 - DOOR_I_W && z < DOOR_I_H * Math.pow(Math.max(0, 1 - Math.pow((20 - a) / DOOR_I_W, 1.6)), 0.6)) return NaN;
    return r - rInner(z, d);
  }
  function fOuter(r, phi, z) {     // outer leaves, glass under their arches
    if (z < 0 || z > HO) return NaN;
    const d = angDiff(phi, BASE); if (Math.abs(d) > hwO(z / HO)) return NaN;
    return r - rOuter(z, d);
  }
  function fRoof(r, phi, z) {
    if (z < ZR - 0.4 || z > HO) return NaN;
    const d = angDiff(phi, BASE), dI = angDiff(phi, BASE + 20);
    if (r < rInner(Math.min(z, HI), dI) - 0.15 || (z <= HO && r > rOuter(z, d) + 0.4)) return NaN;
    return r - (rOuter(ZR, d) + 0.3 - ROOF_SLOPE * (z - ZR));
  }
  function fEntrance(r, phi, z) {
    const d = angDiff(phi, BASE) * D2R, u = r * Math.cos(d), v = Math.abs(r * Math.sin(d));
    const s = (u - U0) / (U1 - U0); if (s < 0 || s > 1) return NaN;
    const hw = hwE(s); if (v > hw) return NaN;
    if (z >= 0 && z <= HO && r < rOuter(z, angDiff(phi, BASE)) - 0.15) return NaN;    // part hidden inside the building
    const E = edgeE(s), C = crownE(s), q = Math.pow(Math.max(0, 1 - Math.pow(v / hw, 1.6)), 0.6);
    return z - (E + (C - E) * q);
  }
  const fams = [fInner, fOuter, fEntrance, fRoof];
  const layer = () => fams.map(() => new Float32Array(CW * CW));
  const fillLayer = (L, Y) => { const z = (Y - F) / K; for (let c = 0; c < CW * CW; c++) { const r = cr[c], p = cphi[c]; for (let f = 0; f < 4; f++) L[f][c] = fams[f](r, p, z); } };
  let lo = layer(), hi = layer(); fillLayer(lo, F);
  const crosses = (L0, L1, c) => { let mn = Infinity, mx = -Infinity;
    for (const L of [L0, L1]) for (const o of [c, c + 1, c + CW, c + CW + 1]) { const v = L[o]; if (v !== v) continue; if (v < mn) mn = v; if (v > mx) mx = v; }
    return mn <= 0 && mx >= 0; };
  const matO = (xb, yb, zb) => {   // outer leaf (white) or glass under its arch
    const X = xb / K, Z = zb / K, z = (yb + 0.5 - F) / K, a = Math.abs(angDiff(Math.atan2(Z, X) / D2R, BASE));
    return z < archO(a) ? 11 : 3;
  };
  for (let y = F; y < HMAX; y++) {
    fillLayer(hi, y + 1);
    for (let zb = -N; zb <= N; zb++) for (let xb = 0; xb <= N; xb++) {
      const c = (zb + N) * CW + (xb + N);
      let m = 0;
      if (crosses(lo[0], hi[0], c) || crosses(lo[2], hi[2], c)) m = 3;
      else if (crosses(lo[1], hi[1], c)) m = matO(xb, y, zb);
      else if (crosses(lo[3], hi[3], c)) m = 2;
      if (m) grid[idx(xb, y, zb)] = m;
    }
    const t = lo; lo = hi; hi = t;
  }
  // floor inside the glass line, skylight under the bud tips
  const yS = F + Math.round(ZS * K);
  for (let zb = -N; zb <= N; zb++) for (let xb = 0; xb <= N; xb++) {
    const X = xb / K, Z = zb / K, r = Math.hypot(X, Z), phi = Math.atan2(Z, X) / D2R;
    if (r <= rOuter(0, angDiff(phi, BASE)) + 0.3) grid[idx(xb, 0, zb)] = 5;
    if (r < rInner(ZS, angDiff(phi, BASE + 20)) && !grid[idx(xb, yS, zb)]) grid[idx(xb, yS, zb)] = 11;
  }
  // a doorway in the glass of every entrance: 5 wide, 6 high
  if (!opt.closed) for (let s = 0; s < 9; s++) {
    const th = (BASE + s * SP) * D2R, ux = Math.cos(th), uz = Math.sin(th);
    for (let zb = -N; zb <= N; zb++) for (let xb = 0; xb <= N; xb++) {
      const along = xb * ux + zb * uz, side = Math.abs(-xb * uz + zb * ux); if (along < 0 || side > 2.5) continue;
      for (let y = F; y < F + 6; y++) if (grid[idx(xb, y, zb)] === 11) grid[idx(xb, y, zb)] = 0;
    }
  }
  // exact mirror across the north-south axis
  for (let y = 0; y < HMAX; y++) for (let zb = -N; zb <= N; zb++) for (let xb = 1; xb <= N; xb++) grid[idx(-xb, y, zb)] = grid[idx(xb, y, zb)];
  let top = 0; for (let y = HMAX - 1; y >= 0 && !top; y--) for (let i = 0; i < PW; i++) if (grid[y * PW + i]) { top = y; break; }

  const dims = { K, N, W, H: top + 1, HI: Math.round(HI * K), HO: Math.round(HO * K), tipE: Math.round(TIP_H * K), arch: Math.round(ARCH_H * K),
    rBud: Math.round(RI(0) * K), rGlass: Math.round(RO(0) * K), rTip: Math.round(U1 * K), entranceW: Math.round(2 * HW0 * K), skylight: yS };
  const out = { N, W, F, H: top + 1, HMAX, grid, dims,
    get: (x, y, z) => (x < -N || x > N || z < -N || z > N || y < 0 || y >= HMAX) ? 0 : grid[idx(x, y, z)],
    inside: (x, y, z) => !(x < -N || x > N || z < -N || z > N || y < 0 || y >= HMAX),
    set: (x, y, z, m) => { if (x < -N || x > N || z < -N || z > N || y < 0 || y >= HMAX) return false; grid[idx(x, y, z)] = m; if (m && y + 1 > out.H) out.H = y + 1; return true; } };
  return out;
}
if (typeof module !== 'undefined') module.exports = { generateTemple }; else window.generateTemple = generateTemple;
