import * as THREE from 'three';
import { BLOCKS, PILLARS, NAVE, FLOOR_HOLES, computeEdges, interfaceDef, blockOf } from './plan2.js';

// Rez-de-chaussée de la cathédrale : dallage, voûtes, murs à vitraux, arcades de la nef, murs de refend percés d'arcs,
// rosace, bancs, maître-autel, lustres. Tout est construit dans le repère (s, t) puis converti en coordonnées monde.

export const PORTAL_H = 8.5;
export const TEXV = {
  aisle: { vScale: 14.5, vOrigin: 0 }, chapel: { vScale: 12, vOrigin: 0 }, transept: { vScale: 28, vOrigin: 0 },
  plain: { vScale: 8, vOrigin: 0, uScale: 8 }, tower: { vScale: 21.5, vOrigin: 0 }, nave: { vScale: 17.5, vOrigin: 14.5 }, naveUp: { vScale: 17.5, vOrigin: 14.5 },
};

// Arc brisé équilatéral entre u0 et u1, départ des retombées à la hauteur h0 : points (u, y) de gauche à droite
export function archPoints(u0, u1, h0, n = 14) {
  const w = u1 - u0, pts = [];
  for (let k = 0; k <= n; k++) { // arc de gauche : centre sur la retombée droite
    const th = Math.PI - (k / n) * (Math.PI / 3);
    pts.push([u1 + w * Math.cos(th), h0 + w * Math.sin(th)]);
  }
  for (let k = 1; k <= n; k++) { // arc de droite : centre sur la retombée gauche
    const th = Math.PI / 3 - (k / n) * (Math.PI / 3);
    pts.push([u0 + w * Math.cos(th), h0 + w * Math.sin(th)]);
  }
  pts[0] = [u0, h0]; pts[pts.length - 1] = [u1, h0];
  return pts;
}

export function buildGround(ctx) {
  const { scene, plan, collision, lightSources, props, mats, mesher, levels } = ctx;
  const { S, T, P, axis } = plan;
  const W = (s, t) => P(s, t);
  const out = { pillars: [], altar: null };
  const wallTex = (kind) => mats.wall[kind] || mats.plain;
  const lineOf = (axisName, pos, a, b) => (axisName === 's' ? [W(pos, a), W(pos, b)] : [W(a, pos), W(b, pos)]);
  const colSeg = (A, B, y0, h) => collision.addSegment(A[0], A[1], B[0], B[1], h, y0);

  // Polygone vertical sur le plan A -> B : poly = [[u, y]…] (u en mètres depuis A)
  const vpoly = (mat, A, B, poly, o = {}) => {
    const { uScale = 6, vScale = 32, vOrigin = 0, holes = [] } = o;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L;
    const contour = poly.map(([u, y]) => new THREE.Vector2(u, y));
    const hs = holes.map((h) => h.map(([u, y]) => new THREE.Vector2(u, y)));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = [...contour, ...hs.flat()];
    for (const [i, j, k] of tris) {
      const pt = (c) => [A[0] + dx * c.x, c.y, A[1] + dz * c.x];
      const uv = (c) => [c.x / uScale, (c.y - vOrigin) / vScale];
      mesher.tri(mat, pt(all[i]), pt(all[j]), pt(all[k]), uv(all[i]), uv(all[j]), uv(all[k]));
    }
  };
  out.vpoly = vpoly;
  // Mur plein A -> B entre y0 et y1
  const wallStrip = (mat, A, B, y0, y1, kind) => {
    const tv = TEXV[kind] || TEXV.plain;
    mesher.strip(mat, [A, B], y0, y1, { uScale: tv.uScale || 6, vScale: tv.vScale, vOrigin: tv.vOrigin });
  };
  // Mur A -> B (longueur L) percé d'ouvertures [{c, w, h, kind}] exprimées en coordonnée u depuis A (c = centre)
  const wallWithOpenings = (A, B, uOf, Hwall, kind, openings, collide = true) => {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const mat = wallTex(kind), tv = TEXV[kind] || TEXV.plain;
    const dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L;
    const ops = openings.map((o) => ({ ...o, u0: uOf(o.c) - o.w / 2, u1: uOf(o.c) + o.w / 2 })).filter((o) => o.u0 >= -0.01 && o.u1 <= L + 0.01).sort((a, b) => a.u0 - b.u0);
    let u = 0;
    const solid = (a, b) => { // tronçon plein
      if (b - a < 0.05) return;
      const P0 = [A[0] + dx * a, A[1] + dz * a], P1 = [A[0] + dx * b, A[1] + dz * b];
      mesher.strip(mat, [P0, P1], 0, Hwall, { uScale: tv.uScale || 6, vScale: tv.vScale, vOrigin: tv.vOrigin, uStart: a / (tv.uScale || 6) });
      if (collide) colSeg(P0, P1, -0.5, Hwall);
    };
    for (const o of ops) {
      solid(u, o.u0);
      // au-dessus de l'ouverture : tympan (arc brisé) ou linteau
      const top = o.kind === 'door' ? [[o.u0, o.h], [o.u1, o.h], [o.u1, Hwall], [o.u0, Hwall]]
        : [...archPoints(o.u0, o.u1, o.h), [o.u1, Hwall], [o.u0, Hwall]];
      vpoly(mat, A, B, top, { uScale: tv.uScale || 6, vScale: tv.vScale, vOrigin: tv.vOrigin });
      u = o.u1;
    }
    solid(u, L);
  };

  // ------------------------------------------------------------------ sols et voûtes
  for (const B of BLOCKS) {
    const [s0, t0, s1, t1] = B.r;
    const quad = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => W(s, t));
    const holes = (FLOOR_HOLES[B.id] || []).map((h) => h.map(([s, t]) => W(s, t)));
    mesher.flat(mats.floor, quad, 0.03, { uvScale: 4.8, holes });
    mesher.flat(mats.vault, quad, B.H, { up: false, uvFn: (x, z) => [S(x, z) / 8, T(x, z) / 8] });
  }

  // ------------------------------------------------------------------ murs
  const { interfaces, exterior } = computeEdges();
  const portalHW = plan.portal.hw;
  for (const e of exterior) {
    const B = blockOf(e.block);
    const [A, Bp] = lineOf(e.axis, e.pos, e.from, e.to);
    // grand portail : mur occidental du narthex percé à l'axe
    if (B.id === 'narthex' && e.axis === 's' && e.pos === -46) {
      wallWithOpenings(A, Bp, (t) => t - e.from, B.H, B.tex, [{ c: 0, w: portalHW * 2, h: PORTAL_H, kind: 'door' }]);
      continue;
    }
    wallWithOpenings(A, Bp, () => 0, B.H, B.tex, []);
  }

  const pillarGeo = [];
  const pillarAt = (s, t, r, h) => {
    const [x, z] = W(s, t);
    const mid = Math.min(h, 14.5); // jusqu'à la naissance des voûtes des bas-côtés : fût épais ; au-dessus : faisceau de colonnettes
    pillarGeo.push(new THREE.CylinderGeometry(r, r * 1.08, mid, 14).translate(x, mid / 2, z));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; pillarGeo.push(new THREE.CylinderGeometry(0.2, 0.2, h, 8).translate(x + Math.cos(a) * (r + 0.05), h / 2, z + Math.sin(a) * (r + 0.05))); }
    pillarGeo.push(new THREE.BoxGeometry(r * 2.8, 0.5, r * 2.8).translate(x, 0.25, z));
    if (h > 14.5) {
      pillarGeo.push(new THREE.CylinderGeometry(r + 0.32, r, 0.7, 14).translate(x, 14.85, z)); // chapiteau
      pillarGeo.push(new THREE.CylinderGeometry(0.5, 0.5, h - 14.5, 10).translate(x, (h + 14.5) / 2, z));
      collision.addCircle(x, z, r + 0.3, 15.3, -0.5);   // pilier : les galeries le contournent
      collision.addCircle(x, z, 0.62, h, 15.3);         // fût mince au-dessus des galeries
    } else collision.addCircle(x, z, r + 0.3, h, -0.5);
  };

  for (const f of interfaces) {
    const A = blockOf(f.a), Bk = blockOf(f.b), def = interfaceDef(f.a, f.b);
    const lo = Math.min(A.H, Bk.H), hi = Math.max(A.H, Bk.H), hiB = A.H >= Bk.H ? A : Bk;
    const [P0, P1] = lineOf(f.axis, f.pos, f.from, f.to);
    if (def.type === 'arcade' || def.type === 'west') continue; // construits à part
    if (def.type === 'open') {
      if (hi > lo + 0.05) wallStrip(mats.plain, P0, P1, lo, hi, 'plain'); // le plafond change de hauteur
      continue;
    }
    if (def.type === 'wall') { wallWithOpenings(P0, P1, () => 0, hi, hiB.tex, []); continue; }
    // refend percé d'ouvertures
    wallWithOpenings(P0, P1, (c) => c - f.from, hi, hiB.tex, def.openings || []);
  }

  // ------------------------------------------------------------------ arcade de la nef : arcs entre piliers, mur haut à fenêtres
  for (const side of [-1, 1]) {
    const t = side * NAVE.hw;
    const R = 1.0;
    for (let k = 0; k < PILLARS.length; k++) pillarAt(PILLARS[k], t, k === 0 || k === PILLARS.length - 1 ? 1.2 : R, 32);
    for (let k = 0; k + 1 < PILLARS.length; k++) {
      const s0 = PILLARS[k] + R, s1 = PILLARS[k + 1] - R;
      const A = W(PILLARS[k], t), B = W(PILLARS[k + 1], t);
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const u0 = R, u1 = L - R;
      // tympan au-dessus de l'arc, jusqu'à la naissance des voûtes du bas-côté (14,5 m)
      vpoly(mats.stone, A, B, [...archPoints(u0, u1, 7.2), [u1, 14.5], [u0, 14.5]], { uScale: 4, vScale: 4 });
    }
    // mur haut : triforium puis fenêtres hautes (14,5 -> 32 m)
    const A = W(NAVE.s0, t), B = W(NAVE.s1, t);
    mesher.strip(mats.wall.naveUp, [A, B], 14.5, 32, { uScale: 6, vScale: 17.5, vOrigin: 14.5 });
  }
  mesher.geo(mats.stone, mergeGeos(pillarGeo));

  // ------------------------------------------------------------------ bancs
  {
    const rotU = Math.atan2(axis.ux, axis.uz) - Math.PI / 2;
    const sA = -32, sB = 9;
    for (const side of [-1, 1]) {
      const tc = side * 4.0;
      for (let s = sA; s < sB; s += 1.4) { const [x, z] = W(s, tc); props.place('pew', x, z, rotU + Math.PI / 2, 1, null, 0, 0); }
      const [mx, mz] = W((sA + sB) / 2, tc);
      collision.addBox(mx, mz, sB - sA, 4.4, -rotU, 1.1);
    }
    props.setPewLength?.(4.4);
  }

  // ------------------------------------------------------------------ maître-autel au fond du chœur
  {
    const [x, z] = W(57.2, 0), rot = Math.atan2(-axis.ux, -axis.uz);
    out.altar = { p: [x, z], rot };
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.45, 6), mats.stone).translateY(0.225));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 1.3), mats.stone).translateY(1.0));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 1.5), new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.9 })).translateY(1.59));
    const cross = new THREE.Group(); cross.position.set(0, 1.6, -0.3);
    cross.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.08), mats.gold).translateY(0.7), new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.08), mats.gold).translateY(1.0));
    g.add(cross);
    const wax = new THREE.MeshStandardMaterial({ color: 0xf2ead2, roughness: 0.9 }), flame = new THREE.MeshStandardMaterial({ color: 0xffd080, emissive: 0xffa040, emissiveIntensity: 3 });
    for (let k = 0; k < 6; k++) {
      const cx = -1.3 + k * 0.52;
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), wax).translateX(cx).translateY(1.88).translateZ(0.3));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), flame).translateX(cx).translateY(2.18).translateZ(0.3));
    }
    g.position.set(x, 0, z); g.rotation.y = rot;
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
    collision.addBox(x, z, 3.4, 1.5, -rot, 1.6);
    lightSources.push({ x, y: 3, z, color: 0xffb060, intensity: 14, dist: 14 });
  }

  // ------------------------------------------------------------------ lustres et lumières
  const ringG = [];
  for (let s = -30; s <= 24; s += 11) {
    const [x, z] = W(s, 0);
    lightSources.push({ x, y: 8, z, color: 0xffc890, intensity: 16, dist: 22 });
    ringG.push(new THREE.TorusGeometry(1.5, 0.07, 6, 24).rotateX(Math.PI / 2).translate(x, 9, z));
    ringG.push(new THREE.CylinderGeometry(0.03, 0.03, 23, 4).translate(x, 20.5, z));
  }
  mesher.geo(mats.gold, mergeGeos(ringG));
  for (const [s, t, col] of [[-41.5, 0, 0xffb878], [-41.5, -16, 0xffb878], [-41.5, 16, 0xffb878], [20, 0, 0xffc890], [37, 0, 0xffc890], [37, -22, 0xffb070], [37, 22, 0xffb070], [51, 0, 0xffb060], [52, -14, 0xffb070], [52, 14, 0xffb070], [18, -25, 0xffb070], [18, 24, 0xffb070], [-20, -14, 0xa8b8ff], [-20, 14, 0xa8b8ff], [0, -14, 0xa8b8ff], [0, 14, 0xa8b8ff]]) {
    const [x, z] = W(s, t);
    lightSources.push({ x, y: 6, z, color: col, intensity: 11, dist: 16 });
  }
  // ébrasement du grand portail (entre le contour extérieur et le mur ouest) : deux joues et un linteau
  {
    const [ox, oz] = plan.portal.pts[0], [ix, iz] = W(-46, 0), hw = plan.portal.hw;
    for (const side of [-1, 1]) {
      const a = [ox + axis.vx * hw * side, oz + axis.vz * hw * side], b = [ix + axis.vx * hw * side, iz + axis.vz * hw * side];
      collision.addSegment(a[0], a[1], b[0], b[1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, PORTAL_H + 1, len), mats.stone);
      m.position.set((a[0] + b[0]) / 2 + axis.vx * 0.3 * side, (PORTAL_H + 1) / 2, (a[1] + b[1]) / 2 + axis.vz * 0.3 * side);
      m.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]); m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    const len = Math.hypot(ix - ox, iz - oz);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.2, 1, len), mats.stone);
    lintel.position.set((ox + ix) / 2, PORTAL_H + 0.5, (oz + iz) / 2); lintel.rotation.y = Math.atan2(ix - ox, iz - oz);
    scene.add(lintel);
  }
  return out;
}

export function mergeGeos(list) {
  const pos = [], nor = [], uv = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array((g.attributes.position.count) * 2)));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
