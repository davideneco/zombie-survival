import * as THREE from 'three';
import { gpuOnly } from './gpuOnly.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Intérieurs des rez-de-chaussée (v0.78.0). Chaque bâtiment ordinaire assez grand reçoit une pièce au rez-de-chaussée, ouverte sur la rue par
//  une porte de `door` m découpée dans la façade (realworld.js : la découpe passe par les mêmes « coupes » que les passages sous immeubles).
//   - visuel : sol (parquet ou carrelage), plafond, murs intérieurs décalés de `wall` m avec soubassement, plinthe et cimaise, ébrasements de
//     porte, plafonnier allumé, étagères garnies ; regroupés par tuiles de TILE m, dessinées seulement près du joueur (`range`) ;
//   - collision : murs intérieurs (avec l'ouverture de la porte) et façades des étagères ; la grille de navigation n'est évidée qu'à la toute
//     fin de la construction du monde (aucune machine, aucun décor n'est donc placé à l'intérieur) ;
//   - roomOf(x, z) : index de la pièce qui contient le point (-1 dehors) : zones, apparitions par les fenêtres, plafond.
//  Aucun tirage `rnd` : tous les choix viennent d'un hachage de la position (le monde reste identique pour tous les joueurs).
//  Réglages : CONFIG.interiors.
// =====================================================================
const TILE = 64;
const hash = (x, z, k = 0) => { const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
export const pointIn = (x, z, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

const WALL_COLORS = [[0.46, 0.42, 0.35], [0.37, 0.4, 0.37], [0.44, 0.37, 0.32], [0.33, 0.36, 0.39], [0.45, 0.43, 0.38], [0.36, 0.31, 0.28]]; // enduits défraîchis
const WAINSCOT = [[0.28, 0.22, 0.17], [0.24, 0.27, 0.26], [0.32, 0.27, 0.22], [0.22, 0.22, 0.24]];
const GOODS = [[0.42, 0.18, 0.14], [0.2, 0.3, 0.38], [0.5, 0.42, 0.22], [0.3, 0.36, 0.22], [0.55, 0.52, 0.46], [0.35, 0.22, 0.3]];

// Textures procédurales (sans fichier) : parquet et carrelage, en niveaux de gris (la couleur vient des sommets)
function floorTexture(kind) {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d');
  if (kind === 0) { // parquet : lames de 32 px (≈ 12 cm), joints sombres, veinage
    for (let r = 0; r < 8; r++) {
      let off = (r * 97) % N;
      x.fillStyle = 'rgb(140,140,140)'; x.fillRect(0, r * 32, N, 32); // fond de la rangée : aucune zone non peinte (noire) quand la rangée est décalée
      for (let s = -2; s < 3; s++) {
        const v = 128 + ((r * 37 + s * 53) % 34);
        x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(off + s * 128, r * 32, 128, 32);
        x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(off + s * 128, r * 32, 2, 32);
      }
      x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(0, r * 32, N, 2);
      for (let k = 0; k < 18; k++) { x.fillStyle = `rgba(0,0,0,${0.05 + (k % 3) * 0.03})`; x.fillRect(0, r * 32 + 4 + ((k * 7) % 26), N, 1); }
    }
  } else { // carrelage : carreaux de 64 px, joints clairs, alternance légère
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const v = (i + j) % 2 ? 140 : 158;
      x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i * 64, j * 64, 64, 64);
    }
    x.fillStyle = 'rgba(40,40,40,0.8)';
    for (let i = 0; i <= 4; i++) { x.fillRect(i * 64 - 1, 0, 3, N); x.fillRect(0, i * 64 - 1, N, 3); }
  }
  for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; x.fillRect(Math.random() * N, Math.random() * N, 2, 2); } // salissures
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Geometry helpers (shared with keyBuildings.js): vertex-colour buckets, quads, thin boxes, polygon inset
export function mk() { return { pos: [], nor: [], col: [], uv: [], idx: [] }; }
export const quad = (B, a, b, c, d, n, col, uv = [0, 0, 1, 0, 1, 1, 0, 1]) => {
  const base = B.pos.length / 3;
  B.pos.push(...a, ...b, ...c, ...d);
  for (let i = 0; i < 4; i++) { B.nor.push(n[0], n[1], n[2]); B.col.push(col[0], col[1], col[2]); }
  B.uv.push(...uv);
  B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
};
// boîte biseautée simple (meubles) : 5 faces visibles, orientée par (ux, uz) le long du mur
export const box = (B, cx, y0, cz, ux, uz, w, h, d, col) => {
  const nx = -uz, nz = ux, hw = w / 2, hd = d / 2, y1 = y0 + h;
  const P = (s, t, y) => [cx + ux * s + nx * t, y, cz + uz * s + nz * t];
  const sh = (k) => [col[0] * k, col[1] * k, col[2] * k];
  quad(B, P(-hw, hd, y0), P(hw, hd, y0), P(hw, hd, y1), P(-hw, hd, y1), [nx, 0, nz], sh(1));
  quad(B, P(hw, -hd, y0), P(-hw, -hd, y0), P(-hw, -hd, y1), P(hw, -hd, y1), [-nx, 0, -nz], sh(0.8));
  quad(B, P(hw, hd, y0), P(hw, -hd, y0), P(hw, -hd, y1), P(hw, hd, y1), [ux, 0, uz], sh(0.9));
  quad(B, P(-hw, -hd, y0), P(-hw, hd, y0), P(-hw, hd, y1), P(-hw, -hd, y1), [-ux, 0, -uz], sh(0.9));
  quad(B, P(-hw, hd, y1), P(hw, hd, y1), P(hw, -hd, y1), P(-hw, -hd, y1), [0, 1, 0], sh(1.1));
};

// Polygone intérieur : chaque arête décalée de `w` vers l'intérieur (onglets bornés aux angles aigus)
export const inset = (pts, w) => {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    const e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2]; // normales gauches (intérieur pour un contour anti-horaire)
    const bx = n1[0] + n2[0], bz = n1[1] + n2[1], bl = Math.hypot(bx, bz);
    let k = bl > 1e-3 ? w / ((bx / bl) * n1[0] + (bz / bl) * n1[1]) : w;
    k = Math.min(Math.abs(k), w * 3);
    out.push(bl > 1e-3 ? [c[0] + (bx / bl) * k, c[1] + (bz / bl) * k] : [c[0] + n1[0] * w, c[1] + n1[1] * w]);
  }
  return out;
};


export function createInteriors() {
  const C = () => CONFIG.interiors;
  const rooms = [];
  const grid = new Map(); // cellule de 16 m -> index des pièces (roomOf)
  const G = 16;
  const tiles = new Map();
  const tileOf = (x, z) => {
    const ix = Math.floor(x / TILE), iz = Math.floor(z / TILE), k = ix * 8192 + iz;
    let t = tiles.get(k);
    if (!t) tiles.set(k, t = { cx: (ix + 0.5) * TILE, cz: (iz + 0.5) * TILE, half: TILE * 0.7072, b: [mk(), mk(), mk(), mk()] }); // 0 murs, 1 parquet, 2 carrelage, 3 meubles et lampes
    return t;
  };
  const api = {
    rooms,
    // pts : contour du bâtiment (anti-horaire, repère monde) ; cuts[i] : ouvertures [t0, t1] de l'arête i (porte comprise) ; door : { i, t0, t1 }
    addRoom(pts, cuts, door) {
      const A = C();
      const ccw = pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0) > 0;
      // le décalage « à gauche » doit viser l'intérieur : en x-z (z vers le bas sur la carte) un contour d'aire positive tourne dans ce sens
      const P = ccw ? pts : pts.slice().reverse();
      // contour inversé : l'arête j de P est l'arête n-2-j du contour d'origine (la dernière reste la dernière), parcourue à l'envers
      const n0 = pts.length, back = (j) => (j === n0 - 1 ? n0 - 1 : n0 - 2 - j), fwd = back; // involution
      const C2 = ccw ? cuts : P.map((_, j) => (cuts[back(j)] || []).map(([a, b, ...yy]) => [1 - b, 1 - a, ...yy]));
      if (door && !ccw) door = { i: fwd(door.i), t0: 1 - door.t1, t1: 1 - door.t0 };
      const inner = inset(P, A.wall);
      if (inner.some((q) => !pointIn(q[0], q[1], P))) return -1; // décalage raté (contour trop tordu) : pas d'intérieur
      let cx = 0, cz = 0;
      for (const [x, z] of inner) { cx += x; cz += z; }
      cx /= inner.length; cz /= inner.length;
      const r = { id: rooms.length, src: pts, pts: P, inner, cuts: C2, cx, cz, h: A.height, door, minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
      for (const [x, z] of P) { r.minX = Math.min(r.minX, x); r.maxX = Math.max(r.maxX, x); r.minZ = Math.min(r.minZ, z); r.maxZ = Math.max(r.maxZ, z); }
      rooms.push(r);
      for (let gx = Math.floor(r.minX / G); gx <= Math.floor(r.maxX / G); gx++) for (let gz = Math.floor(r.minZ / G); gz <= Math.floor(r.maxZ / G); gz++) {
        const k = gx * 8192 + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r.id);
      }
      return r.id;
    },

    // Un contour peut-il recevoir une pièce (décalage des murs réussi) ?
    valid(pts) {
      const ccw = pts.reduce((s2, p, i) => { const q = pts[(i + 1) % pts.length]; return s2 + (p[0] * q[1] - q[0] * p[1]); }, 0) > 0;
      const P = ccw ? pts : pts.slice().reverse();
      return inset(P, C().wall).every((q) => pointIn(q[0], q[1], P));
    },

    // Inset outline of a building contour (the walls of the room addRoom would build): { P (normalised winding), inner }, or null when the offset fails
    outline(pts) {
      const ccw = pts.reduce((s2, p, i) => { const q = pts[(i + 1) % pts.length]; return s2 + (p[0] * q[1] - q[0] * p[1]); }, 0) > 0;
      const P = ccw ? pts : pts.slice().reverse(), inner = inset(P, C().wall);
      return inner.every((q) => pointIn(q[0], q[1], P)) ? { P, inner } : null;
    },

    // Porte fermée (pièce dont la porte est bouchée côté rue : un joueur ne doit pas pouvoir s'y retrancher hors d'atteinte des zombies) :
    // deux vantaux de bois à panneaux, une imposte sombre ; renvoie les extrémités [x0, z0, x1, z1] de l'ouverture sur la façade
    closeDoor(scene, r) {
      const a = r.pts[r.door.i], b = r.pts[(r.door.i + 1) % r.pts.length];
      const p0 = [a[0] + (b[0] - a[0]) * r.door.t0, a[1] + (b[1] - a[1]) * r.door.t0], p1 = [a[0] + (b[0] - a[0]) * r.door.t1, a[1] + (b[1] - a[1]) * r.door.t1];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ux = (p1[0] - p0[0]) / len, uz = (p1[1] - p0[1]) / len;
      const B = mk(), H = C().doorHeight, lh = Math.min(2.7, H - 0.3), wood = [0.24, 0.15, 0.1], dark = [0.16, 0.1, 0.07];
      const mx = (p0[0] + p1[0]) / 2 - uz * 0.08, mz = (p0[1] + p1[1]) / 2 + ux * 0.08; // un peu en retrait de la façade (vers l'intérieur)
      for (const side of [-1, 1]) {
        const cx = mx + ux * side * len / 4, cz = mz + uz * side * len / 4;
        box(B, cx, 0, cz, ux, uz, len / 2 - 0.02, lh, 0.07, wood);
        for (const [y, h] of [[0.25, 0.9], [1.35, 1.05]]) box(B, cx, y, cz, ux, uz, len / 2 - 0.28, h, 0.09, dark); // panneaux moulurés
        box(B, cx - ux * side * (len / 4 - 0.18), 1.05, cz - uz * side * (len / 4 - 0.18), ux, uz, 0.04, 0.22, 0.12, [0.55, 0.45, 0.25]); // poignée
      }
      box(B, mx, lh, mz, ux, uz, len, H - lh, 0.05, [0.08, 0.1, 0.12]); // imposte
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setIndex(B.idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }));
      m.name = 'interior:closedDoor'; m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      r.sealed = true;
      return [p0[0], p0[1], p1[0], p1[1]];
    },

    roomOf(x, z) {
      const arr = grid.get(Math.floor(x / G) * 8192 + Math.floor(z / G));
      if (!arr) return -1;
      for (const id of arr) { const r = rooms[id]; if (!r.sealed && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && pointIn(x, z, r.inner)) return id; }
      return -1;
    },

    // Construit les maillages, ajoute les collisions (murs intérieurs, étagères) et les plafonniers aux sources de lumière
    finish(scene, collision, lightSources) {
      const A = C(), H = A.height, FY = A.floorY;
      for (const r of rooms) {
        const T = tileOf(r.cx, r.cz), W = T.b[0], F = T.b[hash(r.cx, r.cz, 3) < 0.65 ? 1 : 2], M = T.b[3];
        const wallC = WALL_COLORS[Math.floor(hash(r.cx, r.cz, 1) * WALL_COLORS.length)], lowC = WAINSCOT[Math.floor(hash(r.cx, r.cz, 2) * WAINSCOT.length)];
        const tint = 0.85 + 0.3 * hash(r.cx, r.cz, 4), floorC = F === T.b[1] ? [0.62 * tint, 0.45 * tint, 0.3 * tint] : [0.7 * tint, 0.68 * tint, 0.64 * tint];
        // sol et plafond (triangulation du contour intérieur)
        const v2 = r.inner.map(([x, z]) => new THREE.Vector2(x, z));
        let tris = [];
        try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch { tris = []; }
        for (const [a, b, c] of tris) {
          const pa = r.inner[a], pb = r.inner[b], pc = r.inner[c];
          // sol : face vers le haut (ordre selon le signe de l'aire du triangle)
          const s = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
          const [q1, q2] = s < 0 ? [pb, pc] : [pc, pb];
          // découpé en triangles de 2,5 m au plus : le relief (déplacement des sommets) suit alors le sol de la rue, qui ne perce plus le plancher
          const stack = [[pa, q1, q2]];
          while (stack.length) {
            const [u, v, x] = stack.pop();
            const e = [[u, v], [v, x], [x, u]].map(([p0, p1]) => (p0[0] - p1[0]) ** 2 + (p0[1] - p1[1]) ** 2), m = e.indexOf(Math.max(...e));
            if (e[m] > 6.25) {
              const [p0, p1, p2] = m === 0 ? [u, v, x] : m === 1 ? [v, x, u] : [x, u, v], mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
              stack.push([p0, mid, p2], [mid, p1, p2]);
              continue;
            }
            const base = F.pos.length / 3;
            F.pos.push(u[0], FY, u[1], v[0], FY, v[1], x[0], FY, x[1]);
            for (let k = 0; k < 3; k++) { F.nor.push(0, 1, 0); F.col.push(...floorC); }
            F.uv.push(u[0] / 2, u[1] / 2, v[0] / 2, v[1] / 2, x[0] / 2, x[1] / 2);
            F.idx.push(base, base + 1, base + 2);
          }
          if (r.ceilHoles) continue; // ceiling with stairwell holes: emitted below
          const cb = W.pos.length / 3, cc = [0.4, 0.38, 0.35];
          W.pos.push(pa[0], H, pa[1], q2[0], H, q2[1], q1[0], H, q1[1]); // plafond : face vers le bas
          for (let k = 0; k < 3; k++) { W.nor.push(0, -1, 0); W.col.push(...cc); }
          W.uv.push(0, 0, 1, 0, 1, 1);
          W.idx.push(cb, cb + 1, cb + 2);
        }
        if (r.ceilHoles) { // key building (keyBuildings.js): the ceiling is open above the stair shaft
          const all = [...r.inner, ...r.ceilHoles.flat()];
          let ct = [];
          try { ct = THREE.ShapeUtils.triangulateShape(v2, r.ceilHoles.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)))); } catch { ct = []; }
          for (const [a, b, c] of ct) {
            const pa = all[a], pb = all[b], pc = all[c], s = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
            const [q1, q2] = s < 0 ? [pb, pc] : [pc, pb], cb = W.pos.length / 3;
            W.pos.push(pa[0], H, pa[1], q2[0], H, q2[1], q1[0], H, q1[1]);
            for (let k = 0; k < 3; k++) { W.nor.push(0, -1, 0); W.col.push(0.4, 0.38, 0.35); }
            W.uv.push(0, 0, 1, 0, 1, 1);
            W.idx.push(cb, cb + 1, cb + 2);
          }
        }
        // murs intérieurs : soubassement, cimaise, enduit ; plinthe ; ouvertures (porte, passages) et leurs ébrasements
        const n = r.inner.length;
        for (let i = 0; i < n; i++) {
          const a = r.inner[i], b = r.inner[(i + 1) % n], oa = r.pts[i], ob = r.pts[(i + 1) % n];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.05) continue;
          const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, nx = -uz, nz = ux; // normale vers l'intérieur de la pièce
          const cuts = (r.cuts[i] || []).slice().sort((p, q) => p[0] - q[0]);
          const solid = [];
          let t = 0;
          for (const [t0, t1] of cuts) { if (t0 > t) solid.push([t, t0]); t = Math.max(t, t1); }
          if (t < 1) solid.push([t, 1]);
          const at = (s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
          for (const [s0, s1] of solid) {
            if ((s1 - s0) * len < 0.05) continue;
            const p0 = at(s0), p1 = at(s1), u0 = s0 * len / 2, u1 = s1 * len / 2;
            const band = (y0, y1, col) => quad(W, [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [nx, 0, nz], col, [u0, y0, u1, y0, u1, y1, u0, y1]);
            band(0, 1.05, lowC); band(1.12, H, wallC);
            const dk = [lowC[0] * 0.6, lowC[1] * 0.6, lowC[2] * 0.6];
            // cimaise et plinthe : listels saillants de 2 cm
            const e = 0.02, q0 = [p0[0] + nx * e, p0[1] + nz * e], q1 = [p1[0] + nx * e, p1[1] + nz * e];
            quad(W, [q0[0], 1.05, q0[1]], [q1[0], 1.05, q1[1]], [q1[0], 1.12, q1[1]], [q0[0], 1.12, q0[1]], [nx, 0, nz], dk);
            quad(W, [q0[0], 0, q0[1]], [q1[0], 0, q1[1]], [q1[0], 0.12, q1[1]], [q0[0], 0.12, q0[1]], [nx, 0, nz], dk);
            if (len * (s1 - s0) > 0.3) collision.addSegment(p0[0], p0[1], p1[0], p1[1]);
          }
          // ébrasements : relient le mur intérieur à la façade de part et d'autre de chaque ouverture, et sous le linteau
          for (const [t0, t1, yLo, yHi] of cuts) {
            const top = yHi ?? A.doorHeight;
            const pi0 = at(t0), pi1 = at(t1);
            const po0 = [oa[0] + (ob[0] - oa[0]) * t0, oa[1] + (ob[1] - oa[1]) * t0], po1 = [oa[0] + (ob[0] - oa[0]) * t1, oa[1] + (ob[1] - oa[1]) * t1];
            const rc = [wallC[0] * 0.8, wallC[1] * 0.8, wallC[2] * 0.8];
            if (yLo != null) { // window (key building barricade): inner wall below the sill and above the lintel, reveals, a wooden sill
              const u0 = t0 * len / 2, u1 = t1 * len / 2, sillC = [0.26, 0.19, 0.13];
              quad(W, [pi0[0], 0, pi0[1]], [pi1[0], 0, pi1[1]], [pi1[0], yLo, pi1[1]], [pi0[0], yLo, pi0[1]], [nx, 0, nz], lowC, [u0, 0, u1, 0, u1, yLo, u0, yLo]);
              quad(W, [pi0[0], yHi, pi0[1]], [pi1[0], yHi, pi1[1]], [pi1[0], H, pi1[1]], [pi0[0], H, pi0[1]], [nx, 0, nz], wallC, [u0, yHi, u1, yHi, u1, H, u0, H]);
              quad(W, [po0[0], yLo, po0[1]], [pi0[0], yLo, pi0[1]], [pi0[0], yHi, pi0[1]], [po0[0], yHi, po0[1]], [ux, 0, uz], rc);
              quad(W, [pi1[0], yLo, pi1[1]], [po1[0], yLo, po1[1]], [po1[0], yHi, po1[1]], [pi1[0], yHi, pi1[1]], [-ux, 0, -uz], rc);
              quad(W, [po0[0], yHi, po0[1]], [pi0[0], yHi, pi0[1]], [pi1[0], yHi, pi1[1]], [po1[0], yHi, po1[1]], [0, -1, 0], rc);
              quad(M, [po0[0], yLo + 0.02, po0[1]], [po1[0], yLo + 0.02, po1[1]], [pi1[0], yLo + 0.02, pi1[1]], [pi0[0], yLo + 0.02, pi0[1]], [0, 1, 0], sillC);
              continue;
            }
            quad(W, [po0[0], 0, po0[1]], [pi0[0], 0, pi0[1]], [pi0[0], top, pi0[1]], [po0[0], top, po0[1]], [ux, 0, uz], rc);
            quad(W, [pi1[0], 0, pi1[1]], [po1[0], 0, po1[1]], [po1[0], top, po1[1]], [pi1[0], top, pi1[1]], [-ux, 0, -uz], rc);
            quad(W, [po0[0], top, po0[1]], [pi0[0], top, pi0[1]], [pi1[0], top, pi1[1]], [po1[0], top, po1[1]], [0, -1, 0], rc);
            // retombée au-dessus de l'ouverture, côté pièce (si la porte est moins haute que le plafond)
            if (top < H - 0.01) quad(W, [pi0[0], top, pi0[1]], [pi1[0], top, pi1[1]], [pi1[0], H, pi1[1]], [pi0[0], H, pi0[1]], [nx, 0, nz], wallC);
            // seuil
            quad(F, [po0[0], FY + 0.005, po0[1]], [po1[0], FY + 0.005, po1[1]], [pi1[0], FY + 0.005, pi1[1]], [pi0[0], FY + 0.005, pi0[1]], [0, 1, 0], [0.32, 0.3, 0.28], [0, 0, 1, 0, 1, 0.2, 0, 0.2]);
          }
          // étagères garnies le long des murs pleins (pas celui de la porte), une sur deux selon le hachage
          if (r.door && i !== r.door.i && cuts.length === 0 && len >= 2.6 && hash(a[0], a[1], 7) < A.shelfChance) {
            const sl = Math.min(len - 1.2, 3.2), mid = at(0.5), d = 0.42, sh = 1.9;
            const sc = [0.3, 0.22, 0.16];
            const ox = mid[0] + nx * (d / 2 + 0.02), oz = mid[1] + nz * (d / 2 + 0.02);
            box(M, ox - nx * (d / 2 - 0.02), 0, oz - nz * (d / 2 - 0.02), ux, uz, sl, sh, 0.03, [sc[0] * 0.7, sc[1] * 0.7, sc[2] * 0.7]); // fond
            for (const s of [-1, 1]) box(M, ox + ux * s * (sl / 2 - 0.03), 0, oz + uz * s * (sl / 2 - 0.03), ux, uz, 0.05, sh, d, sc); // montants
            for (let k = 0; k < 4; k++) {
              const y = 0.12 + k * 0.56;
              box(M, ox, y, oz, ux, uz, sl - 0.06, 0.035, d, [sc[0] * 1.15, sc[1] * 1.15, sc[2] * 1.15]); // planches
              if (k === 3) break;
              for (let g = 0; g < Math.floor(sl / 0.32); g++) { // marchandises : boîtes et bocaux
                const hh = hash(ox + g, oz + k, 11);
                if (hh < 0.25) continue;
                const gx = -sl / 2 + 0.2 + g * 0.32, col = GOODS[Math.floor(hash(ox, g + k * 13, 12) * GOODS.length)];
                box(M, ox + ux * gx, y + 0.035, oz + uz * gx, ux, uz, 0.22, 0.18 + hh * 0.22, d * 0.7, col);
              }
            }
            const f0 = [mid[0] - ux * sl / 2 + nx * (d + 0.03), mid[1] - uz * sl / 2 + nz * (d + 0.03)], f1 = [mid[0] + ux * sl / 2 + nx * (d + 0.03), mid[1] + uz * sl / 2 + nz * (d + 0.03)];
            collision.addSegment(f0[0], f0[1], f1[0], f1[1], sh);
          }
        }
        // plafonnier : rosace, tige, abat-jour émissif ; une source de lumière chaude
        box(M, r.cx, H - 0.06, r.cz, 1, 0, 0.18, 0.06, 0.18, [0.25, 0.22, 0.2]);
        box(M, r.cx, H - 0.5, r.cz, 1, 0, 0.03, 0.44, 0.03, [0.15, 0.14, 0.13]);
        lightSources.push({ x: r.cx, y: H - 0.85, z: r.cz, color: A.lightColor, intensity: A.lightIntensity, dist: A.lightDist });
      }
      // maillages
      const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 });
      // Lumière d'ambiance réduite à l'intérieur le jour (le ciel n'entre que par la porte) : uAmb multiplie l'éclairage indirect des matériaux des pièces
      const dimAmbient = (m) => {
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uAmb = api.amb;
          sh.fragmentShader = 'uniform float uAmb;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse *= uAmb;\n  reflectedLight.indirectSpecular *= uAmb;');
        };
        m.customProgramCacheKey = () => 'interior-amb';
        return m;
      };
      const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02, map: floorTexture(0), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const tileMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05, map: floorTexture(1), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const furnMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.03 });
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc070, emissiveIntensity: 1.1, roughness: 0.5 });
      [wallMat, woodMat, tileMat, furnMat].forEach(dimAmbient);
      api.mats = { wall: wallMat, wood: woodMat, tile: tileMat, furn: furnMat, lamp: lampMat }; // shared with keyBuildings.js (same ambient patch: no new shader program)
      api.tiles = [];
      for (const t of tiles.values()) {
        const T = { cx: t.cx, cz: t.cz, half: t.half, meshes: [] };
        [[t.b[0], wallMat, true], [t.b[1], woodMat, false], [t.b[2], tileMat, false], [t.b[3], furnMat, false]].forEach(([B, mat, shadow]) => {
          if (!B.idx.length) return;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
          g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
          g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
          g.setIndex(B.idx);
          g.computeBoundingSphere();
          const m = new THREE.Mesh(g, mat);
          gpuOnly(m); m.name = 'interior'; m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.userData.lod = true; // (castShadow off: the building shell casts the shadow)
          scene.add(m); T.meshes.push(m);
        });
        api.tiles.push(T);
      }
      // abat-jours : petites boîtes émissives (un seul maillage instancié pour toute la carte)
      const lampGeo = new THREE.BoxGeometry(0.36, 0.2, 0.36), lamps = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, rooms.length));
      const m4 = new THREE.Matrix4();
      rooms.forEach((r, i) => lamps.setMatrixAt(i, m4.makeTranslation(r.cx, H - 0.68, r.cz)));
      lamps.count = rooms.length; lamps.instanceMatrix.needsUpdate = true; lamps.computeBoundingSphere(); lamps.name = 'interior:lamps';
      scene.add(lamps);
      tiles.clear();
      api.apply();
    },

    amb: { value: 1 },
    // Jour (k = 1) : ambiance intérieure à ambientDay ; nuit (k = 0) : inchangée (le plafonnier éclaire)
    setDaylight(k) { api.amb.value = 1 - (1 - (C().ambientDay ?? 0.35)) * Math.min(1, Math.max(0, k)); },
    range: CONFIG.interiors?.range ?? 70, px: 1e9, pz: 1e9, tiles: [],
    update(px, pz) { api.px = px; api.pz = pz; api.apply(); },
    apply() {
      for (const T of api.tiles) {
        const vis = Math.hypot(T.cx - api.px, T.cz - api.pz) - T.half < api.range;
        for (const m of T.meshes) if (m.visible !== vis) m.visible = vis;
      }
    },
  };
  return api;
}
