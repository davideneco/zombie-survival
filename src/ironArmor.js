import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// =====================================================================
//  Armure de fer partagée : la statue de l'Homme de Fer (hommedefer.js) et les chevaliers de fer (zombie.js) utilisent
//  les mêmes pièces : morion à crête, cuirasse, tassettes, épaulières. Toutes les pièces sont construites en mètres,
//  à l'échelle d'un homme debout (1,95 m jusqu'au sommet du morion), tournées vers +z.
//  Aucun aléatoire : le résultat est identique à chaque appel (et sur toutes les machines).
// =====================================================================

// ---- petits outils
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lathe = (pts, seg = 20, phiStart = 0, phiLength = Math.PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLength);

// Cylindre (ou cône) entre deux points
function limb(a, b, r0, r1 = r0, seg = 8) {
  const A = V(...a), B = V(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}
const ball = (x, y, z, r, sx = 1, sy = 1, sz = 1, seg = 10) => { const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3)); g.scale(sx, sy, sz); g.translate(x, y, z); return g; };
const ring = (y, R, r, seg = 20) => { const g = new THREE.TorusGeometry(R, r, 5, seg); g.rotateX(Math.PI / 2); g.translate(0, y, 0); return g; };
const plate = (shape, depth) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }); g.translate(0, 0, -depth / 2); return g; };

// Fusionne des pièces en un seul maillage ; color : couleur de sommet (le matériau du maillage la multiplie)
export function mergeParts(list, color = null) {
  const out = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    if (color != null) {
      const c = new THREE.Color(color), a = new Float32Array(n.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
      n.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    return n;
  });
  list.forEach((g) => g.dispose());
  const m = mergeGeometries(out, false);
  out.forEach((g) => g.dispose());
  m.computeBoundingSphere();
  return m;
}

// ------------------------------------------------------------------ pièces
// Morion : calotte, bord relevé devant et derrière (en bateau) et crête. Origine = centre de la base de la calotte (y 0).
export function morionParts() {
  const dome = lathe([[0.0, 0.2], [0.05, 0.195], [0.095, 0.17], [0.125, 0.11], [0.138, 0.04], [0.14, 0.0]], 16);
  // bord : disque mince dont les pointes (axe z) se relèvent et dont les côtés tombent, comme un bateau
  const brim = new THREE.CylinderGeometry(0.27, 0.27, 0.014, 24, 2);
  const p = brim.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z) / 0.27;
    p.setY(i, p.getY(i) + 0.085 * r * r * (2 * (z * z) / (x * x + z * z + 1e-9) - 0.6) - 0.012);
  }
  brim.computeVertexNormals();
  const crest = new THREE.Shape();
  [[-0.15, 0.1], [-0.1, 0.17], [-0.05, 0.215], [0.0, 0.232], [0.05, 0.215], [0.1, 0.17], [0.15, 0.1], [0.1, 0.13], [0, 0.17], [-0.1, 0.13]].forEach(([z, y], i) => (i ? crest.lineTo(z, y) : crest.moveTo(z, y)));
  const cg = plate(crest, 0.02); cg.rotateY(Math.PI / 2);
  return { iron: [dome, brim, cg], brass: [ring(0.012, 0.139, 0.008, 16), ...[-1, 1].map((s) => ball(s * 0.105, 0.06, 0.07, 0.012, 1, 1, 1, 6))] };
}

// Cuirasse à busc : de la taille (y 0) au col (y ~0.6), plus gorgerin et rebord. Origine = centre de la taille.
export function cuirassParts() {
  const body = lathe([[0.17, 0.0], [0.2, 0.1], [0.235, 0.26], [0.25, 0.38], [0.225, 0.5], [0.15, 0.58], [0.11, 0.62]], 18);
  body.scale(1.18, 1, 0.82);
  const gorget = lathe([[0.12, 0.6], [0.15, 0.62], [0.15, 0.68], [0.115, 0.72], [0.11, 0.66]], 14);
  const ridge = limb([0, 0.02, 0.19], [0, 0.55, 0.205], 0.014, 0.008, 5); // busc
  return { iron: [body, gorget, ridge], brass: [ring(0.0, 0.2, 0.012, 18), ring(0.6, 0.12, 0.01, 14), ...[0.12, 0.22, 0.32, 0.42].map((y) => ball(0, y, 0.205, 0.014, 1, 1, 1, 5))] };
}

// Tassettes : jupe de lames qui se recouvrent, sous la taille (y 0 = taille, descend à -0.34)
export function tassetParts() {
  const bands = [[0.19, 0.0, 0.235, -0.12], [0.22, -0.1, 0.265, -0.22], [0.245, -0.2, 0.285, -0.34]].map(([r0, y0, r1, y1]) => {
    const g = lathe([[r0, y0], [r1, y1], [r1 - 0.012, y1], [r0 - 0.012, y0]], 20);
    g.scale(1.1, 1, 0.82);
    return g;
  });
  return { iron: bands, brass: [] };
}

// Épaulière : coque bombée à lames. Origine = centre de l'épaule.
export function pauldronParts(side = 1) {
  const a = ball(0, 0, 0, 0.13, 1.1, 0.65, 1.0, 10);
  const b = ball(side * 0.015, -0.055, 0, 0.12, 1.05, 0.55, 0.95, 10);
  return { iron: [a, b], brass: [ball(0, 0.075, 0, 0.018, 1, 1, 1, 6)] };
}

// ----- versions pour les zombies (une pièce chacune, sans couleur de sommet)
export function morionGeometry() { const { iron, brass } = morionParts(); return mergeParts([...iron, ...brass]); }
export function cuirassGeometry() { const c = cuirassParts(), t = tassetParts(); return mergeParts([...c.iron, ...c.brass, ...t.iron]); }
export function pauldronGeometry(side = 1) { const { iron, brass } = pauldronParts(side); return mergeParts([...iron, ...brass]); }

// ------------------------------------------------------------------ le hallebardier (statue)
// Retourne { iron, brass } : deux géométries fusionnées (sommets colorés). Debout sur y = 0, tourné vers +z, hallebarde à droite.
export function halberdierGeometries(ironColor = 0x3a3d42, brassColor = 0xb08a3c) {
  const iron = [], brass = [];
  const put = (list, dx, dy, dz, ...gs) => { for (const g of gs) { g.translate(dx, dy, dz); list.push(g); } };
  // jambes : bottes, jambières, genouillères, cuissots
  for (const s of [-1, 1]) {
    const x = s * 0.11;
    iron.push(limb([x, 0.0, 0.02], [x, 0.3, 0.0], 0.1, 0.09), limb([x, 0.3, 0.0], [x, 0.84, 0.0], 0.09, 0.11), ball(x, 0.88, 0.02, 0.115, 1, 0.9, 1.05), limb([x, 0.88, 0.0], [x, 1.2, 0.0], 0.125, 0.135));
    const foot = new THREE.BoxGeometry(0.13, 0.08, 0.3); foot.translate(x, 0.04, 0.09); iron.push(foot);
    brass.push(ball(x, 0.88, 0.1, 0.03, 1, 1, 0.6, 6)); // rivet de genouillère
  }
  // tassettes, cuirasse, gorgerin
  const t = tassetParts(), c = cuirassParts();
  put(iron, 0, 1.18, 0, ...t.iron);
  put(iron, 0, 1.15, 0, ...c.iron);
  put(brass, 0, 1.15, 0, ...c.brass);
  // tête et morion
  iron.push(ball(0, 1.86, 0.0, 0.1, 0.95, 1.1, 1.0, 10));
  const m = morionParts();
  put(iron, 0, 1.9, 0, ...m.iron);
  put(brass, 0, 1.9, 0, ...m.brass);
  // épaulières
  const pl = pauldronParts(-1), pr = pauldronParts(1);
  put(iron, -0.33, 1.6, 0, ...pl.iron); put(brass, -0.33, 1.6, 0, ...pl.brass);
  put(iron, 0.33, 1.6, 0, ...pr.iron); put(brass, 0.33, 1.6, 0, ...pr.brass);
  // bras : le droit tient la hallebarde, le gauche est posé sur la hanche
  iron.push(limb([0.34, 1.54, 0], [0.4, 1.3, 0.08], 0.058, 0.05), limb([0.4, 1.3, 0.08], [0.4, 1.17, 0.2], 0.05, 0.048), ball(0.4, 1.3, 0.08, 0.06), ball(0.4, 1.17, 0.21, 0.058, 1, 1, 1.1, 7));
  iron.push(limb([-0.34, 1.54, 0], [-0.4, 1.3, 0.05], 0.058, 0.05), limb([-0.4, 1.3, 0.05], [-0.26, 1.14, 0.12], 0.05, 0.048), ball(-0.4, 1.3, 0.05, 0.06), ball(-0.26, 1.13, 0.13, 0.058, 1, 1, 1.1, 7));
  // hallebarde : hampe, fer de hache, pointe, crochet
  iron.push(limb([0.4, 0.0, 0.2], [0.4, 2.22, 0.2], 0.022, 0.02, 6));
  const blade = new THREE.Shape();
  [[0.0, 2.02], [0.07, 2.0], [0.2, 1.98], [0.3, 2.05], [0.32, 2.2], [0.27, 2.34], [0.16, 2.28], [0.08, 2.24], [0.0, 2.24]].forEach(([x, y], i) => (i ? blade.lineTo(x, y) : blade.moveTo(x, y)));
  const bg = plate(blade, 0.018); bg.translate(0.4, 0, 0.2); iron.push(bg);
  const spike = new THREE.ConeGeometry(0.03, 0.42, 6); spike.translate(0.4, 2.43, 0.2); iron.push(spike);
  const hook = new THREE.Shape();
  [[0, 2.06], [-0.1, 2.08], [-0.17, 2.0], [-0.12, 1.94], [-0.05, 2.0], [0, 1.98]].forEach(([x, y], i) => (i ? hook.lineTo(x, y) : hook.moveTo(x, y)));
  const hg = plate(hook, 0.016); hg.translate(0.4, 0, 0.2); iron.push(hg);
  brass.push(limb([0.4, 2.0, 0.2], [0.4, 2.08, 0.2], 0.034, 0.034, 8), limb([0.4, 2.2, 0.2], [0.4, 2.25, 0.2], 0.032, 0.032, 8), ball(0.4, 0.0, 0.2, 0.03, 1, 0.6, 1, 6));
  return { iron: mergeParts(iron, ironColor), brass: mergeParts(brass, brassColor) };
}
