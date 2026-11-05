/* Gizmo like in Blender. Mode 'move': three arrows X (red), Y (green), Z (blue); mode 'rotate': three rings around those axes.
   const g = Gizmo.create(scene);  g.mode('move' | 'rotate');  g.show([x, y, z], quaternion?) / g.hide();  g.fit(camera, canvas) before every render;
   g.pick(camera, canvas, clientX, clientY) -> 0 | 1 | 2 | -1;  g.begin(camera, canvas, axis, x, y);
   g.drag(camera, canvas, x, y) -> move: distance along the axis since begin (blocks); rotate: angle since begin (degrees, + = right-handed);
   g.axisDir(i) -> the axis in world space (turned with the quaternion);  g.end(). Always drawn on top, same size on screen. */
(function () {
  const COLORS = [0xe74c3c, 0x2ecc71, 0x3a8ee6], HOT = 0xffd24a, PX = 96, RING = 0.86, SEG = 72;
  function letter(t, col) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#' + col.toString(16).padStart(6, '0'); g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '700 38px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 32, 34);
    const tex = new THREE.CanvasTexture(c), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(0.22, 0.22, 1); sp.renderOrder = 32; return sp;
  }
  // a point of ring i (around axis i) at angle t, in the gizmo's own frame
  const ringPt = (i, t, r) => i === 0 ? new THREE.Vector3(0, Math.cos(t) * r, Math.sin(t) * r) : i === 1 ? new THREE.Vector3(Math.sin(t) * r, 0, Math.cos(t) * r) : new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0);
  function create(scene) {
    const root = new THREE.Group(); root.visible = false; scene.add(root);
    const arrows = new THREE.Group(), rings = new THREE.Group(); root.add(arrows, rings); rings.visible = false;
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)], parts = [], ringParts = [];
    const shaftG = new THREE.CylinderGeometry(0.028, 0.028, 0.82, 10), headG = new THREE.ConeGeometry(0.085, 0.2, 16);
    axes.forEach((a, i) => {
      const grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: COLORS[i], depthTest: false, transparent: true });
      const shaft = new THREE.Mesh(shaftG, mat), head = new THREE.Mesh(headG, mat); shaft.position.y = 0.41; head.position.y = 0.92;
      shaft.renderOrder = head.renderOrder = 31; grp.add(shaft, head);
      const lab = letter('XYZ'[i], COLORS[i]); lab.position.y = 1.14; grp.add(lab);
      if (i === 0) grp.rotation.z = -Math.PI / 2; if (i === 2) grp.rotation.x = Math.PI / 2;
      arrows.add(grp); parts.push({ mat });
      // ring: a thin tube around the axis
      const pts = []; for (let k = 0; k <= SEG; k++) pts.push(ringPt(i, k / SEG * Math.PI * 2, RING));
      const rmat = new THREE.MeshBasicMaterial({ color: COLORS[i], depthTest: false, transparent: true });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), SEG, 0.018, 6, true), rmat); tube.renderOrder = 31; rings.add(tube);
      const rl = letter('XYZ'[i], COLORS[i]); rl.position.copy(ringPt(i, i === 1 ? Math.PI * 0.25 : Math.PI * 0.25, RING)); rl.scale.set(0.17, 0.17, 1); rings.add(rl);
      ringParts.push({ mat: rmat });
    });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })); dot.renderOrder = 32; root.add(dot);
    // a long thin line along the axis being dragged (move), or the "hand" from the centre to the mouse (rotate)
    const lineG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(lineG, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: .75 })); line.visible = false; line.renderOrder = 29; scene.add(line);
    let hot = -1, st = null, mode = 'move'; const origin = new THREE.Vector3();
    const paint = () => [parts, ringParts].forEach(L => L.forEach((p, i) => { p.mat.color.setHex(i === hot || (st && st.axis === i) ? HOT : COLORS[i]); p.mat.opacity = st && st.axis !== i ? 0.22 : 1; }));
    const axisW = i => axes[i].clone().applyQuaternion(root.quaternion);
    function scaleFor(camera, canvas) { const h = canvas.clientHeight || canvas.height || 600, d = camera.position.distanceTo(root.position); return 2 * d * Math.tan(camera.fov * Math.PI / 360) * PX / h; }
    function ray(camera, canvas, cx, cy) {
      const r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
      const v = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5).unproject(camera), o = camera.position.clone();
      return { o, d: v.sub(o).normalize() };
    }
    function screen(camera, canvas, p) { const q = p.clone().project(camera), r = canvas.getBoundingClientRect(); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height, q.z]; }
    // move: parameter along the axis (through origin) of the point closest to the mouse ray
    function along(camera, canvas, axis, cx, cy) {
      const { o, d } = ray(camera, canvas, cx, cy), A = st.dir, w0 = origin.clone().sub(o), b = A.dot(d), dd = A.dot(w0), e = d.dot(w0), den = 1 - b * b;
      if (den < 1e-4) return null; return (b * e - dd) / den;
    }
    // rotate: angle of the mouse around the axis, in the ring's plane
    function angleAt(camera, canvas, cx, cy) {
      const { o, d } = ray(camera, canvas, cx, cy), n = st.dir, den = d.dot(n);
      if (Math.abs(den) < 0.06) return null;                       // ring seen edge-on
      const t = origin.clone().sub(o).dot(n) / den; if (t <= 0) return null;
      const v = o.clone().addScaledVector(d, t).sub(origin); return Math.atan2(v.dot(st.b), v.dot(st.a));
    }
    const api = {
      get active() { return !!st; }, get visible() { return root.visible; }, get axis() { return st ? st.axis : -1; }, get kind() { return mode; },
      mode(m) { mode = m === 'rotate' ? 'rotate' : 'move'; arrows.visible = mode === 'move'; rings.visible = mode === 'rotate'; },
      axisDir: axisW,
      show(p, quat) { if (!st) { origin.set(p[0], p[1], p[2]); if (quat) root.quaternion.copy(quat); else root.quaternion.set(0, 0, 0, 1); } root.position.set(p[0], p[1], p[2]); root.visible = true; },   // while dragging, the axis stays where the drag began
      hide() { root.visible = false; line.visible = false; hot = -1; st = null; paint(); },
      fit(camera, canvas) { if (!root.visible) return; root.scale.setScalar(scaleFor(camera, canvas)); },
      pick(camera, canvas, cx, cy) {
        if (!root.visible) return -1; const s = scaleFor(camera, canvas), O = screen(camera, canvas, root.position); if (O[2] > 1) return -1;
        let best = -1, bd = 12;
        if (mode === 'move') axes.forEach((a, i) => {
          const T = screen(camera, canvas, root.position.clone().addScaledVector(axisW(i), s * 1.18)), vx = T[0] - O[0], vy = T[1] - O[1], L2 = vx * vx + vy * vy;
          if (L2 < 4) return; const t = Math.max(0.12, Math.min(1, ((cx - O[0]) * vx + (cy - O[1]) * vy) / L2)), dist = Math.hypot(cx - O[0] - vx * t, cy - O[1] - vy * t);
          if (dist < bd) { bd = dist; best = i; }
        });
        else for (let i = 0; i < 3; i++) {
          let prev = null;
          for (let k = 0; k <= 48; k++) {
            const P = screen(camera, canvas, ringPt(i, k / 48 * Math.PI * 2, RING * s).applyQuaternion(root.quaternion).add(root.position));
            if (prev) { const vx = P[0] - prev[0], vy = P[1] - prev[1], L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((cx - prev[0]) * vx + (cy - prev[1]) * vy) / L2)), dist = Math.hypot(cx - prev[0] - vx * t, cy - prev[1] - vy * t); if (dist < bd) { bd = dist; best = i; } }
            prev = P;
          }
        }
        return best;
      },
      hover(i) { if (hot === i) return false; hot = i; paint(); return true; },
      begin(camera, canvas, axis, cx, cy) {
        origin.copy(root.position); const dir = axisW(axis);
        st = { axis, dir, cx, cy, last: 0, acc: 0 };
        if (mode === 'move') {
          st.t0 = along(camera, canvas, axis, cx, cy);
          lineG.setFromPoints([origin.clone().addScaledVector(dir, -2000), origin.clone().addScaledVector(dir, 2000)]); line.material.color.setHex(COLORS[axis]); line.visible = true;
        } else {
          const ref = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
          st.a = ref.clone().sub(dir.clone().multiplyScalar(ref.dot(dir))).normalize(); st.b = dir.clone().cross(st.a);
          st.prev = angleAt(camera, canvas, cx, cy); line.material.color.setHex(COLORS[axis]); line.visible = false;
        }
        paint();
      },
      drag(camera, canvas, cx, cy) {
        if (!st) return 0;
        if (mode === 'move') {
          const t = along(camera, canvas, st.axis, cx, cy);
          if (t == null || st.t0 == null) { const s = scaleFor(camera, canvas); st.last = -(cy - st.cy) / PX * s; return st.last; }   // looking straight along the axis
          st.last = t - st.t0; return st.last;
        }
        const a = angleAt(camera, canvas, cx, cy);
        if (a == null || st.prev == null) { st.last = st.acc + (cx - st.cx) * 0.5; return st.last; }   // edge-on: sideways mouse motion turns
        let da = a - st.prev; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; st.prev = a; st.acc += da * 180 / Math.PI; st.cx = cx;
        const s = scaleFor(camera, canvas), hand = st.a.clone().multiplyScalar(Math.cos(a)).add(st.b.clone().multiplyScalar(Math.sin(a))).multiplyScalar(RING * s);
        lineG.setFromPoints([origin.clone(), origin.clone().add(hand)]); line.visible = true;
        st.last = st.acc; return st.last;
      },
      end() { st = null; line.visible = false; paint(); }
    };
    paint(); return api;
  }
  window.Gizmo = { create };
})();
