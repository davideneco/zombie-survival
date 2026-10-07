import * as THREE from 'three';
import { canvasTex, GLASS, stainedGlass, floorTex, vaultTex, roseTex } from '../cathedral.js';

// Accumulateur de géométrie : tous les polygones d'un même matériau finissent dans un seul maillage.
export class Mesher {
  constructor() { this.bufs = new Map(); }
  _b(mat) {
    let b = this.bufs.get(mat);
    if (!b) { b = { pos: [], uv: [], idx: [] }; this.bufs.set(mat, b); }
    return b;
  }
  vert(mat, p, uv) { const b = this._b(mat); b.pos.push(p[0], p[1], p[2]); b.uv.push(uv[0], uv[1]); return b.pos.length / 3 - 1; }
  tri(mat, a, b, c, ua = [0, 0], ub = [1, 0], uc = [0, 1]) {
    const i = this.vert(mat, a, ua), j = this.vert(mat, b, ub), k = this.vert(mat, c, uc);
    this._b(mat).idx.push(i, j, k);
  }
  quad(mat, a, b, c, d, ua = [0, 0], ub = [1, 0], uc = [1, 1], ud = [0, 1]) {
    const bb = this._b(mat);
    const i = this.vert(mat, a, ua), j = this.vert(mat, b, ub), k = this.vert(mat, c, uc), l = this.vert(mat, d, ud);
    bb.idx.push(i, j, k, i, k, l);
  }
  // Bande verticale le long d'une polyligne 2D [[x, z], …] de y0 à y1. u : 1 par uScale mètres ; v : (y - vOrigin) / vScale
  strip(mat, pts, y0, y1, o = {}) {
    const { uScale = 6, vScale = 32, vOrigin = 0, uStart = 0 } = o;
    let u = uStart;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-4) continue;
      const u1 = u + l / uScale;
      this.quad(mat, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [u, (y0 - vOrigin) / vScale], [u1, (y0 - vOrigin) / vScale], [u1, (y1 - vOrigin) / vScale], [u, (y1 - vOrigin) / vScale]);
      u = u1;
    }
    return u;
  }
  // Polygone horizontal (triangulé), uv = (x, z) / uvScale
  flat(mat, pts, y, o = {}) {
    const { uvScale = 5, holes = [], up = true, uvFn = null } = o;
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = [...contour, ...hs.flat()];
    for (const [i, j, k] of tris) {
      const a = all[i], b = all[j], c = all[k];
      const uv = (p) => (uvFn ? uvFn(p.x, p.y) : [p.x / uvScale, p.y / uvScale]);
      if (up) this.tri(mat, [a.x, y, a.y], [b.x, y, b.y], [c.x, y, c.y], uv(a), uv(b), uv(c));
      else this.tri(mat, [a.x, y, a.y], [c.x, y, c.y], [b.x, y, b.y], uv(a), uv(c), uv(b));
    }
  }
  // Ajoute une géométrie THREE (indexée ou non) transformée par la matrice m
  geo(mat, g, m = null) {
    const b = this._b(mat);
    const pos = g.attributes.position, uv = g.attributes.uv, base = b.pos.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); if (m) v.applyMatrix4(m);
      b.pos.push(v.x, v.y, v.z);
      b.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) b.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
  }
  build(scene, { castShadow = false, receiveShadow = true } = {}) {
    const out = [];
    for (const [mat, b] of this.bufs) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = castShadow; m.receiveShadow = receiveShadow;
      m.name = 'cath';
      scene.add(m);
      out.push(m);
    }
    this.bufs.clear();
    return out;
  }
}

// ------------------------------------------------------------------ textures de murs (6 m de large, H m de haut)
// kind : 'aisle' (bas-côté), 'naveUp' (mur haut de la nef), 'transept', 'chapel', 'plain'
const M = 64; // pixels par mètre
function wallTexture(kind, H, y0 = 0) {
  const W = 6 * M, Hh = Math.round(H * M);
  const draw = (x, w, h, emis) => {
    const Y = (m) => h - (m - y0) * M; // hauteur monde -> pixel
    if (!emis) {
      x.fillStyle = '#a77866'; x.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 0.42 * M) { x.fillStyle = 'rgba(50,20,15,0.33)'; x.fillRect(0, y, w, 2); for (let xx = (Math.round(y) % 2) * 20; xx < w; xx += 0.9 * M) x.fillRect(xx, y, 2, 0.42 * M); }
      for (let i = 0; i < 2200; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,220,200'},0.06)`; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    }
    const lancet = (cx, ya, yb, ww) => stainedGlass(x, cx - ww / 2, Y(yb), ww, (yb - ya) * M, emis);
    const band = (ya, yb, col) => { if (!emis && Y(yb) < h && Y(ya) > 0) { x.fillStyle = col; x.fillRect(0, Y(yb), w, (yb - ya) * M); } };
    if (kind === 'aisle') {
      for (const lx of [1.5, 4.5]) { lancet(lx * M, 3.6, 12.2, 1.9 * M); if (!emis) { x.strokeStyle = '#6a4636'; x.lineWidth = 6; x.strokeRect(lx * M - 1.05 * M, Y(12.4), 2.1 * M, 8.9 * M); } }
      band(2.9, 3.2, '#8a5a48');
      if (!emis) for (let k = 0; k < 3; k++) { x.strokeStyle = '#7a5040'; x.lineWidth = 5; const ax = k * w / 3 + 12, aw = w / 3 - 24; x.beginPath(); x.moveTo(ax, Y(0)); x.lineTo(ax, Y(2)); x.quadraticCurveTo(ax + aw / 2, Y(3.1), ax + aw, Y(2)); x.lineTo(ax + aw, Y(0)); x.stroke(); }
    } else if (kind === 'naveUp') {
      // y0 = 14,5 : triforium (arcature à jour) puis grandes fenêtres hautes
      if (!emis) {
        band(14.5, 15, '#8a5a48');
        for (let k = 0; k < 6; k++) { const ax = k * w / 6 + 8, aw = w / 6 - 16; x.fillStyle = '#2a1c18'; x.beginPath(); x.moveTo(ax, Y(15.2)); x.lineTo(ax, Y(17)); x.quadraticCurveTo(ax + aw / 2, Y(18.1), ax + aw, Y(17)); x.lineTo(ax + aw, Y(15.2)); x.fill(); x.strokeStyle = '#6a4636'; x.lineWidth = 4; x.stroke(); }
        band(18.4, 18.9, '#8a5a48');
      }
      for (const lx of [1.5, 4.5]) lancet(lx * M, 19.4, 30.4, 2.0 * M);
    } else if (kind === 'transept') {
      band(2.9, 3.2, '#8a5a48');
      for (const lx of [1.5, 4.5]) { lancet(lx * M, 3.8, 14, 2.0 * M); lancet(lx * M, 16, 26.2, 2.0 * M); }
      band(14.6, 15, '#8a5a48');
    } else if (kind === 'chapel') {
      lancet(3 * M, 3.4, 9.6, 2.0 * M);
    } else if (kind === 'spire') {
      for (const [ya, yb, ww] of [[69.5, 80.5, 2.0], [83.5, 94.5, 2.0], [96.5, 102.2, 1.6]]) lancet(3 * M, ya, yb, ww * M);
      for (const lx of [0.9, 5.1]) lancet(lx * M, 71, 78, 0.9 * M);
      band(67.5, 68.2, '#8a5a48'); band(82, 82.5, '#8a5a48'); band(95.2, 95.7, '#8a5a48');
    } else if (kind === 'tower') {
      for (const lx of [1.5, 4.5]) lancet(lx * M, 3.5, 17.5, 1.8 * M);
      band(1.2, 1.5, '#8a5a48'); band(19.5, 19.9, '#8a5a48');
    }
  };
  return [canvasTex(W, Hh, draw, false), canvasTex(W, Hh, draw, true)];
}
function wallMaterial(kind, H, y0 = 0) {
  if (kind === 'plain') return new THREE.MeshStandardMaterial({ color: 0xa88070, roughness: 0.9, side: THREE.DoubleSide });
  const [map, em] = wallTexture(kind, H, y0);
  return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.85, side: THREE.DoubleSide });
}

// Tous les matériaux de l'intérieur (créés une fois)
export function makeMaterials() {
  const m = {
    // pierre : poussée vers l'arrière (polygonOffset positif) : les faces de dessous des socles, coplanaires avec le sol de la ville, et les
    // sommets de murs sous un plancher ne se disputent plus le pixel ; stoneDark l'emporte sur stone, la dalle (deck) sur les deux
    stone: new THREE.MeshStandardMaterial({ color: 0xa87c6a, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0x6a5048, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a640, roughness: 0.3, metalness: 0.9, emissive: 0x3a2808 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.75 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.5, metalness: 0.7 }),
    floor: new THREE.MeshStandardMaterial({ map: floorTex(), roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x8a6e60, roughness: 0.9, side: THREE.DoubleSide }),
    vault: new THREE.MeshStandardMaterial({ map: vaultTex(), roughness: 0.9, side: THREE.DoubleSide }),
    plain: new THREE.MeshStandardMaterial({ color: 0xa88070, roughness: 0.9, side: THREE.DoubleSide }),
  };
  m.wall = {
    aisle: wallMaterial('aisle', 14.5),
    naveUp: wallMaterial('naveUp', 17.5, 14.5),
    transept: wallMaterial('transept', 28),
    chapel: wallMaterial('chapel', 12),
    tower: wallMaterial('tower', 21.5),
    spire: wallMaterial('spire', 36.5, 67.5),
    plain: m.plain,
  };
  return m;
}
export { roseTex, GLASS };
