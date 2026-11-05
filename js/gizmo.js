/* Move gizmo like in Blender: three arrows X (red), Y (green), Z (blue) that are dragged with the mouse.
   const g = Gizmo.create(scene);  g.show([x, y, z]) / g.hide();  g.fit(camera, canvas) before every render;
   g.pick(camera, canvas, clientX, clientY) -> 0 | 1 | 2 | -1;  g.begin(...axis, x, y);  g.drag(camera, canvas, x, y) -> distance along the axis
   since begin (in blocks, not rounded);  g.end(). Always drawn on top, keeps the same size on screen. */
(function () {
  const COLORS = [0xe74c3c, 0x2ecc71, 0x3a8ee6], HOT = 0xffd24a, PX = 96;   // arrow length in screen pixels
  function letter(t, col) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#' + col.toString(16).padStart(6, '0'); g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '700 38px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 32, 34);
    const tex = new THREE.CanvasTexture(c), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(0.22, 0.22, 1); sp.renderOrder = 32; return sp;
  }
  function create(scene) {
    const root = new THREE.Group(); root.visible = false; root.renderOrder = 30; scene.add(root);
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)], parts = [];
    const shaftG = new THREE.CylinderGeometry(0.028, 0.028, 0.82, 10), headG = new THREE.ConeGeometry(0.085, 0.2, 16);
    axes.forEach((a, i) => {
      const grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: COLORS[i], depthTest: false, transparent: true });
      const shaft = new THREE.Mesh(shaftG, mat), head = new THREE.Mesh(headG, mat); shaft.position.y = 0.41; head.position.y = 0.92;
      shaft.renderOrder = head.renderOrder = 31; grp.add(shaft, head);
      const lab = letter('XYZ'[i], COLORS[i]); lab.position.y = 1.14; grp.add(lab);
      if (i === 0) grp.rotation.z = -Math.PI / 2; if (i === 2) grp.rotation.x = Math.PI / 2;
      root.add(grp); parts.push({ grp, mat });
    });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })); dot.renderOrder = 32; root.add(dot);
    // a long thin line along the axis being dragged
    const lineG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0)]);
    const line = new THREE.Line(lineG, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: .7 })); line.visible = false; line.renderOrder = 29; scene.add(line);
    let hot = -1, st = null; const origin = new THREE.Vector3();
    const paint = () => parts.forEach((p, i) => { p.mat.color.setHex(i === hot || (st && st.axis === i) ? HOT : COLORS[i]); p.mat.opacity = st && st.axis !== i ? 0.25 : 1; });
    function scaleFor(camera, canvas) { const h = canvas.clientHeight || canvas.height || 600, d = camera.position.distanceTo(root.position); return 2 * d * Math.tan(camera.fov * Math.PI / 360) * PX / h; }
    function ray(camera, canvas, cx, cy) {
      const r = canvas.getBoundingClientRect(); camera.updateMatrixWorld();
      const v = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5).unproject(camera), o = camera.position.clone();
      return { o, d: v.sub(o).normalize() };
    }
    function screen(camera, canvas, p) { const q = p.clone().project(camera), r = canvas.getBoundingClientRect(); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height, q.z]; }
    // parameter along the axis (through origin) of the point closest to the mouse ray
    function along(camera, canvas, axis, cx, cy) {
      const { o, d } = ray(camera, canvas, cx, cy), A = axes[axis], w0 = origin.clone().sub(o), b = A.dot(d), dd = A.dot(w0), e = d.dot(w0), den = 1 - b * b;
      if (den < 1e-4) return null; return (b * e - dd) / den;
    }
    const api = {
      get active() { return !!st; }, get visible() { return root.visible; }, get axis() { return st ? st.axis : -1; },
      show(p) { if (!st) origin.set(p[0], p[1], p[2]); root.position.set(p[0], p[1], p[2]); root.visible = true; },   // while dragging, the axis stays where the drag began
      hide() { root.visible = false; line.visible = false; hot = -1; st = null; paint(); },
      fit(camera, canvas) { if (!root.visible) return; root.scale.setScalar(scaleFor(camera, canvas)); },
      pick(camera, canvas, cx, cy) {
        if (!root.visible) return -1; const s = scaleFor(camera, canvas), O = screen(camera, canvas, root.position); if (O[2] > 1) return -1;
        let best = -1, bd = 12;
        axes.forEach((a, i) => {
          const T = screen(camera, canvas, root.position.clone().addScaledVector(a, s * 1.18)), vx = T[0] - O[0], vy = T[1] - O[1], L2 = vx * vx + vy * vy;
          if (L2 < 4) return; const t = Math.max(0.12, Math.min(1, ((cx - O[0]) * vx + (cy - O[1]) * vy) / L2)), dist = Math.hypot(cx - O[0] - vx * t, cy - O[1] - vy * t);
          if (dist < bd) { bd = dist; best = i; }
        });
        return best;
      },
      hover(i) { if (hot === i) return false; hot = i; paint(); return true; },
      begin(camera, canvas, axis, cx, cy) {
        origin.copy(root.position); const t0 = along(camera, canvas, axis, cx, cy);
        st = { axis, t0, cx, cy, last: 0 }; paint();
        line.position.copy(origin); line.scale.setScalar(2000); line.rotation.set(0, 0, 0); if (axis === 1) line.rotation.z = Math.PI / 2; if (axis === 2) line.rotation.y = -Math.PI / 2;
        line.material.color.setHex(COLORS[axis]); line.visible = true;
      },
      drag(camera, canvas, cx, cy) {
        if (!st) return 0; const t = along(camera, canvas, st.axis, cx, cy);
        if (t == null || st.t0 == null) {   // looking straight along the axis: use vertical mouse motion
          const s = scaleFor(camera, canvas); st.last = -(cy - st.cy) / PX * s; return st.last;
        }
        st.last = t - st.t0; return st.last;
      },
      // keep the arrows on the moved object while dragging (the axis line stays where the drag began)
      follow(p) { root.position.set(p[0], p[1], p[2]); },
      end() { st = null; line.visible = false; paint(); }
    };
    paint(); return api;
  }
  window.Gizmo = { create };
})();
