import * as THREE from 'three';
import { CRYPT, CRYPT_STAIRS } from './plan2.js';
import { mergeSimple } from './upper.js';

// Crypte romane sous le chœur : voûtes d'arêtes basses sur six colonnes, accessible par deux escaliers (croisée nord et sud).
export function buildCrypt(h) {
  const { collision, lightSources, mats, mesher, levels, W } = h;
  const R = levels.addRegion('Crypte romane', CRYPT.y);
  const { s0, s1, t, y: Y0, H } = CRYPT;
  const rect = [[s0, -t], [s1, -t], [s1, t], [s0, t]];
  const poly = rect.map(([s, tt]) => W(s, tt));
  const tris = levels.addPoly(R, poly, Y0);
  mesher.flat(mats.floor, poly, Y0 + 0.02, { uvScale: 3 });
  collision.addFloor(Y0, tris);
  // voûte (sous le sol du chœur) et murs
  mesher.flat(mats.vault, poly, Y0 + H, { up: false, uvFn: (x, z) => [x / 6, z / 6] });
  const walls = [[[s0, -t], [s1, -t]], [[s1, -t], [s1, t]], [[s1, t], [s0, t]]];
  for (const [a, b] of walls) {
    const A = W(...a), B = W(...b);
    mesher.strip(mats.stoneDark, [A, B], Y0, Y0 + H, { uScale: 3, vScale: 3 });
    collision.addSegment(A[0], A[1], B[0], B[1], Y0 + H, Y0 - 0.5);
  }
  // mur ouest : plein sauf aux deux débouchés d'escalier
  {
    const solid = [[-t, CRYPT_STAIRS[0].t0], [CRYPT_STAIRS[0].t1, CRYPT_STAIRS[1].t0], [CRYPT_STAIRS[1].t1, t]];
    for (const [ta, tb] of solid) {
      const A = W(s0, ta), B = W(s0, tb);
      mesher.strip(mats.stoneDark, [A, B], Y0, Y0 + H, { uScale: 3, vScale: 3 });
      collision.addSegment(A[0], A[1], B[0], B[1], Y0 + H, Y0 - 0.5);
    }
  }
  // six colonnes romanes
  const g = [];
  for (const s of [47, 50, 53]) for (const tt of [-3.6, 3.6]) {
    const [x, z] = W(s, tt);
    g.push(new THREE.CylinderGeometry(0.5, 0.58, H, 10).translate(x, Y0 + H / 2, z));
    g.push(new THREE.BoxGeometry(1.3, 0.35, 1.3).translate(x, Y0 + H - 0.2, z));
    collision.addCircle(x, z, 0.75, Y0 + H, Y0 - 0.5);
    lightSources.push({ x, y: Y0 + 2.6, z, color: 0xffa860, intensity: 7, dist: 11 });
  }
  mesher.geo(mats.stone, mergeSimple(g));
  // sarcophages (décor)
  const sg = [];
  for (const [s, tt, rot] of [[54.5, -7, 0], [54.5, 7, 0], [49, 0, 1.57]]) {
    const [x, z] = W(s, tt);
    sg.push(new THREE.BoxGeometry(2.2, 0.8, 0.9).rotateY(rot).translate(x, Y0 + 0.4, z));
    collision.addBox(x, z, rot ? 0.9 : 2.2, rot ? 2.2 : 0.9, 0, 0.8, Y0 - 0.5);
  }
  mesher.geo(mats.stone, mergeSimple(sg));
  levels.regions[R].spawns.push(...[[46, -6], [46, 6], [52, 0], [55, -6], [55, 6]].map(([s, tt]) => W(s, tt)));

  // escaliers : marches visibles, rampe praticable, parois et lien sol <-> crypte
  for (const st of CRYPT_STAIRS) {
    const SR = levels.addRegion(`Escalier de la crypte ${st.side < 0 ? 'nord' : 'sud'}`, Y0 / 2, 'stair');
    const run = st.s1 - st.s0, n = 21;
    const tm = (st.t0 + st.t1) / 2;
    const q = [[st.s0, st.t0, 0], [st.s0, st.t1, 0], [st.s1, st.t1, Y0], [st.s1, st.t0, Y0]].map(([s, tt, yy]) => { const [x, z] = W(s, tt); return [x, yy, z]; });
    levels.addQuad(SR, q[0], q[1], q[2], q[3]);
    levels.addGroundHole([[st.s0 + 0.15, st.t0], [st.s1, st.t0], [st.s1, st.t1], [st.s0 + 0.15, st.t1]].map(([s, tt]) => W(s, tt)));
    const steps = [];
    const [ex, ez] = W(0, 0), axisRot = Math.atan2(-(W(1, 0)[1] - ez), W(1, 0)[0] - ex); // rotation Y qui aligne l'axe x de la boîte sur l'axe de la nef
    for (let k = 0; k < n; k++) {
      const sA = st.s0 + (run * k) / n, yA = (Y0 * (k + 1)) / n;
      const [x, z] = W(sA + run / n / 2, tm);
      steps.push(new THREE.BoxGeometry(run / n + 0.02, 0.9, st.t1 - st.t0).rotateY(axisRot).translate(x, yA - 0.45 + 0.0, z));
    }
    mesher.geo(mats.stone, mergeSimple(steps));
    // parois de la cage d'escalier (le trou du sol est bordé de murs bas)
    for (const tt of [st.t0, st.t1]) {
      const A = W(st.s0, tt), B = W(st.s1, tt);
      mesher.strip(mats.stoneDark, [A, B], Y0, 1.0, { uScale: 3, vScale: 3 });
      collision.addSegment(A[0], A[1], B[0], B[1], 1.0, Y0 - 0.5);
    }
    const A = W(st.s1, st.t0), B = W(st.s1, st.t1);
    // (le bas de l'escalier débouche dans la crypte : pas de mur)
    const path = [[...W(st.s0 - 1.2, tm)], [...W(st.s0, tm)], [...W(st.s1, tm)], [...W(st.s1 + 1.2, tm)]].map((p, i) => [p[0], [0, 0, Y0, Y0][i], p[1]]);
    levels.addLink(`Escalier de la crypte ${st.side < 0 ? 'nord' : 'sud'}`, 0, R, path, SR);
    lightSources.push({ x: W(st.s0 + 3, tm)[0], y: 1.5, z: W(st.s0 + 3, tm)[1], color: 0xffa860, intensity: 6, dist: 9 });
  }
  return { region: R };
}
