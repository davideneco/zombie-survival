import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';
import { inStationClip, groundProfile, farGroundY } from './railNet.js';
import { buildLand } from './rideLand.js';

// =====================================================================
//  Trackside scenery of the intro ride (v0.81.0) : cheap, instanced decor along the south-west approach, outside the station clip.
//    - a dark far ground (one plane that follows the camera, snapped to its texture tile : it looks fixed) under the track strip of railNet.js ;
//    - fences beyond the outermost track of each side, trees and bushes, generic low buildings (warehouses, blocks of flats, houses) with a
//      few lit windows, yard lamp posts (emissive heads), signals beside the route, and derailed wagons at the slowdown of the intro ;
//    - one InstancedMesh per geometry (about 20 draw calls for the whole ride), no shadows, deterministic placement (seeded).
//  Placement keeps `clear` m from every track of rail.json (SNCF and OSM), off the station bounds and its surrounding buildings.
//  Decor only : no collision (nobody walks there : the train doors stay closed during the ride).
//  v0.88.0 : the 6 km ride lays the real landscape (rideland.json, rideLand.js) on top : buildings, churches, fields, woods, roads, rivers, level
//  crossings, bridges ; the ground follows railNet.groundProfile (embankment, bridge decks) ; without that file the random decor of v0.81.0 is used.
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function seeded(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
function tex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

// ------------------------------------------------------------------ geometry kit : faces oriented away from an interior reference point
function kit() {
  const pos = [], uv = [];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
  const tri = (A, B, C, ua, ub, uc, ref) => {
    _a.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]); _b.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]); _n.crossVectors(_a, _b);
    const cx = (A[0] + B[0] + C[0]) / 3 - ref[0], cy = (A[1] + B[1] + C[1]) / 3 - ref[1], cz = (A[2] + B[2] + C[2]) / 3 - ref[2];
    if (_n.x * cx + _n.y * cy + _n.z * cz < 0) { [B, C] = [C, B]; [ub, uc] = [uc, ub]; }
    pos.push(...A, ...B, ...C); uv.push(...ua, ...ub, ...uc);
  };
  const quad = (A, B, C, D, ua, ub, uc, ud, ref) => { tri(A, B, C, ua, ub, uc, ref); tri(A, C, D, ua, uc, ud, ref); };
  return {
    tri, quad,
    // vertical prism over a footprint [[x, z]…] from y0 to y1 ; uvOf(edgeStart (m along the perimeter), edgeLen, y) -> [u, v] ; top : roof uv region
    prism(poly, y0, y1, uvOf, top = null) {
      let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= poly.length; cz /= poly.length;
      const ref = [cx, (y0 + y1) / 2, cz];
      let acc = 0;
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], l = Math.hypot(bx - ax, bz - az);
        quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], uvOf(acc, 0, y0, i), uvOf(acc, l, y0, i), uvOf(acc, l, y1, i), uvOf(acc, 0, y1, i), ref);
        acc += l;
      }
      if (top) { const r2 = [cx, y0 - 1, cz]; for (let i = 1; i < poly.length - 1; i++) tri([poly[0][0], y1, poly[0][1]], [poly[i][0], y1, poly[i][1]], [poly[i + 1][0], y1, poly[i + 1][1]], top, top, top, r2); }
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals(); g.computeBoundingSphere();
      return g;
    },
  };
}
const rect = (L, D, o = 0) => [[-L / 2 - o, -D / 2 - o], [L / 2 + o, -D / 2 - o], [L / 2 + o, D / 2 + o], [-L / 2 - o, D / 2 + o]];

// ------------------------------------------------------------------ building atlases (512 x 512) : facade in v 0.25..1, roof (u < 0.5) and
// plinth / trim (u > 0.5) in v 0..0.25 ; an emissive twin with the lit windows only
const ROOF_UV = [0.25, 0.12], TRIM_UV = [0.75, 0.12];
function facadeAtlas(kind, rnd) {
  const lit = [];
  const draw = (x, W) => {
    const H = 384;
    if (kind === 'warehouse') { // corrugated sheet, loading doors, a band of high windows
      x.fillStyle = '#545a55'; x.fillRect(0, 0, W, H);
      for (let i = 0; i < W; i += 6) { x.fillStyle = i % 12 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.05)'; x.fillRect(i, 0, 3, H); }
      for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(60,40,25,${0.08 + rnd() * 0.12})`; x.fillRect(rnd() * W, H * 0.3 + rnd() * H * 0.5, 2 + rnd() * 5, H * 0.3); } // rust streaks
      for (const dx of [0.18, 0.62]) { x.fillStyle = '#2c302e'; x.fillRect(dx * W, H * 0.62, W * 0.16, H * 0.38); x.strokeStyle = '#6c706a'; x.lineWidth = 3; x.strokeRect(dx * W, H * 0.62, W * 0.16, H * 0.38); }
      for (let i = 0; i < 10; i++) { const wx = 14 + i * (W - 28) / 10, wy = H * 0.42; x.fillStyle = '#1a1f24'; x.fillRect(wx, wy, 30, 16); if (rnd() < 0.4) lit.push([wx + 2, wy + 2, 26, 12, '#ffb35a']); }
    } else if (kind === 'block') { // rendered block of flats : 5 floors x 8 windows, frames, balconies
      x.fillStyle = '#7d776c'; x.fillRect(0, 0, W, H);
      for (let k = 0; k < 900; k++) { const g = 100 + rnd() * 30; x.fillStyle = `rgba(${g},${g - 4},${g - 12},0.25)`; x.fillRect(rnd() * W, rnd() * H, 3, 3); }
      for (let f = 0; f < 5; f++) for (let i = 0; i < 8; i++) {
        const wx = 16 + i * (W - 32) / 8, wy = 22 + f * (H - 40) / 5, ww = 30, wh = 40;
        x.fillStyle = '#5b574f'; x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        x.fillStyle = '#161a20'; x.fillRect(wx, wy, ww, wh);
        if (rnd() < 0.3) lit.push([wx, wy, ww, wh, rnd() < 0.7 ? '#ffc070' : '#cfe0ff']);
        if (f > 0 && i % 3 === 1) { x.fillStyle = '#4a463f'; x.fillRect(wx - 8, wy + wh - 4, ww + 16, 8); }
      }
      x.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 12; k++) x.fillRect(rnd() * W, 0, 2, H); // rain streaks
    } else if (kind === 'church') { // stone-grey render, tall narrow windows, a louvred belfry band
      x.fillStyle = '#8b887f'; x.fillRect(0, 0, W, H);
      for (let k = 0; k < 900; k++) { const g = 110 + rnd() * 30; x.fillStyle = `rgba(${g},${g - 2},${g - 8},0.3)`; x.fillRect(rnd() * W, rnd() * H, 3, 3); }
      for (let i = 0; i < 6; i++) { const wx = 22 + i * (W - 44) / 6, wy = H * 0.34; x.fillStyle = '#5a574f'; x.fillRect(wx - 3, wy - 3, 28, 96); x.fillStyle = '#12151a'; x.fillRect(wx, wy, 22, 90); x.beginPath(); x.arc(wx + 11, wy, 11, Math.PI, 0); x.fill(); if (rnd() < 0.3) lit.push([wx + 2, wy + 4, 18, 80, '#ffbf6a']); }
      x.fillStyle = '#2a2a2a'; for (let i = 0; i < 12; i++) x.fillRect(0, 6 + i * 6, W, 3); // belfry louvres (the top rows)
    } else { // house : half-timbered (colombage) : plaster panels, dark timber frame with braces, shuttered windows, a door
      const plaster = ['#d9ccb0', '#cdbf9c', '#dcd2bd'][Math.floor(rnd() * 3)];
      x.fillStyle = plaster; x.fillRect(0, 0, W, H);
      for (let k = 0; k < 800; k++) { const g = 150 + rnd() * 50; x.fillStyle = `rgba(${g},${g - 10},${g - 30},0.18)`; x.fillRect(rnd() * W, rnd() * H, 4, 4); }
      const timber = '#2c2119', fy = [10, H * 0.5, H - 8];
      x.fillStyle = timber; for (const y of fy) x.fillRect(0, y - 4, W, 9);
      const bays = 5, bw = W / bays;
      for (let i = 0; i <= bays; i++) x.fillRect(i * bw - 4, 6, 9, H - 10);
      x.strokeStyle = timber; x.lineWidth = 6;
      for (let f2 = 0; f2 < 2; f2++) for (let i = 0; i < bays; i++) { const y0 = fy[f2] + 4, y1 = fy[f2 + 1] - 4, x0 = i * bw + 4; if ((i + f2) % 2 === 0) { x.beginPath(); x.moveTo(x0, y1); x.lineTo(x0 + bw - 8, y0 + (y1 - y0) * 0.45); x.stroke(); } else { x.beginPath(); x.moveTo(x0 + bw - 8, y1); x.lineTo(x0, y0 + (y1 - y0) * 0.45); x.stroke(); } }
      for (let f2 = 0; f2 < 2; f2++) for (let i = 0; i < bays; i++) {
        const wx = i * bw + bw / 2 - 17, wy = fy[f2] + 28, ww = 34, wh = 46;
        if (f2 === 1 && i === 2) { x.fillStyle = '#3a2a1e'; x.fillRect(wx - 6, fy[1] + 8, ww + 12, H - fy[1] - 16); x.fillStyle = '#c8a455'; x.fillRect(wx + ww - 2, fy[1] + 70, 5, 5); continue; }
        x.fillStyle = ['#4f6a4a', '#6a4038', '#3f5668'][(i + f2) % 3]; x.fillRect(wx - 14, wy, 12, wh); x.fillRect(wx + ww + 2, wy, 12, wh); // shutters
        x.fillStyle = '#14181d'; x.fillRect(wx, wy, ww, wh);
        x.fillStyle = '#d6d0c0'; x.fillRect(wx - 2, wy + wh, ww + 4, 5);
        if (rnd() < 0.3) lit.push([wx, wy, ww, wh, '#ffb860']);
      }
    }
    // dirt at the foot
    const g = x.createLinearGradient(0, H * 0.75, 0, H); g.addColorStop(0, 'rgba(20,18,14,0)'); g.addColorStop(1, 'rgba(20,18,14,0.55)'); x.fillStyle = g; x.fillRect(0, H * 0.75, W, H * 0.25);
  };
  const map = canvas(512, 512, (x, W) => {
    draw(x, W);
    // roof (u < 0.5) and trim (u > 0.5)
    x.fillStyle = kind === 'house' ? '#6a3f33' : kind === 'church' ? '#2c3036' : '#2e3033'; x.fillRect(0, 384, 256, 128);
    if (kind === 'house') for (let r = 0; r < 16; r++) { x.fillStyle = r % 2 ? 'rgba(0,0,0,0.22)' : 'rgba(255,200,170,0.08)'; x.fillRect(0, 384 + r * 8, 256, 3); }
    for (let k = 0; k < 300; k++) { const gg = 40 + rnd() * 25; x.fillStyle = `rgba(${gg},${gg},${gg + 4},0.5)`; x.fillRect(rnd() * 256, 384 + rnd() * 128, 6, 3); }
    x.fillStyle = '#4c4a45'; x.fillRect(256, 384, 256, 128);
    for (let k = 0; k < 200; k++) { const gg = 60 + rnd() * 30; x.fillStyle = `rgba(${gg},${gg - 2},${gg - 6},0.5)`; x.fillRect(256 + rnd() * 256, 384 + rnd() * 128, 4, 4); }
  });
  const emi = canvas(512, 512, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512); for (const [a, b, c, d, col] of lit) { x.fillStyle = col; x.fillRect(a, b, c, d); x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(a + c / 2 - 1, b, 2, d); } });
  return { map: tex(map), emissiveMap: tex(emi) };
}

// building geometry (local : x along the long side, z across, y up from the ground) ; base sizes in m, scaled per instance (±25 %)
function buildingGeo(kind) {
  const K = kit(), V = (y, Ht) => 0.25 + 0.75 * clamp(y / Ht, 0, 1);
  if (kind === 'warehouse') {
    const L = 30, D = 16, H = 7, R = 2.4, Ht = H + R;
    K.prism(rect(L, D), 0, H, (s, l, y, i) => [i % 2 ? (l ? 0.5 : 0) : (l ? 1 : 0), V(y, Ht)]);
    for (const sx of [-1, 1]) K.tri([sx * L / 2, H, -D / 2], [sx * L / 2, H, D / 2], [sx * L / 2, H + R, 0], [0, V(H, Ht)], [0.5, V(H, Ht)], [0.25, 1], [0, H / 2, 0]); // gables
    const o = 0.45; // roof with overhang, fascia
    for (const sz of [-1, 1]) K.quad([-L / 2 - o, H - 0.15, sz * (D / 2 + o)], [L / 2 + o, H - 0.15, sz * (D / 2 + o)], [L / 2 + o, H + R, 0], [-L / 2 - o, H + R, 0], [0.02, 0.02], [0.48, 0.02], [0.48, 0.23], [0.02, 0.23], [0, 0, 0]);
    K.prism(rect(L, D, 0.08), -0.4, 0.8, () => TRIM_UV); // plinth
  } else if (kind === 'block') {
    const L = 24, D = 12, H = 14;
    K.prism(rect(L, D), 0, H, (s, l, y, i) => [i % 2 ? (l ? 0.5 : 0) : (l ? 1 : 0), V(y, H)], ROOF_UV);
    K.prism(rect(L, D, 0.1), H, H + 0.7, () => TRIM_UV, ROOF_UV);   // parapet
    K.prism(rect(L, D, 0.28), H - 0.5, H - 0.15, () => TRIM_UV, TRIM_UV); // cornice
    K.prism(rect(L, D, 0.1), -0.4, 1.0, () => TRIM_UV);              // plinth
    K.prism(rect(L, D, 0.16), 3.2, 3.45, () => TRIM_UV, TRIM_UV);     // string course above the ground floor
  } else {
    const L = 10, D = 8, H = 5.6, R = 3.4, Ht = H + R;
    K.prism(rect(L, D), 0, H, (s, l, y, i) => [i % 2 ? (l ? 0.8 : 0) : (l ? 1 : 0), V(y, Ht)]);
    for (const sx of [-1, 1]) K.tri([sx * L / 2, H, -D / 2], [sx * L / 2, H, D / 2], [sx * L / 2, H + R, 0], [0.1, V(H, Ht)], [0.7, V(H, Ht)], [0.4, 1], [0, H / 2, 0]);
    const o = 0.55;
    for (const sz of [-1, 1]) K.quad([-L / 2 - o, H - 0.3, sz * (D / 2 + o)], [L / 2 + o, H - 0.3, sz * (D / 2 + o)], [L / 2 + o, H + R + 0.05, 0], [-L / 2 - o, H + R + 0.05, 0], [0.02, 0.02], [0.48, 0.02], [0.48, 0.23], [0.02, 0.23], [0, 0, 0]);
    K.prism([[2.0, -1.6], [2.8, -1.6], [2.8, -0.8], [2.0, -0.8]], H + 0.8, H + R + 0.8, () => TRIM_UV, TRIM_UV); // chimney
    K.prism(rect(L, D, 0.06), -0.4, 0.6, () => TRIM_UV);
  }
  return K.geometry();
}

// jittered blob (canopy, bush) : non-indexed icosahedron, flat shaded
function blob(r, detail, rnd, sx = 1, sy = 1) {
  const g0 = new THREE.IcosahedronGeometry(r, detail), g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position, key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`, J = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i), p.getY(i), p.getZ(i));
    if (!J.has(k)) J.set(k, 0.82 + rnd() * 0.36);
    const f = J.get(k); p.setXYZ(i, p.getX(i) * f * sx, p.getY(i) * f * sy, p.getZ(i) * f * sx);
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ the scenery
// route : buildIntroRoute() ; plan : station plan ; rail : rail.json ; gare : gare.json (surrounding buildings) ; sFrom, sTo : route range ;
// wreckS : s of the middle of the derailed wagons (null : none) ; groundMat : the trackside ground material of railNet.js ; groundY : its level
export function buildRideScenery({ route, plan, rail, gare, land = null, sFrom, wreckS = null, groundMat, groundY }) {
  const C = CONFIG.intro.scenery, R = CONFIG.railNet, rnd = seeded(C.seed);
  const root = new THREE.Group(); root.name = 'rideScenery'; root.userData.noTerrain = true;
  const tr = route.track, at = (s, o) => tr.at(clamp(s, 0, tr.L), o);
  const meshes = [];
  // instances are binned in chunks of C.chunk m along the route (each instance matrix carries its abscissa `.s`) : one InstancedMesh per
  // geometry per chunk, and a chunk is drawn only while the camera is within C.chunkView m of its stretch (draw calls at the station)
  const chunks = [];
  const chunkOf = (k) => { let ch = chunks[k]; if (!ch) { ch = chunks[k] = new THREE.Group(); ch.name = 'ride:chunk' + k; ch.userData.s0 = sFrom + k * C.chunk; ch.userData.s1 = ch.userData.s0 + C.chunk; root.add(ch); } return ch; };
  const kOf = (s) => Math.max(0, Math.floor(((s ?? sFrom) - sFrom) / C.chunk));
  // merged static geometry (fields, roads, rivers : one mesh per material per chunk)
  const mergedQ = new Map();
  const merge1 = (geo, mat, s, name) => { const key = kOf(s) + '|' + mat.uuid; let e = mergedQ.get(key); if (!e) mergedQ.set(key, e = { k: kOf(s), mat, name, list: [] }); e.list.push(geo.index ? geo.toNonIndexed() : geo); };
  const flushMerged = () => {
    for (const e of mergedQ.values()) {
      for (const g of e.list) for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a);
      const g = mergeGeometries(e.list, false); e.list.forEach((q) => q.dispose()); if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, e.mat); m.name = 'ride:' + e.name; m.castShadow = false; m.receiveShadow = false; m.userData.noTerrain = true;
      chunkOf(e.k).add(m); meshes.push(m);
    }
    mergedQ.clear();
  };
  const add = (geo, mat, list, name, color = null) => {
    if (!list.length) return null;
    const bins = new Map();
    list.forEach((m, i) => { const k = kOf(m.s); let b = bins.get(k); if (!b) bins.set(k, b = []); b.push(i); });
    for (const [k, idx] of bins) {
      const im = new THREE.InstancedMesh(geo, mat, idx.length); im.name = 'ride:' + name;
      idx.forEach((i, j) => { im.setMatrixAt(j, list[i]); if (color) im.setColorAt(j, color[i]); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = false; im.receiveShadow = false; im.userData.noTerrain = true;
      im.computeBoundingSphere();
      chunkOf(k).add(im); meshes.push(im);
    }
    return true;
  };
  let curS = sFrom; // abscissa of the instances being placed
  const facCache = {};

  // ---------------------------------------------------------------- where things may stand
  // end of the range : the station clip (its tracks and surroundings are the station's)
  let sTo = tr.L;
  { const o = {}; for (let s = sFrom; s < tr.L; s += 4) { at(s, o); const [u, v] = plan.L(o.x, o.z); if (inStationClip(plan, u, v)) { sTo = s - C.clip; break; } } }
  // track occupancy : every track of rail.json, 2 m samples in a 6 m hash grid
  const CELL = 6, grid = new Map(), gk = (i, j) => i * 100003 + j;
  const putPt = (x, z) => { const k = gk(Math.floor(x / CELL), Math.floor(z / CELL)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(x, z); };
  for (const t of rail.tracks || []) for (let i = 1; i < t.pts.length; i++) {
    const [ax, az] = t.pts[i - 1], [bx, bz] = t.pts[i], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 2));
    for (let k = 0; k <= n; k++) putPt(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
  }
  for (let i = 0; i < tr.n; i += 2) putPt(tr.x[i], tr.z[i]);
  const nearTrack = (x, z, r) => {
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL), r2 = r * r;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = grid.get(gk(i, j)); if (!a) continue; for (let k = 0; k < a.length; k += 2) { const dx = a[k] - x, dz = a[k + 1] - z; if (dx * dx + dz * dz < r2) return true; } }
    return false;
  };
  // station bounds and its surrounding buildings (bounding boxes + margin)
  const B = plan.bounds, M = 25;
  const boxes = [];
  for (const b of gare?.buildings || []) { if (!b.pts?.length) continue; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of b.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } boxes.push([x0 - 6, x1 + 6, z0 - 6, z1 + 6]); }
  const freeLand = (x, z) => !(x > B.x0 - M && x < B.x1 + M && z > B.z0 - M && z < B.z1 + M) && !boxes.some((b) => x > b[0] && x < b[1] && z > b[2] && z < b[3]);
  // ground level at w m from the route (the strip of railNet.js : flat over the ballast foot, sloping to the corridor edge ; then the far plane)
  const strip = R.ballast.foot / 2 + 0.4;
  const groundAt = (w, s = curS) => groundProfile(w, s, route); // (embankment and bridge decks, railNet.js)

  // ---------------------------------------------------------------- fence line per side : beyond the outermost track (none where they fan out)
  const bridgeIn = (s) => (route.bridges || []).some((b) => s > b.s0 - 3 && s < b.s1 + 3);
  const fenceW = { '-1': [], 1: [] }, step = C.fenceEvery, o1 = {};
  const fs0 = sFrom, nF = Math.max(0, Math.floor((sTo - fs0) / step));
  for (const sd of [-1, 1]) {
    const raw = [];
    for (let i = 0; i <= nF; i++) {
      at(fs0 + i * step, o1);
      let env = 0;
      for (let w = 2.5; w <= R.corridor + 2; w += 1) if (nearTrack(o1.x - o1.tz * sd * w, o1.z + o1.tx * sd * w, 1.0)) env = w;
      raw.push(env > 0 ? env + R.ballast.foot / 2 + C.fenceGap : strip + C.fenceGap);
    }
    const out = fenceW[sd];
    for (let i = 0; i <= nF; i++) { let m = 0; for (let k = -8; k <= 8; k++) m = Math.max(m, raw[clamp(i + k, 0, nF)]); out.push(m); }
  }
  const fenceAt = (s, sd) => { const a = fenceW[sd]; return a.length ? a[clamp(Math.round((s - fs0) / step), 0, a.length - 1)] : strip + C.fenceGap; };

  // ---------------------------------------------------------------- materials
  const concrete = new THREE.MeshStandardMaterial({ color: 0x67655f, roughness: 0.9, metalness: 0.02 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.55, metalness: 0.6 });
  const linkTex = tex(canvas(64, 64, (x) => { x.clearRect(0, 0, 64, 64); x.strokeStyle = '#c8ccd0'; x.lineWidth = 3; for (let k = -64; k < 128; k += 16) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 64, 64); x.stroke(); x.beginPath(); x.moveTo(k + 64, 0); x.lineTo(k, 64); x.stroke(); } }));
  linkTex.wrapS = linkTex.wrapT = THREE.RepeatWrapping; linkTex.repeat.set(10, 6);
  const fenceMat = new THREE.MeshStandardMaterial({ map: linkTex, color: 0x6c7276, roughness: 0.6, metalness: 0.5, alphaTest: 0.45, side: THREE.DoubleSide });
  const bark = new THREE.MeshStandardMaterial({ color: 0x3b3129, roughness: 0.95 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, flatShading: true });
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, emissive: 0xffb45a, emissiveIntensity: 2.6, roughness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0x300806, emissive: 0xff2412, emissiveIntensity: 3.2, roughness: 0.3 });
  const green = new THREE.MeshStandardMaterial({ color: 0x06200c, emissive: 0x2aff6a, emissiveIntensity: 2.4, roughness: 0.3 });
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const mat4 = (x, y, z, yaw, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) => { _e.set(pitch, yaw, roll); _q.setFromEuler(_e); const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); m.s = curS; return m; };
  const yawOf = (o) => Math.atan2(-o.tx, -o.tz) + Math.PI / 2; // local +x along the route

  // ---------------------------------------------------------------- fences : concrete posts + chain-link panels
  {
    const post = new RoundedBoxGeometry(0.13, 2.2, 0.13, 1, 0.025); post.translate(0, 1.1 - 0.3, 0);
    const panel = new THREE.PlaneGeometry(1, 1.8); panel.translate(0.5, 0.9 + 0.05, 0);
    const posts = [], panels = [], a = {}, b = {};
    for (const sd of [-1, 1]) {
      let prev = null;
      for (let i = 0; i <= nF; i++) {
        const s = fs0 + i * step, w = fenceW[sd][i];
        if (w > R.corridor + 1.5) { prev = null; continue; }
        at(s, a);
        const x = a.x - a.tz * sd * w, z = a.z + a.tx * sd * w, y = groundAt(sd * w, s);
        if (!freeLand(x, z) || nearTrack(x, z, 1.4) || bridgeIn(s)) { prev = null; continue; }
        curS = s; posts.push(mat4(x, y, z, yawOf(a)));
        if (prev) { const dx = x - prev[0], dz = z - prev[1], l = Math.hypot(dx, dz); if (l < step * 1.8) panels.push(mat4(prev[0], (y + prev[2]) / 2, prev[1], Math.atan2(-dz, dx), l, 1, 1)); }
        prev = [x, z, y];
      }
    }
    add(post, concrete, posts, 'fencePost');
    add(panel, fenceMat, panels, 'fence');
  }

  // ---------------------------------------------------------------- random spots beyond the fence
  const o2 = {};
  const spot = (wMin, wMax, clear, pow = 1) => {
    for (let tries = 0; tries < 12; tries++) {
      const s = sFrom + rnd() * (sTo - sFrom), sd = rnd() < 0.5 ? -1 : 1;
      at(s, o2);
      const fw = fenceAt(s, sd), w = Math.max(fw + 1.2, wMin) + Math.pow(rnd(), pow) * Math.max(0, wMax - Math.max(fw + 1.2, wMin));
      const x = o2.x - o2.tz * sd * w, z = o2.z + o2.tx * sd * w;
      if (!freeLand(x, z) || nearTrack(x, z, C.clear + clear)) continue;
      curS = s;
      return { s, sd, w, x, z, y: groundAt(sd * w, s), yaw: yawOf(o2) };
    }
    return null;
  };
  const [b0, b1] = C.band;

  // ---------------------------------------------------------------- buildings (three kinds), kept apart
  const placed = [];
  // circles of what stands there (houses, churches) : 20 m hash grid
  const occ = new Map(), ok2 = (i, j) => i * 100003 + j;
  const reserve = (x, z, r) => { const k = ok2(Math.floor(x / 20), Math.floor(z / 20)); let a = occ.get(k); if (!a) occ.set(k, a = []); a.push(x, z, r); };
  const isFree = (x, z, r) => {
    const i0 = Math.floor((x - r - 40) / 20), i1 = Math.floor((x + r + 40) / 20), j0 = Math.floor((z - r - 40) / 20), j1 = Math.floor((z + r + 40) / 20);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = occ.get(ok2(i, j)); if (!a) continue; for (let k = 0; k < a.length; k += 3) if (Math.hypot(a[k] - x, a[k + 1] - z) < a[k + 2] + r) return false; }
    return true;
  };
  // fast projection onto the route : nearest of the coarse samples (4 m, 64 m hash), then the exact segment around it
  const PC = 64, pg = new Map(), pk = (i, j) => i * 100003 + j;
  for (let i = 0; i < tr.n; i += 4) { const k = pk(Math.floor(tr.x[i] / PC), Math.floor(tr.z[i] / PC)); let a = pg.get(k); if (!a) pg.set(k, a = []); a.push(i); }
  const proj = (x, z, max = 200) => {
    const r = Math.ceil(max / PC), i0 = Math.floor(x / PC), j0 = Math.floor(z / PC);
    let bi = -1, bd = Infinity;
    for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) { const a = pg.get(pk(i, j)); if (!a) continue; for (const q of a) { const d = (tr.x[q] - x) ** 2 + (tr.z[q] - z) ** 2; if (d < bd) { bd = d; bi = q; } } }
    if (bi < 0) return { s: 0, d: Infinity, side: 1 };
    let best = Infinity, bs = 0, side = 1;
    for (let j = Math.max(0, bi - 6); j <= Math.min(tr.n - 2, bi + 6); j++) {
      const ax = tr.x[j], az = tr.z[j], ex = tr.x[j + 1] - ax, ez = tr.z[j + 1] - az, l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      if (d < best) { best = d; bs = tr.s[j] + t * Math.sqrt(l2); side = ex * (z - az) - ez * (x - ax) >= 0 ? 1 : -1; }
    }
    return { s: bs, d: best <= max ? best : Infinity, side };
  };
  {
    const kinds = ['warehouse', 'block', 'house'], size = { warehouse: [30, 16], block: [24, 12], house: [10, 8] }, lists = { warehouse: [], block: [], house: [] };
    for (let n = 0; n < C.buildings * 3 && placed.length < C.buildings && !land; n++) {
      const r = rnd(), kind = r < 0.3 ? 'warehouse' : r < 0.58 ? 'block' : 'house';
      const [L, D] = size[kind], k = 0.8 + rnd() * 0.45, rad = Math.hypot(L, D) * k / 2;
      const p = spot(Math.max(b0 + 10, 18) + rad * 0.5, b1, rad);
      if (!p) continue;
      if (!isFree(p.x, p.z, rad + 3)) continue;
      // the long side faces the tracks (jittered), now and then square to them
      const yaw = p.yaw + (rnd() < 0.2 ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.25;
      lists[kind].push(mat4(p.x, p.y, p.z, yaw, k, 0.85 + rnd() * 0.35, k));
      placed.push({ x: p.x, z: p.z, r: rad }); reserve(p.x, p.z, rad);
    }
    for (const kind of land ? [] : kinds) {
      const A = facadeAtlas(kind, rnd);
      const mat = new THREE.MeshStandardMaterial({ map: A.map, emissiveMap: A.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.86, metalness: kind === 'warehouse' ? 0.3 : 0.04, side: THREE.DoubleSide }); // (roof overhangs seen from below)
      add(buildingGeo(kind), mat, lists[kind], 'bld:' + kind);
    }
  }
  const offBuildings = (x, z, r) => isFree(x, z, r);

  // ---------------------------------------------------------------- trees and bushes (instance colours : a few greens, a little autumn)
  {
    const trunk = new THREE.CylinderGeometry(0.14, 0.24, 3.4, 6); trunk.translate(0, 1.5, 0);
    const crown = merge([blob(2.3, 1, rnd).translate(0, 4.5, 0), blob(1.7, 1, rnd).translate(0.5, 6.0, 0.2), blob(1.5, 1, rnd).translate(-0.8, 5.2, -0.6)]);
    const trees = [], crowns = [], cols = [];
    const col = (k) => new THREE.Color().setHSL(0.25 + (rnd() - 0.5) * 0.08 - (k ? 0.13 : 0), 0.3 + rnd() * 0.15, 0.055 + rnd() * 0.05); // (dark : the environment light lifts flat-shaded leaves a lot)
    for (let n = 0; n < (land ? 0 : C.trees); n++) {
      const p = spot(b0, b1 * 0.8, 2.5, 1.6);
      if (!p || !offBuildings(p.x, p.z, 3)) continue;
      const k = 0.75 + rnd() * 0.7, yaw = rnd() * Math.PI * 2;
      trees.push(mat4(p.x, p.y - 0.2, p.z, yaw, k, k * (0.9 + rnd() * 0.3), k)); crowns.push(trees[trees.length - 1]); cols.push(col(rnd() < 0.12));
    }
    add(trunk, bark, trees, 'trunk');
    add(crown, leaf, crowns, 'crown', cols);
    const bush = blob(1, 1, rnd, 1, 0.7), bushes = [], bcols = [];
    for (let n = 0; n < C.bushes * ((sTo - sFrom) / 1800); n++) {
      const p = spot(2, 45, 0.8, 2.2);
      if (!p || !offBuildings(p.x, p.z, 1.5)) continue;
      const k = 0.7 + rnd() * 1.1;
      bushes.push(mat4(p.x, p.y + 0.2 * k, p.z, rnd() * 6.28, k * (1 + rnd() * 0.6), k, k)); bcols.push(col(rnd() < 0.2));
    }
    add(bush, leaf, bushes, 'bush', bcols);
  }

  // ---------------------------------------------------------------- yard lamps (pole, arm toward the tracks, emissive head)
  {
    const pole = merge([new THREE.CylinderGeometry(0.07, 0.12, 7.2, 8).translate(0, 3.6, 0), new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).rotateZ(Math.PI / 2).translate(0.75, 7.05, 0), new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8).translate(0, 0.25, 0)]);
    const head = new RoundedBoxGeometry(0.62, 0.16, 0.32, 1, 0.05); head.translate(1.5, 6.98, 0);
    const list = [];
    for (let n = 0; n < C.lamps * ((sTo - sFrom) / 1800); n++) {
      const p = spot(6, 40, 1.5, 1.4);
      if (!p || !offBuildings(p.x, p.z, 1)) continue;
      list.push(mat4(p.x, p.y, p.z, p.yaw + (p.sd > 0 ? Math.PI / 2 : -Math.PI / 2))); // local +x : toward the tracks
    }
    add(pole, steel, list, 'lampPole');
    add(head, lampHeadMat, list, 'lampHead');
  }

  // ---------------------------------------------------------------- signals beside the route (mast, head, one lit lens) ; red before the wreck
  {
    const mast = merge([new THREE.CylinderGeometry(0.08, 0.1, 4.6, 8).translate(0, 2.3, 0), new RoundedBoxGeometry(0.5, 1.2, 0.2, 1, 0.06).translate(0, 4.5, 0), new THREE.CylinderGeometry(0.3, 0.36, 0.4, 8).translate(0, 0.2, 0)]);
    const lens = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10); lens.rotateX(Math.PI / 2); lens.translate(0, 4.75, -0.12);
    const masts = [], reds = [], greens = [], a = {};
    for (let s = sFrom + 60; s < sTo - 40; s += C.signalEvery) {
      at(s, a);
      for (const sd of [1, -1]) {
        const w = 3.0, x = a.x - a.tz * sd * w, z = a.z + a.tx * sd * w;
        if (nearTrack(x, z, 1.9) || !freeLand(x, z) || bridgeIn(s)) continue;
        curS = s; const m = mat4(x, groundAt(sd * w, s), z, Math.atan2(-a.tx, -a.tz) + Math.PI); // lens (local -z) faces the coming train
        masts.push(m); (wreckS != null && s > wreckS - 520 && s < wreckS - 60 ? reds : greens).push(m);
        break;
      }
    }
    add(mast, steel, masts, 'signal');
    add(lens, red, reds, 'signalRed');
    add(lens, green, greens, 'signalGreen');
  }

  // ---------------------------------------------------------------- derailed freight wagons at the slowdown (decor), sleepers torn up, flares
  if (wreckS != null && C.wreck.n > 0) {
    const W = C.wreck, rust = tex(canvas(256, 128, (x, w, h) => {
      x.fillStyle = '#5a3a2c'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 8) { x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(i, 0, 2, h); }
      for (let k = 0; k < 160; k++) { x.fillStyle = `rgba(${90 + rnd() * 50},${50 + rnd() * 30},${30},${0.15 + rnd() * 0.3})`; x.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 10, 2 + rnd() * 20); }
    }));
    const wagonMat = new THREE.MeshStandardMaterial({ map: rust, roughness: 0.82, metalness: 0.35 });
    const body = merge([new RoundedBoxGeometry(13.6, 2.7, 2.9, 2, 0.1).translate(0, 2.55, 0), new RoundedBoxGeometry(13.8, 0.25, 3.0, 1, 0.08).translate(0, 3.95, 0)]);
    const frameParts = [new RoundedBoxGeometry(13.9, 0.32, 2.4, 1, 0.05).translate(0, 1.1, 0)];
    for (const bx of [-4.6, 4.6]) {
      frameParts.push(new RoundedBoxGeometry(2.6, 0.32, 2.1, 1, 0.05).translate(bx, 0.72, 0));
      for (const ax of [-0.9, 0.9]) for (const sz of [-1, 1]) frameParts.push(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 14).rotateX(Math.PI / 2).translate(bx + ax, 0.46, sz * 0.72));
    }
    for (const bx of [-7.1, 7.1]) for (const sz of [-1, 1]) frameParts.push(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 8).rotateZ(Math.PI / 2).translate(bx, 1.1, sz * 0.85)); // buffers
    const frame = merge(frameParts);
    const bodies = [], a = {};
    curS = wreckS;
    const pose = [[0.38, 0.22], [1.42, -0.18], [0.12, 0.35]]; // [roll (rad, about the long axis), yaw offset]
    for (let i = 0; i < W.n; i++) {
      at(wreckS + (i - (W.n - 1) / 2) * 15.5, a);
      const [roll, dy] = pose[i % pose.length], w = W.side * (W.off + (i % 2) * 1.6), x = a.x - a.tz * w, z = a.z + a.tx * w;
      bodies.push(mat4(x, groundAt(w, wreckS) + 0.15 + 1.45 * Math.sin(roll) * 0.9, z, yawOf(a) + dy, 1, 1, 1, W.side * roll, 0)); // (roll about the long axis : local x)
    }
    add(body, wagonMat, bodies, 'wagon');
    add(frame, steel, bodies, 'wagonFrame');
    const sleeper = new RoundedBoxGeometry(2.6, 0.18, 0.3, 1, 0.04), sl = [];
    for (let k = 0; k < 18; k++) {
      at(wreckS + (rnd() - 0.5) * 50, a);
      const w = W.side * (2.6 + rnd() * 9), x = a.x - a.tz * w, z = a.z + a.tx * w;
      sl.push(mat4(x, groundAt(w, wreckS) + 0.08, z, rnd() * 6.28, 1, 1, 1, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.4));
    }
    add(sleeper, concrete, sl, 'debris');
    const flare = new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6); flare.rotateZ(Math.PI / 2 - 0.2); const fl = [];
    for (const k of [-1, 1]) { at(wreckS + k * 14, a); const w = W.side * 2.9; fl.push(mat4(a.x - a.tz * w, groundAt(w, wreckS) + 0.05, a.z + a.tx * w, rnd() * 6.28)); }
    add(flare, red, fl, 'flare');
  }

  // ---------------------------------------------------------------- the real landscape (rideland.json)
  let flash = null, landStats = null;
  if (land) {
    const api = {
      C, R, route, tr, rnd, land, sFrom, sTo, proj, nearTrack, freeLand, reserve, isFree, mat4, add, merge: merge1, setS: (v) => { curS = v; },
      mats: { concrete, steel, bark, leaf }, kit, V: (y, Ht) => 0.25 + 0.75 * clamp(y / Ht, 0, 1), buildingGeo,
      facade: (kind) => (facCache[kind] ||= facadeAtlas(kind, rnd)),
      crownGeometry: () => merge([blob(2.3, 1, rnd).translate(0, 4.5, 0), blob(1.7, 1, rnd).translate(0.5, 6.0, 0.2), blob(1.5, 1, rnd).translate(-0.8, 5.2, -0.6)]),
      bushGeometry: () => blob(1, 1, rnd, 1, 0.7),
    };
    buildLand(api);
    flash = api.flash; landStats = api.landStats;
  }
  flushMerged();

  // ---------------------------------------------------------------- far ground : one plane around the camera, snapped to its 8 m texture tile
  const G = C.ground, tile = 8;
  const far = new THREE.PlaneGeometry(G, G, 1, 1); far.rotateX(-Math.PI / 2);
  { const uv = far.attributes.uv, p = far.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, -p.getZ(i) / tile); }
  const farMat = groundMat.clone(); farMat.color = new THREE.Color(0x6a675f); // a little darker than the strip
  const ground = new THREE.Mesh(far, farMat); ground.name = 'ride:ground'; ground.receiveShadow = false; ground.userData.noTerrain = true; ground.frustumCulled = false;
  ground.position.y = farGroundY(route, sTo - 600);
  root.add(ground); meshes.push(ground);

  let lastX = Infinity, lastZ = Infinity;
  const _pr = {};
  return {
    root, meshes, sTo, chunks, landStats,
    counts: meshes.reduce((o, m) => { o[m.name] = (o[m.name] || 0) + (m.count ?? 1); return o; }, {}),
    // per frame : the far ground follows the camera ; chunks near the camera's stretch of the route are drawn (local look)
    update(cam) {
      if (root.parent && !root.parent.visible) return; // (the station area is not drawn : on the island)
      ground.position.x = Math.round(cam.x / tile) * tile; ground.position.z = Math.round(cam.z / tile) * tile;
      if (flash) { const on = Math.floor(performance.now() / 600) % 2 === 0; flash.a.emissiveIntensity = on ? 3.4 : 0.15; flash.b.emissiveIntensity = on ? 0.15 : 3.4; } // level-crossing lamps, alternating
      if (Math.abs(cam.x - lastX) + Math.abs(cam.z - lastZ) < 4) return;
      lastX = cam.x; lastZ = cam.z;
      const q = tr.project(cam.x, cam.z, C.chunkView, _pr), V = C.chunkView;
      if (q.d < Infinity) ground.position.y = farGroundY(route, q.s);
      for (const ch of chunks) if (ch) ch.visible = q.d < Infinity && q.s > ch.userData.s0 - V && q.s < ch.userData.s1 + V;
    },
  };
}
