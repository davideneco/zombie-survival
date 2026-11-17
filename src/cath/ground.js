import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { BLOCKS, PILLARS, NAVE, FLOOR_HOLES, CEIL_HOLES, computeEdges, interfaceDef, blockOf } from './plan2.js';

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
    const ceilHoles = (CEIL_HOLES[B.id] || []).map((h) => h.map(([s, t]) => W(s, t)));
    mesher.flat(mats.vault, quad, B.H, { holes: ceilHoles, up: false, uvFn: (x, z) => [S(x, z) / 8, T(x, z) / 8] });
    { // roof/vault ray collider so bullets cannot pierce ceilings/roofs vertically
      const c2 = quad.map(([x, z]) => new THREE.Vector2(x, z));
      const h2 = ceilHoles.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
      const all = [...c2, ...h2.flat()];
      const tris = THREE.ShapeUtils.triangulateShape(c2, h2).map(([i, j, k]) => [all[i].x, all[i].y, all[j].x, all[j].y, all[k].x, all[k].y]);
      if (tris.length) collision.addFloor(B.H, tris);
    }
  }

  // ------------------------------------------------------------------ murs
  const { interfaces, exterior } = computeEdges();
  const portalHW = plan.portal.hw;
  for (const e of exterior) {
    const B = blockOf(e.block);
    const [A, Bp] = lineOf(e.axis, e.pos, e.from, e.to);
    // grand portail : mur occidental du narthex percé à l'axe sous le linteau (5,42 m)
    if (B.id === 'narthex' && e.axis === 's' && e.pos === -46) {
      wallWithOpenings(A, Bp, (t) => t - e.from, B.H, B.tex, [{ c: 0, w: portalHW * 2, h: 5.42, kind: 'door' }]);
      continue;
    }
    wallWithOpenings(A, Bp, () => 0, B.H, B.tex, []);
  }

  // ------------------------------------------------------------------ taches de lumière colorée des vitraux, au sol (v0.46.0) : une image additive par lancette
  {
    const GL = CONFIG.graphics.glass, tk = (s, t) => W(s, t);
    const hh = (a, b, k) => { const v = Math.sin(a * 12.9898 + b * 78.233 + k * 37.7) * 43758.5453; return v - Math.floor(v); };
    const pool = (C, tang, inw, ww, len, skew, k) => { // C : pied de la fenêtre (monde), tang : le long du mur, inw : vers l'intérieur
      const cell = Math.floor(hh(C[0], C[1], 9) * 4), u0 = (cell % 2) * 0.5, v0 = Math.floor(cell / 2) * 0.5;
      const pt = (a, d, wd) => [C[0] + tang[0] * (a * wd * 0.5 + skew * d / len) + inw[0] * d, 0.05, C[1] + tang[1] * (a * wd * 0.5 + skew * d / len) + inw[1] * d];
      void k;
      mesher.quad(mats.lightPool, pt(-1, 0, ww), pt(1, 0, ww), pt(1, len, ww * 1.5), pt(-1, len, ww * 1.5), [u0, v0], [u0 + 0.5, v0], [u0 + 0.5, v0 + 0.5], [u0, v0 + 0.5]);
    };
    const eachWin = { aisle: [1.5, 4.5], transept: [1.5, 4.5], chapel: [3] };
    for (const e of exterior) {
      const B = blockOf(e.block), offs = eachWin[B.tex];
      if (!offs) continue;
      const [A, Bp] = lineOf(e.axis, e.pos, e.from, e.to);
      const L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), dx = (Bp[0] - A[0]) / L, dz = (Bp[1] - A[1]) / L;
      const inwS = e.axis === 's' ? [-e.nrm, 0] : [0, -e.nrm], base = e.axis === 's' ? [e.pos, 0] : [0, e.pos];
      const p0 = tk(base[0], base[1]), p1 = tk(base[0] + inwS[0], base[1] + inwS[1]), inw = [p1[0] - p0[0], p1[1] - p0[1]];
      for (let u = 0; u + 6 <= L + 0.01; u += 6) for (const o of offs) {
        const C = [A[0] + dx * (u + o) + inw[0] * 0.3, A[1] + dz * (u + o) + inw[1] * 0.3];
        pool(C, [dx, dz], inw, B.tex === 'chapel' ? 1.5 : 1.7, B.tex === 'chapel' ? 4.5 : 6.5, (hh(C[0], C[1], 3) - 0.5) * 2.2, 0);
      }
    }
    // nef : taches plus larges et plus fines venues des hautes fenêtres, sur le dallage entre les bancs
    for (const side of [-1, 1]) for (let s = NAVE.s0 + 3; s < NAVE.s1 - 2; s += 6) for (const o of [4.5]) {
      const C = W(s - 3 + o, side * (NAVE.hw - 1.5)), D = W(s - 3 + o, side * (NAVE.hw - 1.5) - side * 1), inw = [D[0] - C[0], D[1] - C[1]];
      const E = W(s - 2.5 + o, 0), tang = [E[0] - W(s - 3 + o, 0)[0], E[1] - W(s - 3 + o, 0)[1]];
      pool(C, [tang[0] * 2, tang[1] * 2], inw, 2.4, 9, (hh(C[0], C[1], 5) - 0.5) * 3, 1);
    }
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
      collision.addCircle(x, z, r + 0.3, 15.3, -0.5, 'wall');   // pilier : les galeries le contournent
      collision.addCircle(x, z, 0.62, h, 15.3, 'wall');         // fût mince au-dessus des galeries
    } else collision.addCircle(x, z, r + 0.3, h, -0.5, 'wall');
  };

  for (const f of interfaces) {
    const A = blockOf(f.a), Bk = blockOf(f.b), def = interfaceDef(f.a, f.b);
    const lo = Math.min(A.H, Bk.H), hi = Math.max(A.H, Bk.H), hiB = A.H >= Bk.H ? A : Bk;
    const [P0, P1] = lineOf(f.axis, f.pos, f.from, f.to);
    if (def.type === 'arcade' || def.type === 'west') continue; // construits à part
    if (def.type === 'open') {
      if (hi > lo + 0.05) { wallStrip(mats.plain, P0, P1, lo, hi, 'plain'); colSeg(P0, P1, lo, hi); } // le plafond change de hauteur
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
    colSeg(A, B, 14.5, 32);
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
  // ébrasement gothique du grand portail ouest : colonnettes en faisceau, voussures en arc brisé, tympan, gâble à crochets, pinacles et cadre intérieur
  {
    const [ox, oz] = plan.portal.pts[0], hw = plan.portal.hw;
    const sFacade = S(ox, oz) + 4;
    const sOut = Math.min(-47.4, sFacade - 1.3), sIn = -45.6, sInUp = -46.02;
    const depth = sIn - sOut, sMid = (sOut + sIn) / 2;
    const depthUp = sInUp - sOut, sMidUp = (sOut + sInUp) / 2;
    const theta = Math.atan2(axis.ux, axis.uz);
    const M = new THREE.Matrix4().makeTranslation(axis.cx, 0, axis.cz).multiply(new THREE.Matrix4().makeRotationY(theta));
    const stG = [], dkG = [], irG = [], gdG = [], glG = [];
    const push = (arr, g, x, y, z, rx = 0, ry = 0, rz = 0) => {
      if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
      arr.push(g.translate(x, y, z));
    };

    // seuils en pierre douce (perron progressif à 3 degrés, sous WALK_OVER = 0.3)
    push(dkG, new THREE.BoxGeometry(hw * 2 + 2.4, 0.14, depth + 0.8), 0, 0.07, sMid);
    push(stG, new THREE.BoxGeometry(hw * 2 + 3.2, 0.10, 0.9), 0, 0.05, sOut - 0.35);
    push(stG, new THREE.BoxGeometry(hw * 2 + 3.8, 0.06, 0.7), 0, 0.03, sOut - 1.0);

    // cadre intérieur étanche reliant l'ébrasement extérieur à l'ouverture du narthex (s = -46)
    push(dkG, new THREE.BoxGeometry(hw * 2 + 0.5, 0.34, depth + 0.4), 0, 5.52, sMid);
    push(stG, new THREE.BoxGeometry(hw * 2 + 1.0, 0.28, 0.36), 0, 5.54, sIn + 0.06);

    // 3 ressauts ébrasés par côté + colonnettes adossées sur fond de pierre sombre + contreforts + pinacles extérieurs
    const orders = [
      { t: hw + 0.18, s0: sOut + 0.92, s1: sIn, r: 0.16, yTop: 5.42 },
      { t: hw + 0.62, s0: sOut + 0.42, s1: sOut + 1.08, r: 0.18, yTop: 5.42 },
      { t: hw + 1.08, s0: sOut - 0.08, s1: sOut + 0.58, r: 0.20, yTop: 5.42 },
    ];
    for (const side of [-1, 1]) {
      // collision dégagée à la largeur libre du portail (±hw)
      const [ax, az] = W(sOut - 0.2, side * hw), [bx, bz] = W(sIn, side * hw);
      collision.addSegment(ax, az, bx, bz, 12, -0.5);

      // parement intérieur de la baie jusqu'au narthex (aucune fente ni vue sur les arêtes OSM)
      push(dkG, new THREE.BoxGeometry(0.42, 5.6, depth + 0.45), side * (hw + 0.2), 2.8, sMid);
      push(stG, new THREE.BoxGeometry(0.32, 5.65, 0.35), side * (hw + 0.18), 2.82, sIn + 0.06);
      if (side < 0) push(dkG, new THREE.BoxGeometry(0.46, 5.6, 0.52), -(hw - 0.15), 2.8, -45.82);

      // soubassement / banc de pierre et corniche d'imposte
      push(dkG, new THREE.BoxGeometry(1.48, 0.95, depth + 0.3), side * (hw + 0.74), 0.475, sMid);
      push(stG, new THREE.BoxGeometry(1.58, 0.18, depth + 0.38), side * (hw + 0.74), 0.99, sMid);
      push(dkG, new THREE.BoxGeometry(1.58, 0.24, depth + 0.38), side * (hw + 0.74), 5.44, sMid);

      // dosserets sombres en retrait + fûts élancés en grès rose avec bases, chapiteaux et anneaux dorés
      for (const o of orders) {
        const lenO = o.s1 - o.s0;
        push(dkG, new THREE.BoxGeometry(0.38, o.yTop - 1.0, lenO), side * (o.t + 0.22), 1.0 + (o.yTop - 1.0) / 2, (o.s0 + o.s1) / 2);
        push(stG, new THREE.CylinderGeometry(o.r * 0.96, o.r * 1.04, o.yTop - 1.42, 12), side * o.t, 1.08 + (o.yTop - 1.42) / 2, o.s0 + 0.14);
        push(dkG, new THREE.CylinderGeometry(o.r * 1.42, o.r * 1.56, 0.26, 10), side * o.t, 1.15, o.s0 + 0.14);
        push(dkG, new THREE.CylinderGeometry(o.r * 1.62, o.r * 1.05, 0.44, 10), side * o.t, o.yTop - 0.18, o.s0 + 0.14);
        push(gdG, new THREE.TorusGeometry(o.r * 1.18, 0.032, 6, 14), side * o.t, o.yTop - 0.40, o.s0 + 0.14, Math.PI / 2);
      }

      // contreforts massifs et grands pinacles à crochets encadrant le portail
      const px = side * (hw + 1.62), pz = sOut + 0.08;
      push(stG, new THREE.BoxGeometry(0.98, 13.8, 1.18), px, 6.9, pz);
      push(dkG, new THREE.BoxGeometry(1.16, 0.34, 1.36), px, 13.8, pz);
      push(stG, new THREE.CylinderGeometry(0.32, 0.44, 2.2, 6), px, 14.9, pz);
      push(dkG, new THREE.ConeGeometry(0.48, 3.1, 6), px, 17.5, pz);
      push(gdG, new THREE.SphereGeometry(0.14, 8, 6), px, 19.1, pz);

      // lanternes en fer forgé sur les piédroits (éclairent directement les colonnettes et les vantaux)
      const lx = side * (hw + 1.06), ly = 4.15, lz = sOut - 0.35;
      push(irG, new THREE.BoxGeometry(0.1, 0.1, 0.6), lx, ly + 0.28, lz);
      push(irG, new THREE.CylinderGeometry(0.18, 0.14, 0.36, 6), lx, ly, lz - 0.24);
      push(dkG, new THREE.ConeGeometry(0.24, 0.22, 6), lx, ly + 0.26, lz - 0.24);
      push(glG, new THREE.CylinderGeometry(0.13, 0.1, 0.26, 6), lx, ly, lz - 0.24);
      const [wx, wz] = W(sOut - 0.8, side * (hw + 0.6));
      lightSources.push({ x: wx, y: 3.9, z: wz, color: 0xffb86c, intensity: 18, dist: 16 });
    }

    // voussures en arc brisé équilatéral (4 rangs profonds)
    const archSteps = 12;
    const archRings = [
      { tw: hw + 0.06, rThick: 0.46, s0: sOut + 0.72, s1: sInUp, mat: stG },
      { tw: hw + 0.54, rThick: 0.46, s0: sOut + 0.30, s1: sOut + 0.85, mat: dkG },
      { tw: hw + 1.00, rThick: 0.48, s0: sOut - 0.16, s1: sOut + 0.42, mat: stG },
      { tw: hw + 1.40, rThick: 0.38, s0: sOut - 0.40, s1: sOut + 0.05, mat: dkG },
    ];
    for (const ar of archRings) {
      const lenA = ar.s1 - ar.s0, sAvg = (ar.s0 + ar.s1) / 2;
      const ptsA = archPoints(-ar.tw, ar.tw, 5.45, archSteps);
      for (let i = 0; i + 1 < ptsA.length; i++) {
        const [x0, y0] = ptsA[i], [x1, y1] = ptsA[i + 1];
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const segL = Math.hypot(x1 - x0, y1 - y0) + 0.08;
        const ang = Math.atan2(y1 - y0, x1 - x0);
        push(ar.mat, new THREE.BoxGeometry(segL, ar.rThick, lenA), mx, my, sAvg, 0, 0, ang);
      }
    }

    // linteau mouluré + tympan sculpté plein jusqu'au parement ouest du narthex (strictement <= -46,02)
    push(dkG, new THREE.BoxGeometry(hw * 2 + 0.7, 0.52, depth + 0.15), 0, 5.65, sMid);
    push(stG, new THREE.BoxGeometry(hw * 2 + 0.3, 0.22, depthUp + 0.08), 0, 5.95, sMidUp);
    const tympY0 = 5.9, tympH = 4.25;
    for (let i = 0; i < 8; i++) {
      const f = i / 8, wRow = hw * 2 * Math.max(0.18, 1 - f * 0.88), yRow = tympY0 + f * (tympH * 0.82);
      push(stG, new THREE.BoxGeometry(wRow + 0.4, 0.58, depthUp - 0.06), 0, yRow + 0.25, sMidUp);
    }
    // rosace / mandorle sculptée au centre du tympan
    push(dkG, new THREE.TorusGeometry(1.15, 0.14, 8, 20), 0, 7.35, sOut + 0.02);
    push(gdG, new THREE.TorusGeometry(0.75, 0.08, 6, 16), 0, 7.35, sOut - 0.04);
    push(gdG, new THREE.CylinderGeometry(0.16, 0.16, 0.24, 12), 0, 7.35, sOut - 0.06, Math.PI / 2);

    // grand gâble triangulaire à crochets couronnant le portail (y = 5.9 -> 14.8 m)
    const gBaseW = hw + 1.32, gBaseY = 5.9, gPeakY = 14.6, gAng = Math.atan2(gPeakY - gBaseY, gBaseW), gSlope = Math.hypot(gBaseW, gPeakY - gBaseY);
    for (const side of [-1, 1]) {
      push(stG, new THREE.BoxGeometry(gSlope + 0.4, 0.56, 0.58), side * gBaseW * 0.5, (gBaseY + gPeakY) / 2, sOut - 0.34, 0, 0, -side * gAng);
      push(dkG, new THREE.BoxGeometry(gSlope + 0.3, 0.24, 0.66), side * gBaseW * 0.5, (gBaseY + gPeakY) / 2 + 0.26, sOut - 0.34, 0, 0, -side * gAng);
      for (let c = 1; c <= 5; c++) {
        const u = c / 6;
        push(stG, new THREE.BoxGeometry(0.28, 0.48, 0.36), side * gBaseW * (1 - u), gBaseY + u * (gPeakY - gBaseY) + 0.48, sOut - 0.34, 0, 0, -side * 0.35);
      }
    }
    // fleuron et croix dorée au sommet du gâble + écoinçon ajouré
    push(stG, new THREE.BoxGeometry(0.55, 1.35, 0.55), 0, gPeakY + 0.45, sOut - 0.34);
    push(gdG, new THREE.BoxGeometry(0.14, 1.45, 0.14), 0, gPeakY + 1.7, sOut - 0.34);
    push(gdG, new THREE.BoxGeometry(0.75, 0.14, 0.14), 0, gPeakY + 1.95, sOut - 0.34);
    push(dkG, new THREE.TorusGeometry(0.95, 0.13, 6, 18), 0, 11.4, sOut - 0.32);

    // pont d'étanchéité haut entre gâble et mur OSM (sOut -> sInUp à 8,5..11 m)
    push(stG, new THREE.BoxGeometry(hw * 2 + 2.4, 1.6, depthUp), 0, 10.1, sMidUp);

    mesher.geo(mats.stone, mergeGeos(stG), M);
    mesher.geo(mats.stoneDark, mergeGeos(dkG), M);
    if (irG.length) mesher.geo(mats.iron, mergeGeos(irG), M);
    if (gdG.length) mesher.geo(mats.gold, mergeGeos(gdG), M);
    if (glG.length) mesher.geo(new THREE.MeshBasicMaterial({ color: 0xffd27a }), mergeGeos(glG), M);
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
