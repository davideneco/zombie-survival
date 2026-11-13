import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Flat map layers of a world tile: OSM roads (asphalt), pavements, crossings, parks, water (tools/tiles.mjs writes them into the tile files).
//  Pure geometry from the tile data (`buildSurfaces`) + two shared materials. A tile owns TWO meshes: `surf` (asphalt, pavement, grass, quay coping,
//  centre lines, zebras: vertex colours x one grain texture, one program) and `water` (the island water material, so no new program). Everything is
//  merged: no mesh per road. The layers sit a few mm apart (CONFIG.world.surf.y) so they never fight; roads draw over parks, bridges over water.
//  Visual only: walking on them needs nothing (the ground is flat and open), the district's collision comes from the footprints (district/index.js).
// =====================================================================

const lin = {};
const rgbOf = (hex) => lin[hex] || (lin[hex] = (() => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; })()); // linear RGB (vertex colours are not converted by three)

let surfMat = null;
function grainTexture() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'), img = x.createImageData(N, N);
  let seed = 4242; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N * N; i++) { const v = 188 + R() * 56 | 0; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  for (let k = 0; k < 90; k++) { x.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.08})`; x.beginPath(); x.ellipse(R() * N, R() * N, 1 + R() * 4, 1 + R() * 3, R() * 3, 0, 7); x.fill(); } // patches
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 0.8; // hairline cracks / joints (wrap-safe: drawn twice, shifted by N)
  for (let k = 0; k < 6; k++) { let px = R() * N, py = R() * N; for (const [ox, oy] of [[0, 0], [N, 0], [0, N], [-N, 0], [0, -N]]) { x.beginPath(); x.moveTo(px + ox, py + oy); let qx = px, qy = py; for (let s = 0; s < 4; s++) { qx += (R() - 0.5) * 26; qy += (R() - 0.5) * 26; x.lineTo(qx + ox, qy + oy); } x.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
export function surfaceMaterial() {
  const S = CONFIG.world.surf;
  return surfMat || (surfMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grainTexture(), roughness: S.rough, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
}

const orient = (p, a, b, c) => (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]); // y of (b - a) x (c - a)

// Accumulator of one merged mesh: vertices (position, linear colour, planar uv) and triangles always wound to face up.
function accumulator(uvScale) {
  const pos = [], col = [], uv = [], idx = [];
  return {
    pos, idx,
    v(x, y, z, c, k = 1) { pos.push(x, y, z); col.push(c[0] * k, c[1] * k, c[2] * k); uv.push(x / uvScale, z / uvScale); return pos.length / 3 - 1; },
    tri(a, b, c) { if (orient(pos, a, b, c) > 0) idx.push(a, b, c); else idx.push(a, c, b); },
    geometry(withUv = true) {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry(), n = pos.length / 3, nor = new Float32Array(n * 3);
      for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      return g;
    },
  };
}

// slow world-space brightness variation (wear patches): smooth, so two overlapping coplanar strips differ by < 2 %
const wear = (x, z, j) => 1 + j * (Math.sin(x * 0.071 + 1.3) * Math.sin(z * 0.059 + 0.4) * 0.7 + Math.sin((x + z) * 0.19 + 2) * 0.3);

// a polyline of half-width hw as a mitred strip, split every `sub` m; skipped where `skip(x, z)` is true (the island core)
function strip(A, pts, hw, y, rgb, S, skip) {
  const p = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const a = p[p.length - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d < 0.05) continue; const m = Math.ceil(d / S.subdiv); for (let k = 1; k <= m; k++) p.push([a[0] + ((b[0] - a[0]) * k) / m, a[1] + ((b[1] - a[1]) * k) / m]); }
  const n = p.length; if (n < 2) return;
  const nrm = []; for (let i = 0; i + 1 < n; i++) { const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], l = Math.hypot(dx, dz) || 1; nrm.push([dz / l, -dx / l]); }
  const L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const a = nrm[Math.max(0, i - 1)], b = nrm[Math.min(n - 2, i)]; let bx = a[0] + b[0], bz = a[1] + b[1]; const bl = Math.hypot(bx, bz);
    if (bl < 1e-4) { bx = b[0]; bz = b[1]; } else { bx /= bl; bz /= bl; }
    const c = Math.max(0.5, bx * b[0] + bz * b[1]), ox = (bx / c) * hw, oz = (bz / c) * hw, k = wear(p[i][0], p[i][1], S.jitter);
    L.push(A.v(p[i][0] + ox, y, p[i][1] + oz, rgb, k)); Rr.push(A.v(p[i][0] - ox, y, p[i][1] - oz, rgb, k));
  }
  for (let i = 0; i + 1 < n; i++) {
    if (skip && skip((p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2)) continue;
    A.tri(L[i], Rr[i], L[i + 1]); A.tri(Rr[i], Rr[i + 1], L[i + 1]);
  }
}

// a flat polygon (earcut through ShapeUtils); null-safe on degenerate rings
function polygon(A, pts, y, rgb, k = 1) {
  let ring = pts; if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
  if (ring.length < 3) return;
  let tris; try { tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []); } catch { return; }
  const ids = ring.map(([x, z]) => A.v(x, y, z, rgb, k));
  for (const [a, b, c] of tris) A.tri(ids[a], ids[b], ids[c]);
}
const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; s += ax * bz - bx * az; } return s / 2; };

// D: tile data { roads, water, rivers, parks }; returns { surf, water } geometries (null when empty). `dedupe`: ids already drawn by an earlier call are skipped.
// buildSurfaces runs the generator to the end; the tile streamer drives buildSurfacesSteps itself (it yields every STEP features so that no step of a tile build is long).
export function buildSurfaces(D, dedupe = null) { const g = buildSurfacesSteps(D, dedupe); let r; while (!(r = g.next()).done); return r.value; }
const STEP = 8;
export function* buildSurfacesSteps(D, dedupe = null) {
  const W = CONFIG.world, S = W.surf, C = S.colors, Y = S.y, core = W.core;
  const inCore = (x, z) => x > core.x0 && x < core.x1 && z > core.z0 && z < core.z1;
  const centroidIn = (pts) => { let x = 0, z = 0; for (const q of pts) { x += q[0]; z += q[1]; } return inCore(x / pts.length, z / pts.length); };
  const fresh = (o) => { if (!dedupe) return true; if (dedupe.has(o.id)) return false; dedupe.add(o.id); return true; };
  const A = accumulator(S.uvScale), WT = accumulator(1), asphalt = rgbOf(C.asphalt), pave = rgbOf(C.pave), grass = rgbOf(C.grass), quay = rgbOf(C.quay), mark = rgbOf(C.mark);
  const roads = (D.roads || []).filter(fresh);

  let n = 0;
  for (const o of D.parks || []) { if (fresh(o) && !centroidIn(o.pts)) polygon(A, o.pts, Y.park, grass, 1); if (++n % STEP === 0) yield; }
  yield;

  // junction vertices of the asphalt roads and crossings (the centre line stops short of them)
  const isPave = (r) => S.paved.includes(r.hw), asph = roads.filter((r) => !isPave(r) && r.hw !== 'crossing' && !r.area);
  const nodes = new Map(), CELL = 8, key = (i, j) => i * 100003 + j;
  const addNode = (x, z, r) => { const k = key(Math.floor(x / CELL), Math.floor(z / CELL)); let l = nodes.get(k); if (!l) nodes.set(k, l = []); l.push([x, z, r]); };
  for (const r of roads) if (!isPave(r) && !r.area) for (const [x, z] of r.pts) addNode(x, z, r);
  const nearOther = (x, z, r, d) => { for (let i = Math.floor((x - d) / CELL); i <= Math.floor((x + d) / CELL); i++) for (let j = Math.floor((z - d) / CELL); j <= Math.floor((z + d) / CELL); j++) { const l = nodes.get(key(i, j)); if (l) for (const q of l) if (q[2] !== r && Math.hypot(q[0] - x, q[1] - z) < d) return true; } return false; };
  const skipCore = (x, z) => inCore(x, z);

  // pass 1: the carriageways (a bridge deck is its own, higher layer), pass 2: pavements on top of them
  for (const r of asph) {
    const hw = (r.w || S.width[r.hw] || S.width.other) / 2;
    strip(A, r.pts, hw, r.bridge ? Y.bridge : Y.asphalt, asphalt, S, skipCore);
    if (++n % STEP === 0) yield;
  }
  for (const r of roads) {
    if (++n % STEP === 0) yield;
    if (r.area) { if (!centroidIn(r.pts)) polygon(A, r.pts, Y.pave, pave, 1); continue; }
    if (!isPave(r)) continue;
    strip(A, r.pts, (r.w || S.width[r.hw] || S.width.other) / 2, r.bridge ? Y.bridge + 0.004 : Y.pave, pave, S, skipCore);
  }
  // centre lines of the wide roads (dashes), none near a junction
  const D_ = S.dash;
  for (const r of asph) {
    if (++n % STEP === 0) yield;
    const w = r.w || S.width[r.hw] || S.width.other; if (w < D_.minWidth || r.bridge) continue;
    let s = 0, next = D_.gap * 0.5;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < 0.1) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      while (next < s + len) {
        const t = next - s, cx = ax + dx * t, cz = az + dz * t, ex = ax + dx * Math.min(len, t + D_.len), ez = az + dz * Math.min(len, t + D_.len);
        next += D_.len + D_.gap;
        if (inCore(cx, cz) || nearOther(cx, cz, r, D_.clear + w / 2)) continue;
        const nx = dz * D_.w / 2, nz = -dx * D_.w / 2, k = wear(cx, cz, S.jitter);
        const a = A.v(cx + nx, Y.mark, cz + nz, mark, k), b = A.v(cx - nx, Y.mark, cz - nz, mark, k), c = A.v(ex - nx, Y.mark, ez - nz, mark, k), d = A.v(ex + nx, Y.mark, ez + nz, mark, k);
        A.tri(a, b, c); A.tri(a, c, d);
      }
      s += len;
    }
  }
  // zebras: stripes parallel to the traffic, stacked along the walking line
  const Z = S.zebra;
  for (const r of roads) {
    if (++n % (STEP * 4) === 0) yield; // (a crossing is a handful of quads)
    if (r.hw !== 'crossing' || r.um) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < 2.5 || inCore(ax, az)) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, px = -dz, pz = dx; // (px, pz): along the road
      for (let t = Z.w; t <= len - Z.w; t += Z.step) {
        const cx = ax + dx * t, cz = az + dz * t, hx = dx * Z.w / 2, hz = dz * Z.w / 2, lx = px * Z.len / 2, lz = pz * Z.len / 2;
        const a = A.v(cx - hx - lx, Y.mark, cz - hz - lz, mark), b = A.v(cx + hx - lx, Y.mark, cz + hz - lz, mark), c = A.v(cx + hx + lx, Y.mark, cz + hz + lz, mark), d = A.v(cx - hx + lx, Y.mark, cz - hz + lz, mark);
        A.tri(a, b, c); A.tri(a, c, d);
      }
    }
  }
  // water: polygons, waterway lines the polygons do not cover; a stone coping runs around every polygon (the quay)
  for (const o of D.water || []) {
    yield;
    if (!fresh(o) || centroidIn(o.pts)) continue;
    polygon(WT, o.pts, Y.water, [1, 1, 1], 1);
    const ring = area2(o.pts) > 0 ? o.pts : o.pts.slice().reverse(); // counter-clockwise in (x, z): the outside is at (dz, -dx) x sign
    const closed = ring.concat([ring[0]]), off = S.quayW / 2;
    const outer = closed.map(([x, z], i) => { const a = closed[Math.max(0, i - 1)], b = closed[Math.min(closed.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [x + (dz / l) * off, z - (dx / l) * off]; });
    strip(A, outer, off, Y.quay, quay, { ...S, subdiv: 10 });
  }
  for (const o of D.rivers || []) { if (fresh(o)) strip(WT, o.pts, (S.river[o.ww] || 10) / 2, Y.water, [1, 1, 1], { ...S, jitter: 0 }, skipCore); if (++n % STEP === 0) yield; }
  yield;
  const surf = A.geometry();
  yield;
  return { surf, water: WT.geometry(true) };
}
