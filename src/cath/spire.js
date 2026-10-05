import * as THREE from 'three';
import { mergeSimple } from './upper.js';

// Tour nord et flèche : fût octogonal à tourelles d'angle (de 67,5 à 104 m) avec un grand escalier en colimaçon intérieur,
// terrasse sommitale à garde-corps (104 m), flèche en pagode étagée entourée d'une rampe hélicoïdale (de 104 à 128 m),
// pointe (128 m) et aiguille jusqu'à 142 m.
export const TOWER = { c: [-39.5, -14], R: 9.6, top: 104, tip: 128, needle: 142 };

export function buildSpire(h) {
  const { scene, collision, lightSources, mats, mesher, levels, W, polar, spiral, slab, pad, rail, circleST, ironBox, Y, regions } = h;
  const { c, R, top: TOP_Y, tip: TIP_Y } = TOWER;
  const DEG = Math.PI / 180;
  const TOP = levels.addRegion('Terrasse de la flèche', TOP_Y);
  const TIP = levels.addRegion('Pointe de la flèche', TIP_Y);
  const out = { TOP, TIP };

  // ------------------------------------------------------------------ fût octogonal
  for (let k = 0; k < 8; k++) {
    const A = polar(c, R, -22.5 + 45 * k), B = polar(c, R, 22.5 + 45 * k);
    const isDoor = k === 0; // face centrée sur 0°
    if (!isDoor) {
      mesher.strip(mats.wall.spire, [A, B], Y.PLAT, TOWER.top, { uScale: 7.35, vScale: 36.5, vOrigin: Y.PLAT });
      collision.addSegment(A[0], A[1], B[0], B[1], TOWER.top, Y.PLAT - 0.3);
      continue;
    }
    // face de la porte : mur plein de part et d'autre d'une ouverture de 2,6 m sur 3,4 m, tympan au-dessus
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]), dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L;
    const at = (u, y) => [A[0] + dx * u, y, A[1] + dz * u];
    const d0 = L / 2 - 1.3, d1 = L / 2 + 1.3;
    const quad = (u0, u1, y0, y1) => mesher.quad(mats.wall.spire, at(u0, y0), at(u1, y0), at(u1, y1), at(u0, y1), [u0 / 7.35, (y0 - Y.PLAT) / 36.5], [u1 / 7.35, (y0 - Y.PLAT) / 36.5], [u1 / 7.35, (y1 - Y.PLAT) / 36.5], [u0 / 7.35, (y1 - Y.PLAT) / 36.5]);
    quad(0, d0, Y.PLAT, TOWER.top); quad(d1, L, Y.PLAT, TOWER.top); quad(d0, d1, Y.PLAT + 3.4, TOWER.top);
    collision.addSegment(at(0, 0)[0], at(0, 0)[2], at(d0, 0)[0], at(d0, 0)[2], TOWER.top, Y.PLAT - 0.3);
    collision.addSegment(at(d1, 0)[0], at(d1, 0)[2], at(L, 0)[0], at(L, 0)[2], TOWER.top, Y.PLAT - 0.3);
    // couloir à travers l'épaisseur du mur (de la cage d'escalier au seuil), de part et d'autre de l'axe est-ouest de la tour
    for (const sd of [-1, 1]) {
      const P0 = W(c[0] + 6.65, c[1] + 1.3 * sd), P1 = W(c[0] + R * Math.cos(22.5 * DEG), c[1] + 1.3 * sd);
      mesher.strip(mats.stone, [P0, P1], Y.PLAT, Y.PLAT + 3.4, { uScale: 4, vScale: 4 });
      collision.addSegment(P0[0], P0[1], P1[0], P1[1], Y.PLAT + 3.4, Y.PLAT - 0.3);
    }
  }
  // dessus du fût : terrasse annulaire à 104 m (trou : cage de l'escalier et pagode)
  const RING_IN = 6.5, RING_OUT = 9.3;
  slab(TOP, circleST(c, RING_OUT, 32), TOP_Y, [circleST(c, RING_IN, 32)], mats.stone);
  // garde-corps de la terrasse : parapet de pierre
  {
    const g = [];
    for (let k = 0; k < 32; k++) {
      const A = polar(c, RING_OUT + 0.1, k * 11.25), B = polar(c, RING_OUT + 0.1, (k + 1) * 11.25);
      collision.addSegment(A[0], A[1], B[0], B[1], TOP_Y + 1.4, TOP_Y - 0.3);
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      g.push(new THREE.BoxGeometry(0.5, 1.1, L + 0.05).rotateY(Math.atan2(B[0] - A[0], B[1] - A[1])).translate((A[0] + B[0]) / 2, TOP_Y + 0.55, (A[1] + B[1]) / 2));
    }
    mesher.geo(mats.stone, mergeSimple(g));
  }
  // tourelles d'escalier aux angles + clochetons sur le parapet
  {
    const g = [];
    for (let k = 0; k < 4; k++) {
      const [x, z] = polar(c, R + 0.2, 45 + 90 * k);
      g.push(new THREE.CylinderGeometry(1.5, 1.7, 112 - Y.PLAT, 10).translate(x, (112 + Y.PLAT) / 2, z));
      g.push(new THREE.ConeGeometry(1.8, 8, 10).translate(x, 112 + 4, z));
      collision.addCircle(x, z, 1.7, 112, Y.PLAT - 0.3);
    }
    for (let k = 0; k < 8; k++) {
      const [x, z] = polar(c, RING_OUT - 0.2, 22.5 + 45 * k);
      g.push(new THREE.CylinderGeometry(0.3, 0.45, 3.2, 6).translate(x, TOP_Y + 1.6, z));
      g.push(new THREE.ConeGeometry(0.5, 1.6, 6).translate(x, TOP_Y + 4, z));
    }
    mesher.geo(mats.stone, mergeSimple(g));
  }

  // ------------------------------------------------------------------ grand escalier intérieur : plateforme (67,5) -> terrasse (104)
  const sp = spiral({
    name: 'Grand escalier de la tour nord', c, rIn: 3.6, rOut: 6.4, dir: 1, phi0: 0, y0: Y.PLAT, wallMat: mats.stone,
    segs: [{ to: TOP_Y, turns: 3 }], exits: [{ y: TOP_Y, region: TOP }], capAbove: 0, startRegion: regions.PL,
  });
  out.spiral = sp;
  // le premier palier (porte sur la plateforme) : la plateforme couvre déjà la tour

  // ------------------------------------------------------------------ pagode : cône octogonal étagé et rampe hélicoïdale
  const RB0 = 6.35, RB1 = 1.9; // rayon du fût à 104 m et à 128 m
  const rb = (y) => RB0 + (RB1 - RB0) * ((y - TOP_Y) / (TIP_Y - TOP_Y));
  const rho = (y) => rb(y) + 0.6; // rayon de l'axe de la rampe
  const tiers = [];
  for (let i = 0; i < 6; i++) {
    const y0 = TOP_Y + 4 * i, y1 = y0 + 4;
    tiers.push(new THREE.CylinderGeometry(rb(y1), rb(y0), 4, 8, 1, false).rotateY(22.5 * DEG).translate(...(() => { const [x, z] = W(c[0], c[1]); return [x, (y0 + y1) / 2, z]; })()));
    tiers.push(new THREE.CylinderGeometry(rb(y1) + 0.18, rb(y1) + 0.18, 0.3, 8).rotateY(22.5 * DEG).translate(...(() => { const [x, z] = W(c[0], c[1]); return [x, y1, z]; })()));
  }
  mesher.geo(mats.stoneDark2 || mats.stone, mergeSimple(tiers));
  {
    // aiguille et croix dorée
    const [x, z] = W(c[0], c[1]);
    const g = [new THREE.ConeGeometry(1.7, TOWER.needle - TIP_Y - 2, 8).translate(x, (TOWER.needle + TIP_Y - 2) / 2 + 1, z)];
    mesher.geo(mats.stone, mergeSimple(g));
    const cr = [new THREE.BoxGeometry(0.14, 3.2, 0.14).translate(x, TOWER.needle + 1.2, z), new THREE.BoxGeometry(1.5, 0.14, 0.14).translate(x, TOWER.needle + 1.9, z)];
    mesher.geo(mats.gold, mergeSimple(cr));
    lightSources.push({ x, y: TIP_Y + 3, z, color: 0xb8c8ff, intensity: 12, dist: 18 });
  }
  // rampe : 6 tours de 4 m, bande de 1,0 m de large
  const N = 24 * 6;
  const phiR = (y) => 130 + 360 * ((y - TOP_Y) / 4); // azimut de la rampe à la hauteur y (démarre à 130° ; elle passe à plus de 2,5 m au-dessus de la sortie d'escalier, à 0°)
  const wedges = [];
  const rampRegion = levels.addRegion('Rampe de la flèche', (TOP_Y + TIP_Y) / 2, 'stair');
  const iron = [];
  for (let k = 0; k < N; k++) {
    const yA = TOP_Y + ((TIP_Y - TOP_Y) * k) / N, yB = TOP_Y + ((TIP_Y - TOP_Y) * (k + 1)) / N;
    const pA = phiR(yA), pB = phiR(yB);
    const q = [[rho(yA) - 0.5, pA, yA], [rho(yA) + 0.5, pA, yA], [rho(yB) + 0.5, pB, yB], [rho(yB) - 0.5, pB, yB]].map(([r, ph, yy]) => { const [x, z] = polar(c, r, ph); return [x, yy, z]; });
    levels.addQuad(rampRegion, q[0], q[1], q[2], q[3]);
    const yM = (yA + yB) / 2;
    const shape = new THREE.Shape();
    const pts = [polar(c, rho(yA) - 0.5, pA), polar(c, rho(yA) + 0.5, pA), polar(c, rho(yB) + 0.5, pB), polar(c, rho(yB) - 0.5, pB)];
    shape.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < 4; i++) shape.lineTo(pts[i][0], pts[i][1]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    g.rotateX(Math.PI / 2); g.translate(0, yM, 0);
    wedges.push(g);
    // garde-corps extérieur
    const A = polar(c, rho(yA) + 0.55, pA), B = polar(c, rho(yB) + 0.55, pB);
    collision.addSegment(A[0], A[1], B[0], B[1], yM + 1.4, yM - 0.5);
    if (k % 2 === 0) { const [mx, mz] = polar(c, rho(yM) + 0.55, (pA + pB) / 2); iron.push(new THREE.BoxGeometry(0.06, 1.1, 0.06).translate(mx, yM + 0.55, mz)); }
    iron.push(new THREE.BoxGeometry(0.06, 0.06, Math.hypot(B[0] - A[0], B[1] - A[1]) + 0.04).rotateY(Math.atan2(B[0] - A[0], B[1] - A[1])).translate((A[0] + B[0]) / 2, yM + 1.1, (A[1] + B[1]) / 2));
  }
  mesher.geo(mats.stone, mergeSimple(wedges));
  mesher.geo(mats.iron, mergeSimple(iron));
  // pointe : petit balcon circulaire autour de l'aiguille
  slab(TIP, circleST(c, 2.8, 20), TIP_Y, [circleST(c, 1.75, 20)], mats.stone);
  {
    for (let k = 0; k < 20; k++) {
      const A = polar(c, 2.85, k * 18), B = polar(c, 2.85, (k + 1) * 18);
      collision.addSegment(A[0], A[1], B[0], B[1], TIP_Y + 1.4, TIP_Y - 0.3);
    }
    collision.addCircle(...(() => { const [x, z] = W(c[0], c[1]); return [x, z]; })(), 1.8, TIP_Y + 20, TIP_Y - 0.5);
  }
  // liens de la rampe : terrasse -> pointe
  {
    const path = [];
    const st = polar(c, 8.0, phiR(TOP_Y) - 20); // départ sur la terrasse
    path.push([st[0], TOP_Y, st[1]]);
    for (let k = 0; k <= 72; k++) { const yy = TOP_Y + ((TIP_Y - TOP_Y) * k) / 72; const [x, z] = polar(c, rho(yy), phiR(yy)); path.push([x, yy, z]); }
    const [ex, ez] = polar(c, 2.3, phiR(TIP_Y));
    path.push([ex, TIP_Y, ez]);
    levels.addLink('Rampe de la flèche', TOP, TIP, path.map((p) => [p[0], p[1], p[2]]), rampRegion);
  }
  // zones d'apparition en haut
  levels.regions[TOP].spawns.push(...[0, 90, 180, 270].map((a) => polar(c, 8, a + 30)));
  lightSources.push(...[0, 120, 240].map((a) => { const [x, z] = polar(c, 8, a); return { x, y: TOP_Y + 3, z, color: 0xffc070, intensity: 12, dist: 16 }; }));
  return out;
}
