import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';
import { groundProfile, farGroundY, bridgeAt } from './railNet.js';

// =====================================================================
//  The real landscape of the intro ride (v0.88.0) : public/data/rideland.json (OpenStreetMap, tools/fetch-ride.mjs) laid along the route by
//  rideScenery.js. Everything is decor (no collision) and cheap : instanced meshes (houses, churches, trees, hedges, poplars, crossing gear)
//  and merged chunks (fields, woods floor, roads, rivers, ponds, bridge decks) binned along the route ; the ground profile (embankment, bridges)
//  is railNet.groundProfile. Deterministic (seeded). The api object comes from rideScenery.js (buildRideScenery).
//    - real buildings as oriented boxes : half-timbered houses (colombage, steep tiled roofs), warehouses, blocks of flats ; churches with a
//      square bell tower and a slate spire (the real ones, and one per village that has none near the line) ;
//    - fields (ploughed, crops, meadow, allotments), woods (a floor tint and trees), orchards (rows), hedges along some field edges, poplar rows
//      along the rivers, roads (asphalt, tracks) and rivers (dark glossy ribbons) ;
//    - the level crossings of the line : a slab over the tracks, barriers down, flashing red lamps, St Andrew crosses ;
//    - the railway bridges : girders along the deck (the ground far below beyond them : railNet) and piers over the water.
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (a, b, k = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------ small geometry helpers
// flat ribbon along a path [[x, y, z]…] : width w, uv (across 0..1, along m / uvLen)
function ribbon(path, w, uvLen = 6) {
  const pos = [], uv = [], n = path.length, idx = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[2] - a[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (i) acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
    const nx = -dz * w / 2, nz = dx * w / 2;
    pos.push(path[i][0] - nx, path[i][1], path[i][2] - nz, path[i][0] + nx, path[i][1], path[i][2] + nz);
    uv.push(0, acc / uvLen, 1, acc / uvLen);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // up-facing : flip the faces whose normal points down
  const nm = g.attributes.normal; if (nm.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g.toNonIndexed();
}
// flat polygon [[x, z]…] (open ring) at height y : triangulated, up-facing, vertex colour, uv rotated by `ang` (m / uvLen)
function flatPoly(pts, y, color, ang, uvLen) {
  const tri = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
  if (!tri.length) return null;
  const pos = [], uv = [], col = [], c = Math.cos(ang), s = Math.sin(ang);
  for (const [a, b, d] of tri) {
    let A = pts[a], B = pts[b], D = pts[d];
    if ((B[1] - A[1]) * (D[0] - A[0]) - (B[0] - A[0]) * (D[1] - A[1]) < 0) [B, D] = [D, B]; // up-facing
    for (const p of [A, B, D]) { pos.push(p[0], y, p[1]); uv.push((p[0] * c + p[1] * s) / uvLen, (-p[0] * s + p[1] * c) / uvLen); col.push(color.r, color.g, color.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
const inPoly = (x, z, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function tex(c, srgb = true, rep = null) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return t; }

// ------------------------------------------------------------------ the half-timbered house : walls (uv : facade), steep gabled roof (tiles), chimney, plinth
export function houseGeometry(api) {
  const { kit, V } = api, K = kit(), L = 10, D = 8, H = 5.4, Rr = 4.2, Ht = H + Rr;
  const ROOF = [0.25, 0.12], TRIM = [0.75, 0.12];
  K.prism(rect(L, D), 0, H, (s, l, y, i) => [i % 2 ? (l ? 0.8 : 0) : (l ? 1 : 0), V(y, Ht)]);
  for (const sx of [-1, 1]) K.tri([sx * L / 2, H, -D / 2], [sx * L / 2, H, D / 2], [sx * L / 2, H + Rr, 0], [0.1, V(H, Ht)], [0.7, V(H, Ht)], [0.4, 1], [0, H / 2, 0]);
  const o = 0.5; // roof : two slopes with eaves, a tile texture (atlas region : u < 0.5, v < 0.25)
  for (const sz of [-1, 1]) K.quad([-L / 2 - o, H - 0.35, sz * (D / 2 + o)], [L / 2 + o, H - 0.35, sz * (D / 2 + o)], [L / 2 + o, H + Rr + 0.05, 0], [-L / 2 - o, H + Rr + 0.05, 0], [0.02, 0.02], [0.48, 0.02], [0.48, 0.23], [0.02, 0.23], [0, 0, 0]);
  K.prism([[2.0, -1.4], [2.9, -1.4], [2.9, -0.5], [2.0, -0.5]], H + 1.0, H + Rr + 1.0, () => TRIM, TRIM); // chimney
  K.prism(rect(L, D, 0.06), -0.4, 0.7, () => TRIM);
  void ROOF;
  return K.geometry();
}
function rect(L, D, o = 0) { return [[-L / 2 - o, -D / 2 - o], [L / 2 + o, -D / 2 - o], [L / 2 + o, D / 2 + o], [-L / 2 - o, D / 2 + o]]; }

// church : nave with a slate roof, a square bell tower at one end with a tall octagonal spire and a cross ; unit nave 20 x 10 (x along the nave), tower at -x
function churchGeometry(api) {
  const { kit } = api, K = kit(), L = 20, D = 10, H = 9, R = 5.5, tw = 6.4, TH = 24, SP = 17;
  const ROOF = [0.25, 0.12], TRIM = [0.75, 0.12], V = (y, h) => 0.25 + 0.75 * clamp(y / h, 0, 1);
  K.prism(rect(L, D), 0, H, (s, l, y, i) => [i % 2 ? (l ? 0.5 : 0) : (l ? 1 : 0), V(y, TH)]);
  for (const sx of [-1, 1]) K.tri([sx * L / 2, H, -D / 2], [sx * L / 2, H, D / 2], [sx * L / 2, H + R, 0], [0, V(H, TH)], [0.5, V(H, TH)], [0.25, 1], [0, H / 2, 0]);
  const o = 0.4;
  for (const sz of [-1, 1]) K.quad([-L / 2 - o, H - 0.2, sz * (D / 2 + o)], [L / 2 + o, H - 0.2, sz * (D / 2 + o)], [L / 2 + o, H + R, 0], [-L / 2 - o, H + R, 0], [0.02, 0.02], [0.48, 0.02], [0.48, 0.23], [0.02, 0.23], [0, 0, 0]);
  const tx = -L / 2 - tw / 2 + 0.6; // tower, a little in front of the nave
  K.prism(rect(tw, tw).map(([x, z]) => [x + tx, z]), 0, TH, (s, l, y) => [l ? 1 : 0, V(y, TH)]);
  K.prism(rect(tw, tw, 0.18).map(([x, z]) => [x + tx, z]), TH - 1.4, TH, () => TRIM, TRIM); // belfry cornice
  const eight = (r, y) => Array.from({ length: 8 }, (_, i) => [tx + Math.cos((i + 0.5) * Math.PI / 4) * r, Math.sin((i + 0.5) * Math.PI / 4) * r, y]);
  const b = eight(tw * 0.58, TH), top = [tx, TH + SP, 0];
  for (let i = 0; i < 8; i++) K.tri([b[i][0], b[i][2], b[i][1]], [b[(i + 1) % 8][0], b[(i + 1) % 8][2], b[(i + 1) % 8][1]], top.map((v, k) => (k === 1 ? v : k === 0 ? v : v)).slice(0, 1).concat([TH + SP, 0]), [0.02, 0.02], [0.48, 0.02], [0.25, 0.23], [tx, TH + SP / 2, 0]);
  K.prism([[tx - 0.06, -0.06], [tx + 0.06, -0.06], [tx + 0.06, 0.06], [tx - 0.06, 0.06]], TH + SP, TH + SP + 2.2, () => TRIM, TRIM); // cross
  K.prism([[tx - 0.5, -0.06], [tx + 0.5, -0.06], [tx + 0.5, 0.06], [tx - 0.5, 0.06]], TH + SP + 1.4, TH + SP + 1.6, () => TRIM, TRIM);
  K.prism(rect(L, D, 0.1), -0.4, 0.8, () => TRIM);
  return K.geometry();
}

// level-crossing gear (local x : lateral, right positive ; z : along the track, backward) : post with a red light head (two lamps), St Andrew cross, boom
function crossingGeos() {
  const post = new THREE.CylinderGeometry(0.06, 0.08, 2.6, 8); post.translate(0, 1.3, 0);
  const head = new RoundedBoxGeometry(0.1, 0.62, 0.62, 1, 0.03); head.translate(0, 2.35, 0);
  const base = new THREE.CylinderGeometry(0.2, 0.24, 0.3, 8); base.translate(0, 0.15, 0);
  const lamp = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12); lamp.rotateZ(Math.PI / 2);
  const lampA = lamp.clone().translate(0.07, 2.35, -0.16), lampB = lamp.clone().translate(0.07, 2.35, 0.16);
  const cross = []; for (const a of [0.62, -0.62]) { const g = new THREE.BoxGeometry(0.04, 0.12, 1.5); g.rotateX(a); g.translate(0.075, 2.95, 0); cross.push(g); }
  const boom = new THREE.BoxGeometry(0.09, 0.1, 3.5); boom.translate(0, 1.0, -1.75);
  const ni = (l) => mergeGeometries(l.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  return { post: ni([post, head, base]), lampA, lampB, cross: ni(cross), boom };
}

// ====================================================================== the builder
export function buildLand(api) {
  const { C, R, route, tr, rnd, land, sFrom, sTo, mats, proj, nearTrack, freeLand, reserve, isFree, mat4, add, merge, setS } = api;
  woods.length = 0; orchards.length = 0;
  const groundAt = (w, s) => groundProfile(w, s, route);
  const fy = (s) => farGroundY(route, s);
  const foot = R.ballast.foot / 2 + 0.4;
  const L = C.land, stats = {};
  const Lq = {}; // scratch
  void Lq;
  const rng = (a, b) => a + rnd() * (b - a);
  const inRange = (s) => s >= sFrom + 5 && s <= sTo + 40;

  // ---------------------------------------------------------------- materials
  const roadTex = tex(canvas(64, 128, (x, w, h) => { // asphalt with an edge line and a dashed centre line (v : 6 m)
    x.fillStyle = '#34353a'; x.fillRect(0, 0, w, h);
    for (let k = 0; k < 260; k++) { const g = 40 + hash(k, 1) * 30; x.fillStyle = `rgba(${g},${g},${g + 3},0.5)`; x.fillRect(hash(k, 2) * w, hash(k, 3) * h, 2, 2); }
    x.fillStyle = 'rgba(190,190,180,0.55)'; x.fillRect(2, 0, 1.5, h); x.fillRect(w - 3.5, 0, 1.5, h); x.fillRect(w / 2 - 1, 8, 2, 56);
  }), true, 1);
  const trackTex = tex(canvas(64, 64, (x, w, h) => { x.fillStyle = '#4b4434'; x.fillRect(0, 0, w, h); for (let k = 0; k < 220; k++) { const g = 60 + hash(k, 1) * 40; x.fillStyle = `rgba(${g},${g - 6},${g - 20},0.5)`; x.fillRect(hash(k, 2) * w, hash(k, 3) * h, 3, 2); } x.fillStyle = 'rgba(30,24,16,0.45)'; x.fillRect(w * 0.3, 0, 8, h); x.fillRect(w * 0.64, 0, 8, h); }), true, 1);
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const trackMat = new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0a141b, roughness: 0.06, metalness: 0.5, envMapIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const fieldTex = tex(canvas(128, 128, (x, w, h) => { // furrows and speckle (grey : tinted by the vertex colour)
    x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < h; i += 8) { x.fillStyle = 'rgba(0,0,0,0.20)'; x.fillRect(0, i, w, 2); x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(0, i + 4, w, 1); }
    for (let k = 0; k < 500; k++) { const g = hash(k, 5) * 70; x.fillStyle = `rgba(${g},${g},${g},0.25)`; x.fillRect(hash(k, 6) * w, hash(k, 7) * h, 2 + hash(k, 8) * 3, 1 + hash(k, 9) * 2); }
  }), true, 1);
  const fieldMat = new THREE.MeshStandardMaterial({ map: fieldTex, vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const stripeTex = tex(canvas(64, 16, (x) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#c9c6bb' : '#a02a22'; x.fillRect(i * 8, 0, 8, 16); } }), true, 1);
  const boomMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6, metalness: 0.1 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xb9b8b0, roughness: 0.6, metalness: 0.1 });
  const redOn = (i) => new THREE.MeshStandardMaterial({ color: 0x300806, emissive: 0xff2412, emissiveIntensity: i, roughness: 0.3 });
  const lampMatA = redOn(3.4), lampMatB = redOn(0.15);
  const poplarCrown = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true });
  const girderMat = new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.55, metalness: 0.6 });
  const stoneMat = mats.concrete;

  // ---------------------------------------------------------------- houses, warehouses, blocks, churches (real footprints)
  const lists = { h: [], w: [], a: [] }, hcol = { h: [], w: [], a: [] };
  const churchList = [];
  const tints = [[0.1, 0.12, 0.92], [0.09, 0.2, 0.86], [0.12, 0.1, 0.96], [0.08, 0.25, 0.8], [0.14, 0.15, 0.9], [0.06, 0.3, 0.78], [0.55, 0.05, 0.9]];
  const bsz = { h: [10, 8], w: [30, 16], a: [24, 12] };
  let nB = 0;
  for (const b of land.buildings || []) {
    const [cx, cz, bl, bd, yaw, kind, lv] = b;
    const q = proj(cx, cz, 175); if (q.d === Infinity || !inRange(q.s) || q.d < 9 || !freeLand(cx, cz)) continue;
    const [uL, uD] = bsz[kind] || bsz.h;
    let sx = bl / uL, sz = bd / uD, sy;
    if (kind === 'h') { sy = clamp(((lv || 2) + 0.4) / 2.4, 0.7, 1.6); sx = clamp(sx, 0.5, 4); sz = clamp(sz, 0.5, 2.2); sy = Math.min(sy, sz * 1.15 + 0.3); }
    else if (kind === 'w') { sy = 0.8 + hash(cx, cz) * 0.4; sx = clamp(sx, 0.5, 4); sz = clamp(sz, 0.5, 4); }
    else { sy = clamp(((lv || 4) * 3.1) / 14, 0.5, 1.6); sx = clamp(sx, 0.6, 3); sz = clamp(sz, 0.6, 3); }
    setS(q.s);
    lists[kind === 'a' ? 'a' : kind === 'w' ? 'w' : 'h'].push(mat4(cx, groundAt(q.d * q.side, q.s), cz, -yaw, sx, sy, sz));
    const t = tints[Math.floor(hash(cx, cz, 3) * tints.length)]; hcol[kind === 'a' ? 'a' : kind === 'w' ? 'w' : 'h'].push(new THREE.Color().setHSL(t[0], t[1], t[2] * (kind === 'h' ? 1 : 0.9)));
    reserve(cx, cz, Math.hypot(bl, bd) * 0.5 + 1.5);
    nB++;
  }
  stats.buildings = nB;
  for (const c of land.churches || []) {
    const [cx, cz, cl, cd, yaw] = c, q = proj(cx, cz, 260);
    if (q.d === Infinity || !inRange(q.s) || q.d < 12 || !freeLand(cx, cz)) continue;
    setS(q.s);
    const k = clamp(cl / 20, 0.8, 1.8);
    churchList.push(mat4(cx, groundAt(q.d * q.side, q.s), cz, -yaw, k, k * 0.95, clamp(cd / 10, 0.8, 1.8) * 0.95));
    reserve(cx, cz, cl * 0.6 + 8);
  }
  // a church in each village that has none near the line : houses counted per 300 m of route (a village : many houses, 25-90 m from the route)
  {
    const bins = new Map();
    for (const b of land.buildings || []) { if (b[5] !== 'h') continue; const q = proj(b[0], b[1], 175); if (q.d === Infinity || !inRange(q.s)) continue; const k = Math.floor(q.s / 300); const e = bins.get(k) || { n: 0, s: 0 }; e.n++; e.s += q.s; bins.set(k, e); }
    for (const [k, e] of bins) {
      if (e.n < 50) continue;
      const s0 = e.s / e.n;
      if ((land.churches || []).some((c) => { const q = proj(c[0], c[1], 400); return q.d !== Infinity && Math.abs(q.s - s0) < 420 && q.d < 200; })) continue;
      if (churchList.some((m) => Math.abs(m.s - s0) < 420)) continue;
      for (let t = 0; t < 40; t++) {
        const sd = rnd() < 0.5 ? -1 : 1, s = s0 + rng(-80, 80), w = sd * rng(30, 90), o = {}; tr.at(s, o);
        const x = o.x - o.tz * w, z = o.z + o.tx * w;
        if (!isFree(x, z, 14) || nearTrack(x, z, 10) || !freeLand(x, z)) continue;
        setS(s); churchList.push(mat4(x, groundAt(w, s), z, Math.atan2(-o.tx, -o.tz) + Math.PI / 2 * (rnd() < 0.5 ? 0 : 1) + (rnd() - 0.5) * 0.3, 1, 1, 1)); reserve(x, z, 14); break;
      }
    }
  }
  stats.churches = churchList.length;
  for (const kind of ['h', 'w', 'a']) {
    if (!lists[kind].length) continue;
    const atlas = api.facade(kind === 'h' ? 'house' : kind === 'w' ? 'warehouse' : 'block');
    const mat = new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.86, metalness: kind === 'w' ? 0.3 : 0.04, side: THREE.DoubleSide });
    add(kind === 'h' ? houseGeometry(api) : api.buildingGeo(kind === 'w' ? 'warehouse' : 'block'), mat, lists[kind], 'bld:' + kind, hcol[kind]);
  }
  if (churchList.length) {
    const atlas = api.facade('church');
    add(churchGeometry(api), new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.85, metalness: 0.04, side: THREE.DoubleSide }), churchList, 'church');
  }

  // ---------------------------------------------------------------- crossings (gear, slab) : the real level crossings of the line
  const crossings = [];
  {
    const G = crossingGeos(), posts = [], cr = [], booms = [], lA = [], lB = [], o = {};
    for (const c of land.crossings || []) {
      const q = proj(c[0], c[1], 14);
      if (q.d > 6 || !inRange(q.s) || crossings.some((k) => Math.abs(k.s - q.s) < 18)) continue;
      tr.at(q.s, o);
      const ext = [0, 0];
      for (const [i, sd] of [-1, 1].entries()) { let gap = 0; for (let w = 2.5; w <= 22 && gap < 7; w += 0.5) { if (nearTrack(o.x - o.tz * sd * w, o.z + o.tx * sd * w, 1.0)) { ext[i] = w; gap = 0; } else gap += 0.5; } }
      const wl = ext[0] + 1.9, wr = ext[1] + 1.9, yaw = Math.atan2(-o.tx, -o.tz), bed = CONFIG.gare.railY;
      crossings.push({ s: q.s, wl, wr });
      setS(q.s);
      // slab : a profile across the tracks (ramps down to the ground), extruded along the track
      const top = bed + 0.17, gy = groundAt(foot + 1, q.s), sh = new THREE.Shape();
      sh.moveTo(-wl - 2.2, gy - 0.02); sh.lineTo(-wl, top); sh.lineTo(wr, top); sh.lineTo(wr + 2.2, gy - 0.02); sh.lineTo(wr + 2.2, gy - 0.4); sh.lineTo(-wl - 2.2, gy - 0.4);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 5.6, bevelEnabled: false }); g.translate(0, 0, -2.8);
      g.rotateY(yaw); g.translate(o.x, 0, o.z);
      merge(g, roadMat, q.s, 'crossing');
      for (const sd of [-1, 1]) for (const along of [-1, 1]) {
        const w = sd > 0 ? wr + 2.7 : -wl - 2.7, px = o.x - o.tz * w + o.tx * -along * 3.4 * 0, pz = o.z + o.tx * w;
        // (the along-track offset : local z is backward = -t ; post at along * 3.4 m)
        const X = o.x - o.tz * w - o.tx * along * 3.4, Z = o.z + o.tx * w - o.tz * along * 3.4;
        void px; void pz;
        const m = mat4(X, groundAt(w, q.s) - 0.15, Z, yaw + (sd > 0 ? 0 : Math.PI));
        posts.push(m); cr.push(m); lA.push(m); lB.push(m);
        booms.push(mat4(X, groundAt(w, q.s) - 0.15, Z, yaw + (sd > 0 ? 0 : Math.PI) + (along > 0 ? 0 : Math.PI)));
      }
    }
    add(G.post, whiteMat, posts, 'xpost'); add(G.cross, whiteMat, cr, 'xcross'); add(G.boom, boomMat, booms, 'xboom'); add(G.lampA, lampMatA, lA, 'xlampA'); add(G.lampB, lampMatB, lB, 'xlampB');
    api.flash = { a: lampMatA, b: lampMatB, any: crossings.length > 0 };
  }
  stats.crossings = crossings.length;
  route.crossingS = crossings.map((k) => k.s).sort((a, b) => a - b); // abscissas of the level crossings (intro.js : the bell sounds as the train passes)

  // ---------------------------------------------------------------- bridges : girders along the deck, piers over the water
  {
    const girders = [], parapets = [], piers = [], o = {}, o2 = {};
    const bedTop = CONFIG.gare.railY;
    for (const b of route.bridges || []) {
      if (b.s1 < sFrom || b.s0 > sTo + 40) continue;
      const step = 6, n = Math.max(1, Math.ceil((b.s1 - b.s0) / step)), len = (b.s1 - b.s0) / n, gy = bedTop - R.ballast.h - 0.02;
      for (let i = 0; i < n; i++) {
        const s = b.s0 + (i + 0.5) * len; tr.at(s, o); setS(s);
        const yaw = Math.atan2(-o.tx, -o.tz);
        for (const sd of [-1, 1]) {
          const w = sd * (sd > 0 ? b.wr : b.wl) + (sd > 0 ? -0.07 : 0.07), x = o.x - o.tz * w, z = o.z + o.tx * w, lowY = groundAt(sd * (sd > 0 ? b.wr : b.wl) + sd * 0.5, s);
          const hgt = bedTop + R.embank.girder - lowY;
          girders.push(mat4(x, lowY + hgt / 2, z, yaw + Math.PI / 2, len + 0.06, hgt, 1)); // unit box : length along local x after the yaw, thickness 0.14 across
          parapets.push(mat4(x, bedTop + R.embank.girder + 0.04, z, yaw + Math.PI / 2, len + 0.06, 1, 1));
        }
        if (b.over === 'water' && i % 2 === 0) for (const sd of [-1, 1]) { const w = sd * ((sd > 0 ? b.wr : b.wl) - 0.9); tr.at(s, o2); piers.push(mat4(o2.x - o2.tz * w, groundAt(sd * (b.wr + 1), s), o2.z + o2.tx * w, yaw)); }
      }
    }
    const box = new RoundedBoxGeometry(1, 1, 0.14, 1, 0.02), rail = new THREE.BoxGeometry(1, 0.09, 0.2);
    add(box, girderMat, girders, 'girder'); add(rail, mats.steel, parapets, 'parapet');
    if (piers.length) { const g = new THREE.CylinderGeometry(0.55, 0.7, 6.5, 10); g.translate(0, 3.25 - 1.2, 0); add(g, stoneMat, piers, 'pier'); }
    stats.bridges = (route.bridges || []).length;
  }

  // ---------------------------------------------------------------- roads : asphalt ribbons (tracks : dirt), over the embankment slope near the line, cut where they would run on the deck
  {
    const wRoad = [2.6, 5.0, 6.0, 8.0], lenPiece = 60;
    const cross = crossings.map((c) => c.s);
    let n = 0;
    for (const r of land.roads || []) {
      let piece = [], pieceLen = 0, ps = 0;
      const flush = () => { if (piece.length > 1) { const g = ribbon(piece, wRoad[r.k] || 5, 6); merge(g, r.k === 0 ? trackMat : roadMat, ps / piece.length, 'road'); n++; } piece = []; pieceLen = 0; ps = 0; };
      for (let i = 0; i < r.p.length; i++) {
        const [x, z] = r.p[i], q = proj(x, z, 190), w = q.d * q.side;
        if (q.d === Infinity || !inRange(q.s)) { flush(); continue; }
        const br = bridgeAt(route, q.s), onBed = q.d < foot + 1.2, nearCross = cross.some((c) => Math.abs(c - q.s) < 14);
        if ((br && Math.abs(w) < (w < 0 ? br.wl : br.wr) + 1.5) || (onBed && !nearCross) || !freeLand(x, z)) { flush(); continue; } // (under a bridge, on the bed, in the station)
        const y = groundAt(w, q.s) + 0.06;
        if (piece.length) pieceLen += Math.hypot(x - piece[piece.length - 1][0], z - piece[piece.length - 1][2]);
        piece.push([x, y, z]); ps += q.s;
        if (pieceLen > lenPiece) { const last = piece[piece.length - 1], lastS = q.s; flush(); piece = [last]; ps = lastS; }
      }
      flush();
    }
    stats.roads = n;
  }

  // ---------------------------------------------------------------- rivers and ponds : dark glossy ribbons and polygons, flat on the far ground
  {
    const wStream = [0, 1.8, 6, 14]; let n = 0;
    for (const r of land.streams || []) {
      let piece = [], ps = 0;
      const flush = () => { if (piece.length > 1) { merge(ribbon(piece, wStream[r.k] || 3, 8), waterMat, ps / piece.length, 'water'); n++; } piece = []; ps = 0; };
      for (const [x, z] of r.p) {
        const q = proj(x, z, 220); if (q.d === Infinity || !inRange(q.s)) { flush(); continue; }
        const br = bridgeAt(route, q.s);
        piece.push([x, fy(q.s) + 0.05 + (br ? 0 : 0), z]); ps += q.s;
      }
      flush();
    }
    for (const w of land.water || []) {
      const ring = w.p.slice(0, -1); let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; } cx /= ring.length; cz /= ring.length;
      const q = proj(cx, cz, 240); if (q.d === Infinity || !inRange(q.s)) continue;
      const g = flatPoly(ring, fy(q.s) + 0.05, new THREE.Color(1, 1, 1), 0, 8); if (g) { g.deleteAttribute('color'); merge(g, waterMat, q.s, 'pond'); n++; }
    }
    stats.water = n;
  }

  // ---------------------------------------------------------------- fields (ground tint, furrows) and woods (a floor tint) : flat patches under everything
  const fieldCol = { f: [0x4a3d2c, 0x34402a, 0x514a34, 0x3a3a26], g: [0x2c3d24, 0x33422a], o: [0x2f3f26], a: [0x3a4026, 0x453a2a] }, woodCol = [0x1b2518, 0x202a1a];
  const edges = []; // field edges for hedges : [x0, z0, x1, z1, s]
  {
    let n = 0;
    for (const f of land.fields || []) {
      const ring = f.p.slice(0, -1); if (ring.length < 3) continue;
      let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; } cx /= ring.length; cz /= ring.length;
      const q = proj(cx, cz, 300); if (q.d === Infinity || !inRange(q.s) || !freeLand(cx, cz)) continue;
      // longest edge sets the furrow direction
      let best = 0, ang = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
      const cols = fieldCol[f.k] || fieldCol.g, col = new THREE.Color(cols[Math.floor(hash(cx, cz, 9) * cols.length)]);
      const g = flatPoly(ring, fy(q.s) + 0.045, col, ang, 7);
      if (g) { merge(g, fieldMat, q.s, 'field'); n++; }
      if (f.k !== 'o' && best > 12) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (hash(a[0], a[1], 4) < 0.42 && Math.hypot(b[0] - a[0], b[1] - a[1]) > 14) edges.push([a[0], a[1], b[0], b[1], q.s]); }
      if (f.k === 'o') orchards.push({ ring, q });
    }
    for (const f of land.woods || []) {
      const ring = f.p.slice(0, -1); if (ring.length < 3) continue;
      let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; } cx /= ring.length; cz /= ring.length;
      const q = proj(cx, cz, 300); if (q.d === Infinity || !inRange(q.s) || !freeLand(cx, cz)) continue;
      const g = flatPoly(ring, fy(q.s) + 0.05, new THREE.Color(woodCol[Math.floor(hash(cx, cz, 7) * woodCol.length)]), 0.4, 5);
      if (g) { merge(g, fieldMat, q.s, 'wood'); n++; }
      woods.push({ ring, q, scrub: f.k === 's' });
    }
    stats.patches = n;
  }

  // ---------------------------------------------------------------- trees : woods (jittered grid inside the polygon), orchards (rows), poplar rows along the rivers
  {
    const trunk = new THREE.CylinderGeometry(0.14, 0.24, 3.4, 6); trunk.translate(0, 1.5, 0);
    const crown = api.crownGeometry();
    const trees = [], crowns = [], cols = [];
    const col = (k) => new THREE.Color().setHSL(0.25 + (rnd() - 0.5) * 0.08 - (k ? 0.13 : 0), 0.3 + rnd() * 0.15, 0.055 + rnd() * 0.05);
    let total = 0;
    const tree = (x, z, s, d, w, k = 0.75 + rnd() * 0.7) => {
      setS(s);
      const y = (d < R.corridor ? groundAt(w, s) : fy(s)) - 0.2;
      trees.push(mat4(x, y, z, rnd() * 6.28, k, k * (0.9 + rnd() * 0.3), k)); crowns.push(trees[trees.length - 1]); cols.push(col(rnd() < 0.12)); total++;
    };
    const ok = (x, z, r) => freeLand(x, z) && !nearTrack(x, z, C.clear + 2.5) && isFree(x, z, r);
    for (const wd of woods) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of wd.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const sp = wd.scrub ? 9 : L.woodSpacing; let n = 0;
      for (let x = x0; x <= x1 && total < L.treesMax; x += sp) for (let z = z0; z <= z1 && n < 700; z += sp) {
        const px = x + rng(-sp / 2, sp / 2), pz = z + rng(-sp / 2, sp / 2);
        if (!inPoly(px, pz, wd.ring)) continue;
        const q = proj(px, pz, L.band); if (q.d === Infinity || q.d < foot + 5 || !inRange(q.s) || !ok(px, pz, 2)) continue;
        tree(px, pz, q.s, q.d, q.d * q.side); n++;
      }
    }
    for (const o of orchards) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of o.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let x = x0; x <= x1 && total < L.treesMax; x += 8) for (let z = z0; z <= z1; z += 6.5) {
        if (!inPoly(x, z, o.ring)) continue;
        const q = proj(x, z, L.band); if (q.d === Infinity || q.d < foot + 5 || !inRange(q.s) || !ok(x, z, 2)) continue;
        tree(x, z, q.s, q.d, q.d * q.side, 0.55 + rnd() * 0.25);
      }
    }
    // verge and garden trees : a few along the line itself and between the houses (random, near the route)
    for (let n = 0; n < C.treesPerKm * ((sTo - sFrom) / 1000) && total < L.treesMax; n++) {
      const s = sFrom + rnd() * (sTo - sFrom), sd = rnd() < 0.5 ? -1 : 1, w = sd * (foot + rng(3, 40) * Math.pow(rnd(), 1.5)), o = {};
      tr.at(s, o); const x = o.x - o.tz * w, z = o.z + o.tx * w;
      if (!ok(x, z, 2) || bridgeAt(route, s)) continue;
      tree(x, z, s, Math.abs(w), w);
    }
    add(trunk, mats.bark, trees, 'trunk'); add(crown, mats.leaf, crowns, 'crown', cols);
    stats.trees = total;

    // poplar rows along the rivers (tall, narrow, light foliage)
    const ptrunk = new THREE.CylinderGeometry(0.1, 0.2, 4.2, 6); ptrunk.translate(0, 1.9, 0);
    const pcrown = new THREE.IcosahedronGeometry(1, 1); pcrown.scale(1.25, 6.2, 1.25); pcrown.translate(0, 8.4, 0);
    const pl = [], pc = [], pcol = [];
    for (const r of land.streams || []) {
      if (r.k < 2 || hash(r.p[0][0], r.p[0][1], 5) < 0.2) continue;
      for (const sd of [-1, 1]) {
        let carry = 0;
        for (let i = 1; i < r.p.length; i++) {
          const [ax, az] = r.p[i - 1], [bx, bz] = r.p[i], d = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / d, tz = (bz - az) / d;
          for (let u = carry; u < d; u += 7.5) {
            const off = (r.k === 3 ? 10 : 6) + rng(-0.5, 0.5), x = ax + tx * u - tz * sd * off, z = az + tz * u + tx * sd * off;
            if (hash(x, z, 6) < 0.25) continue;
            const q = proj(x, z, L.band); if (q.d === Infinity || !inRange(q.s) || q.d < foot + 6 || !ok(x, z, 1.5)) continue;
            setS(q.s); const k = 0.8 + rnd() * 0.5;
            pl.push(mat4(x, fy(q.s) - 0.2, z, rnd() * 6.28, k, k * (0.9 + rnd() * 0.4), k)); pc.push(pl[pl.length - 1]);
            pcol.push(new THREE.Color().setHSL(0.2 + (rnd() - 0.5) * 0.06, 0.4, 0.08 + rnd() * 0.05));
          }
          carry = ((carry - d) % 7.5 + 7.5) % 7.5;
        }
      }
    }
    add(ptrunk, mats.bark, pl, 'poplarTrunk'); add(pcrown, poplarCrown, pc, 'poplar', pcol);
    stats.poplars = pl.length;

    // hedges : bushes along some field edges
    const bush = api.bushGeometry(), hb = [], hcols = [];
    for (const [x0, z0, x1, z1, s0] of edges) {
      const d = Math.hypot(x1 - x0, z1 - z0), tx = (x1 - x0) / d, tz = (z1 - z0) / d;
      if (hb.length > L.hedgesMax) break;
      for (let u = 1; u < d - 1; u += 2.3) {
        const x = x0 + tx * u, z = z0 + tz * u, q = proj(x, z, L.band);
        if (q.d === Infinity || !inRange(q.s) || q.d < foot + 4 || !ok(x, z, 0.6)) continue;
        setS(q.s); const k = 0.8 + rnd() * 0.8;
        hb.push(mat4(x + rng(-0.3, 0.3), fy(q.s) + 0.15 * k, z + rng(-0.3, 0.3), rnd() * 6.28, k * (1 + rnd() * 0.6), k, k * 1.1)); hcols.push(col(rnd() < 0.2));
      }
      void s0;
    }
    add(bush, mats.leaf, hb, 'hedge', hcols);
    stats.hedges = hb.length;
  }
  api.landStats = stats;
}
const woods = [], orchards = [];
