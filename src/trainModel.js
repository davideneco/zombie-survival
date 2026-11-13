import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Regional train (v0.80.0, reworked v0.88.0) : geometry and materials, no game state. An electric multiple unit of the Régiolis type
//  (articulated low-floor regional EMU : four cars sharing their bogies at the joints, rounded nose with a large raked windscreen, locked cab
//  behind a bulkhead, wide plug doors on the low floor, raised floor over the bogies reached by two steps, 2+2 seats in bays, luggage racks,
//  glass vestibule partitions, open gangways, LED strips) in a NEUTRAL livery : off-white, slate skirt, ochre stripe, no logo, no brand.
//  Two car bodies are built (the middle car, the end car whose nose points to +u ; the tail car is the end car turned by 180 degrees), plus
//  bogies, lamps, cab and pantographs as their own small meshes : train.js draws them as InstancedMeshes (about 20 draw calls).
//  Vehicle-local axes : X = w (right of the direction of travel), Y = height above the rail head, Z = -u (u : forward along the vehicle).
//  carLayouts() is pure (no Three.js) : the walkable interior used both by the meshes and by the collision boxes of train.js.
// =====================================================================

const TAU = Math.PI * 2;
const hash = (a, b, k = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ interior layout (car-local u, w ; heights above the rail head)
// One layout per car kind, in the frame of the car (nose toward +u for the end car). The tail car is the end car turned by 180 degrees :
// u and w change sign. zone : raised floor [lo, hi, end] = the ramp (steps) from lo to hi, then high floor up to `end`.
function mirrorLayout(Q) {
  const m = (v) => -v;
  return {
    ...Q, kind: Q.kind + 'T', mirrored: true,
    doors: Q.doors.map(m), win: Q.win.map((q) => ({ ...q, u: -q.u })), legroom: Q.legroom.map((q) => ({ ...q, u: -q.u })),
    seats: Q.seats.map((s) => ({ u: -s.u, dir: -s.dir, w: -s.w })),
    blocks: Q.blocks.map((b) => ({ u0: -b.u1, u1: -b.u0, w0: -b.w1, w1: -b.w0 })),
    parts: Q.parts.map(m), zones: Q.zones.map((z) => [-z[0], -z[1], -z[2]]),
    openEnds: Q.openEnds.map(m), saloon: [-Q.saloon[1], -Q.saloon[0]], cab: Q.cab ? { ...Q.cab, u: -Q.cab.u, dir: -Q.cab.dir } : null,
    ledU: Q.ledU.map(m),
  };
}
export function carLayouts() {
  const T = CONFIG.train, W = T.walk, Y = T.layout, F0 = T.floor, F1 = T.floorHigh, wall = W.wall;
  const winW = 1.45, [winY0, winY1] = T.winY;
  const make = (kind, len) => {
    const h = len / 2, end = kind === 'end';
    const Q = { kind, len, h, doors: [], win: [], seats: [], blocks: [], parts: [], zones: [], legroom: [], openEnds: [], ledU: [], cab: null };
    // each end : cab (end car, front) or open gangway
    const ends = end ? [-1, 1] : [-1, 1];
    let pRear, pFront; // vestibule partitions (saloon limits)
    for (const e of ends) {
      let uStart, zoneLen; // where the ramp starts (toward the saloon) ; the high floor spans to the car end (gangway) or the cab bulkhead
      if (end && e > 0) {
        const ub = h - Y.cab; Q.cab = { u: ub, dir: 1 };
        zoneLen = Y.cabRaised; Q.zones.push([ub - zoneLen - Y.step, ub - zoneLen, h]);
        uStart = ub - zoneLen - Y.step;
      } else {
        zoneLen = Y.raised; Q.openEnds.push(e * h);
        Q.zones.push([e * (h - zoneLen - Y.step), e * (h - zoneLen), e * h]);
        uStart = e * (h - zoneLen - Y.step);
      }
      const P = uStart - e * Y.vestibule; // partition between the vestibule and the saloon
      if (e > 0) pFront = P; else pRear = P;
      Q.doors.push((uStart + P) / 2);
      Q.parts.push(P);
      Q.ledU.push((uStart + P) / 2);
      if (zoneLen > 1.2 && !(end && e > 0)) { // fold-up seats on the raised floor, a window above them
        const c = e * (h - zoneLen / 2);
        Q.win.push({ u: c, dy: 0.22, raised: true });
        for (const sd of [-1, 1]) Q.blocks.push({ u0: Math.min(c - 0.55, c + 0.55), u1: Math.max(c - 0.55, c + 0.55), w0: sd > 0 ? wall - 0.5 : -wall, w1: sd > 0 ? wall : -wall + 0.5 });
      }
    }
    // saloon : bays between the partitions
    const span = pFront - pRear, nBay = Math.floor(span / Y.bay + 1e-6), u0 = pRear + (span - nBay * Y.bay) / 2;
    for (let b = 0; b < nBay; b++) {
      const a = u0 + b * Y.bay;
      Q.win.push({ u: a + Y.bay / 2, dy: 0 });
      Q.legroom.push({ u: a + Y.bay / 2 });
      Q.ledU.push(a + Y.bay / 2);
      for (const side of [-1, 1]) {
        for (const [ub, dir] of [[a + 0.06, 1], [a + Y.bay - 0.06, -1]]) {
          for (const wcen of [0.665, 1.105]) Q.seats.push({ u: ub, dir, w: side * wcen });
          const lo = Math.min(ub, ub + dir * 0.56), hi = Math.max(ub, ub + dir * 0.56);
          Q.blocks.push({ u0: lo, u1: hi, w0: side > 0 ? 0.4 : -wall, w1: side > 0 ? wall : -0.4 });
        }
      }
    }
    Q.win.sort((a, b) => a.u - b.u);
    Q.saloon = [pRear, pFront]; Q.nBay = nBay; Q.bayU0 = u0;
    return Q;
  };
  const mid = make('mid', T.cars[1]), endQ = make('end', T.cars[0]), tail = mirrorLayout(make('end', T.cars[T.cars.length - 1]));
  const cars = T.cars.map((_, i) => (i === 0 ? endQ : i === T.cars.length - 1 ? tail : mid));
  return { mid, end: endQ, cars, winW, winY0, winY1, F0, F1 };
}
// floor height (above the rail head) at u of a car : low floor, ramped up to the high floor in the zones
export function floorOfCar(Q, u) {
  const T = CONFIG.train; let t = 0;
  for (const z of Q.zones) {
    const d = z[1] - z[0], k = d !== 0 ? (u - z[0]) / d : 0;
    if (k <= 0) continue;
    if ((z[2] - z[0]) * (u - z[2]) > 0) continue; // beyond the zone end
    t = Math.max(t, Math.min(1, k));
  }
  return T.floor + (T.floorHigh - T.floor) * t;
}

// ------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// body atlas 1024 x 1024 : rows 0-255 car side (y from 0.55 to 3.4), 256-511 roof and ends (grime), 512-767 door leaf (from the low floor to doorH)
export const ATLAS = { side: [0, 256, 0.55, 3.4], roof: [256, 512], door: [512, 768] };
function bodyTex() {
  const T = CONFIG.train;
  return canvasTex(1024, 1024, (x, W) => {
    const [r0, r1, y0m, y1m] = ATLAS.side, H = r1 - r0, py = (y) => r0 + (1 - (y - y0m) / (y1m - y0m)) * H, M = W / 18;
    // livery : off-white upper body, black-slate window band, slate skirt, a thin muted ochre stripe (neutral : no logo, no brand)
    const g = x.createLinearGradient(0, r0, 0, r1); g.addColorStop(0, '#cfd2d0'); g.addColorStop(0.55, '#bfc3c1'); g.addColorStop(1, '#85888a'); x.fillStyle = g; x.fillRect(0, r0, W, H);
    x.fillStyle = '#343b43'; x.fillRect(0, py(3.03), W, py(1.68) - py(3.03)); // window band (the pillars between the windows)
    x.fillStyle = 'rgba(180,200,215,0.12)'; x.fillRect(0, py(3.03), W, 2);
    x.fillStyle = '#3a4550'; x.fillRect(0, py(1.30), W, r1 - py(1.30)); // slate skirt
    x.fillStyle = '#7d6334'; x.fillRect(0, py(1.40), W, py(1.30) - py(1.40)); // muted ochre stripe
    for (let k = 0; k < 18; k += 1.25) { x.fillStyle = 'rgba(30,32,34,0.3)'; x.fillRect(k * M, r0, 1, H); } // panel seams
    for (let k = 0; k < 200; k++) { // grime streaks running down
      const sx = hash(k, r0) * W, sy = py(1.7) + hash(r0, k) * (r1 - py(1.7)) * 0.7, sh = 10 + hash(k, 4) * 40, gs = x.createLinearGradient(0, sy, 0, sy + sh);
      gs.addColorStop(0, 'rgba(38,30,22,0.16)'); gs.addColorStop(1, 'rgba(38,30,22,0)'); x.fillStyle = gs; x.fillRect(sx, sy, 1 + hash(k, 3) * 2, sh);
    }
    for (let k = 0; k < 40; k++) { const sx = hash(k, 7) * W, sy = py(1.7), sh = 14 + hash(k, 9) * 30, gs = x.createLinearGradient(0, sy, 0, sy + sh); gs.addColorStop(0, 'rgba(92,58,30,0.22)'); gs.addColorStop(1, 'rgba(92,58,30,0)'); x.fillStyle = gs; x.fillRect(sx, sy, 2, sh); } // rust streaks under the windows
    const gd = x.createLinearGradient(0, py(1.3), 0, r1); gd.addColorStop(0, 'rgba(30,24,18,0)'); gd.addColorStop(1, 'rgba(30,24,18,0.7)'); x.fillStyle = gd; x.fillRect(0, py(1.3), W, r1 - py(1.3)); // dirt
    x.fillStyle = 'rgba(85,12,10,0.55)'; x.fillRect(W * 0.37, py(1.62), 26, 20); x.fillRect(W * 0.373, py(1.4), 5, 34); // blood
    // roof and ends : grimy grey, streaks
    { const g2 = x.createLinearGradient(0, 256, 0, 512); g2.addColorStop(0, '#6e7174'); g2.addColorStop(1, '#4f5052'); x.fillStyle = g2; x.fillRect(0, 256, W, 256); for (let k = 0; k < 220; k++) { x.fillStyle = `rgba(${20 + hash(k, 1) * 30},${18 + hash(k, 2) * 20},14,0.3)`; x.fillRect(hash(k, 3) * W, 256 + hash(k, 4) * 256, 2 + hash(k, 5) * 20, 1 + hash(k, 6) * 4); } }
    // door leaf : slate, a lighter upper panel, dirt
    { const g3 = x.createLinearGradient(0, 512, 0, 768); g3.addColorStop(0, '#6f7880'); g3.addColorStop(0.55, '#5a636b'); g3.addColorStop(1, '#2c3238'); x.fillStyle = g3; x.fillRect(0, 512, W, 256);
      for (let k = 0; k < 60; k++) { x.fillStyle = `rgba(30,24,18,${0.05 + hash(k, 2) * 0.12})`; x.fillRect(hash(k, 1) * W, 512 + hash(k, 3) * 256, 2 + hash(k, 4) * 5, 14 + hash(k, 5) * 50); } }
  });
}
// emissive panel atlas 512 x 256 : LED, button, red, headlight, dead LED (row 0-31) ; screen (rows 64-159)
export const PANEL = { led: [0, 0, 128, 32], button: [128, 0, 192, 32], red: [192, 0, 256, 32], head: [256, 0, 320, 32], dead: [320, 0, 384, 32], screen: [0, 64, 512, 160], cab: [384, 0, 448, 32] };
function panelTex() {
  return canvasTex(512, 256, (x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, 512, 256);
    x.fillStyle = '#e8f0ff'; x.fillRect(0, 0, 128, 32);
    x.fillStyle = '#0b130c'; x.fillRect(128, 0, 64, 32); x.fillStyle = '#4dff7a'; x.beginPath(); x.arc(160, 16, 11, 0, TAU); x.fill();
    x.fillStyle = '#ff2a1a'; x.fillRect(192, 0, 64, 32);
    x.fillStyle = '#fff2d8'; x.fillRect(256, 0, 64, 32);
    x.fillStyle = '#1c1e20'; x.fillRect(320, 0, 64, 32);
    x.fillStyle = '#1b242e'; x.fillRect(384, 0, 64, 32);
    x.fillStyle = '#05070a'; x.fillRect(0, 64, 512, 96);
    x.fillStyle = '#ffb02a'; x.font = 'bold 30px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('Prochain arrêt : Strasbourg', 256, 104);
    x.fillStyle = '#9ab8ff'; x.font = '20px Arial, sans-serif'; x.fillText('Train 17412 · Terminus', 256, 140);
    x.fillStyle = 'rgba(0,0,0,0.45)'; for (let y = 64; y < 160; y += 3) x.fillRect(0, y, 512, 1);
  });
}
function bloodTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const blot = (cx, cy, r, n, a) => { for (let k = 0; k < n; k++) { const t = hash(cx + k, cy, r), rr = r * (0.2 + hash(k, cx) * 0.8); x.fillStyle = `rgba(${70 + t * 40},6,5,${a})`; x.beginPath(); x.arc(cx + (hash(k, 1, cy) - 0.5) * r * 2, cy + (hash(k, 2, cx) - 0.5) * r * 2, rr * 0.4, 0, TAU); x.fill(); } };
  blot(64, 64, 40, 30, 0.85); // splatter (top left)
  x.fillStyle = 'rgba(80,8,6,0.8)'; x.fillRect(150, 10, 40, 110); for (let k = 0; k < 8; k++) x.fillRect(148 + k * 6, 110, 3, 20 + hash(k, 9) * 60); // smear (top right)
  for (let f = 0; f < 5; f++) { x.fillStyle = 'rgba(90,8,6,0.85)'; x.beginPath(); x.ellipse(40 + f * 12, 160 - Math.abs(f - 2) * 6, 4, 14, (f - 2) * 0.15, 0, TAU); x.fill(); } x.beginPath(); x.ellipse(64, 205, 26, 30, 0, 0, TAU); x.fill(); // hand print (bottom left)
  blot(192, 192, 50, 50, 0.7); // pool (bottom right)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ materials (shared by every train)
let MATS = null;
export function trainMaterials(envMap = null) {
  if (MATS) return MATS;
  const panel = panelTex();
  MATS = {
    body: new THREE.MeshStandardMaterial({ map: bodyTex(), roughness: 0.52, metalness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.45 }),
    inside: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06, emissive: 0x0b0d10 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fa4b0, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    // the windscreen : dark tinted glass over a dim cab (opaque : nobody looks into the cab)
    screen: new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.6 }),
    panel: new THREE.MeshStandardMaterial({ map: panel, emissiveMap: panel, emissive: 0xdde8ff, emissiveIntensity: 1.0, roughness: 0.4 }),
    flicker: new THREE.MeshStandardMaterial({ map: panel, emissiveMap: panel, emissive: 0xdde8ff, emissiveIntensity: 1.0, roughness: 0.4 }),
    decal: new THREE.MeshStandardMaterial({ map: bloodTex(), transparent: true, depthWrite: false, roughness: 0.35, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0x20201c, emissive: 0xfff0d0, emissiveIntensity: 3.2, roughness: 0.3 }),
    lampTail: new THREE.MeshStandardMaterial({ color: 0x300806, emissive: 0xff2412, emissiveIntensity: 2.6, roughness: 0.3 }),
  };
  // broken saloon windows (v0.82.0) : cracks over the pane (white hairlines, transparent), jagged shards left in the frame (dirtier glass)
  MATS.crack = new THREE.MeshStandardMaterial({ map: crackTex(), color: 0xdfe6ea, roughness: 0.2, metalness: 0.1, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  MATS.shards = new THREE.MeshStandardMaterial({ color: 0x7c8e96, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  if (envMap) { MATS.glass.envMap = envMap; MATS.shards.envMap = envMap; MATS.screen.envMap = envMap; }
  return MATS;
}
// impact cracks : radial hairlines from a point near the bottom middle (where the fists hit), rings around it
function crackTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d'), cx = 128, cy = 120;
  x.clearRect(0, 0, 256, 160); x.lineCap = 'round';
  for (let k = 0; k < 15; k++) {
    let a = (k / 15) * TAU + hash(k, 1) * 0.3, px = cx, py = cy;
    x.strokeStyle = `rgba(235,242,246,${0.55 + hash(k, 2) * 0.35})`; x.lineWidth = 1 + hash(k, 3) * 1.4;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 9; s++) { a += (hash(k, s, 4) - 0.5) * 0.5; const l = 9 + hash(k, s, 5) * 16; px += Math.cos(a) * l; py += Math.sin(a) * l * 0.8; x.lineTo(px, py); }
    x.stroke();
  }
  for (const r of [10, 24, 40]) { x.strokeStyle = 'rgba(230,238,242,0.45)'; x.lineWidth = 1; x.beginPath(); for (let k = 0; k <= 24; k++) { const a = (k / 24) * TAU, rr = r * (0.8 + hash(k, r) * 0.4); const X = cx + Math.cos(a) * rr, Y = cy + Math.sin(a) * rr * 0.8; if (k) x.lineTo(X, Y); else x.moveTo(X, Y); } x.stroke(); }
  x.fillStyle = 'rgba(240,245,248,0.5)'; x.beginPath(); x.arc(cx, cy, 6, 0, TAU); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ saloon window pane, cracks, shards (v0.82.0) : one window centred on u = 0,
// in the plane w = 0 facing +w (vehicle-local axes, see the header) ; train.js instances them at side * (width / 2 - 0.025), u = window centre
export function buildWindowGeometry() {
  const L = carLayouts(), w = L.winW, y0 = L.winY0, y1 = L.winY1;
  const pane = onSide(new THREE.ShapeGeometry(rrect(-w / 2, y0, w / 2, y1, 0.12), 4), 0, 1);
  const crack = onSide(new THREE.ShapeGeometry(rrect(-w / 2, y0, w / 2, y1, 0.12), 4), 0.004, 1);
  { const p = crack.attributes.position, uv = crack.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, (p.getY(i) - y0) / (y1 - y0)); }
  // shards : the frame keeps a jagged rim of glass (deterministic outline, 0.05 to 0.3 m deep)
  const s = rrect(-w / 2, y0, w / 2, y1, 0.12), hole = new THREE.Path(), n = 34, pts = [];
  for (let k = 0; k < n; k++) {
    const f = k / n, per = 2 * (w + (y1 - y0)), d = f * per; let px, py;
    if (d < w) { px = -w / 2 + d; py = y0; } else if (d < w + (y1 - y0)) { px = w / 2; py = y0 + d - w; } else if (d < 2 * w + (y1 - y0)) { px = w / 2 - (d - w - (y1 - y0)); py = y1; } else { px = -w / 2; py = y1 - (d - 2 * w - (y1 - y0)); }
    const depth = 0.05 + hash(k, 77) * 0.25 * (k % 3 === 0 ? 1 : 0.45), cxp = 0, cyp = (y0 + y1) / 2, dx = cxp - px, dy = cyp - py, l = Math.hypot(dx, dy) || 1;
    pts.push([px + (dx / l) * depth, py + (dy / l) * depth]);
  }
  pts.forEach(([px, py], i) => (i ? hole.lineTo(px, py) : hole.moveTo(px, py))); hole.closePath();
  s.holes.push(hole);
  const shards = onSide(new THREE.ShapeGeometry(s, 4), 0, 1);
  return { pane, crack, shards };
}

// ------------------------------------------------------------------ geometry kit
const COL = new THREE.Color();
function buckets() {
  const map = new Map();
  return {
    add(name, g, color = null) {
      if (!g) return;
      let q = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
      if (!q.attributes.normal) q.computeVertexNormals();
      if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
      if (color != null) {
        COL.set(color);
        const n = q.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { c[i * 3] = COL.r; c[i * 3 + 1] = COL.g; c[i * 3 + 2] = COL.b; }
        q.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      }
      let l = map.get(name); if (!l) map.set(name, l = []); l.push(q);
    },
    merge() {
      const out = {};
      for (const [name, list] of map) { out[name] = mergeGeometries(list, false); list.forEach((q) => q.dispose()); out[name].computeBoundingSphere(); out[name].computeBoundingBox(); }
      map.clear();
      return out;
    },
  };
}
const rrect = (x0, y0, x1, y1, r, path = false) => { // rounded rectangle (Shape or Path)
  const s = path ? new THREE.Path() : new THREE.Shape(); r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
};
const ring = (x0, y0, x1, y1, r, b) => { const s = rrect(x0 - b, y0 - b, x1 + b, y1 + b, r + b); s.holes.push(rrect(x0, y0, x1, y1, r, true)); return s; };
const extr = (shape, depth, bevel = 0, curve = 6) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: curve });
// chamfered box centred on (u, y, w) : sizes along u, y, w
function cbox(u, y, w, su, sy, sw, c = 0.02) {
  c = Math.min(c, su / 3, sy / 3, sw / 3);
  const g = extr(new THREE.Shape([new THREE.Vector2(-sw / 2 + c, -sy / 2 + c), new THREE.Vector2(sw / 2 - c, -sy / 2 + c), new THREE.Vector2(sw / 2 - c, sy / 2 - c), new THREE.Vector2(-sw / 2 + c, sy / 2 - c)]), Math.max(0.001, su - 2 * c), c);
  g.translate(0, 0, -(su - 2 * c) / 2);
  g.translate(w, y, -u);
  return g;
}
// cylinder along an axis : 'u' (along the vehicle), 'w' (across), 'y'
function cyl(u, y, w, r, len, axis = 'y', seg = 12, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  if (axis === 'w') g.rotateZ(Math.PI / 2); else if (axis === 'u') g.rotateX(Math.PI / 2);
  g.translate(w, y, -u);
  return g;
}
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vq = new THREE.Quaternion(), _vy = new THREE.Vector3(0, 1, 0);
function tube(a, b, r, seg = 6) { // a, b : [u, y, w]
  _va.set(a[2], a[1], -a[0]); _vb.set(b[2], b[1], -b[0]);
  const len = _va.distanceTo(_vb), g = new THREE.CylinderGeometry(r, r, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(_vq.setFromUnitVectors(_vy, _vb.clone().sub(_va).normalize()));
  g.translate(_va.x, _va.y, _va.z);
  return g;
}
// flat shape (x along u, y up) placed on the plane w = w0, facing +w (face > 0) or -w. NOTE : facing -w mirrors x (shape x = -u) : see sx()
function onSide(g, w0, face) { g.rotateY(face > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(w0, 0, 0); return g; }
const sx = (face, u) => (face > 0 ? u : -u); // u -> shape x for onSide(face)
// flat shape (x along w, y up) placed on the plane u = u0, facing +u (face > 0) or -u
function onEnd(g, u0, face) { if (face > 0) g.rotateY(Math.PI); g.translate(0, 0, -u0); return g; }
// UVs from positions for a body-atlas region : side (u along the vehicle length L, y)
function uvSide(g, region, L) {
  const [r0, r1, y0, y1] = region, p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const u = -p.getZ(i), y = p.getY(i); uv.setXY(i, (u + L / 2) / L, 1 - (r0 + (1 - (y - y0) / (y1 - y0)) * (r1 - r0)) / 1024); }
  uv.needsUpdate = true; return g;
}
function uvRegion(g, rows, fx, fy) { // planar mapping into atlas rows [r0, r1] : fx, fy -> [0, 1]
  const p = g.attributes.position, uv = g.attributes.uv, [r0, r1] = rows;
  for (let i = 0; i < p.count; i++) { const a = clamp(fx(p.getX(i), p.getY(i), p.getZ(i)), 0, 1), b = clamp(fy(p.getX(i), p.getY(i), p.getZ(i)), 0, 1); uv.setXY(i, a, 1 - (r0 + (1 - b) * (r1 - r0)) / 1024); }
  uv.needsUpdate = true; return g;
}
function uvPanel(g, cell) { // whole geometry into one cell of the panel atlas (512 x 256)
  const [x0, y0, x1, y1] = cell, p = g.attributes.position, uv = g.attributes.uv;
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  const ax = (i) => p.getX(i) - p.getZ(i), ay = (i) => p.getY(i);
  for (let i = 0; i < p.count; i++) { a0 = Math.min(a0, ax(i)); a1 = Math.max(a1, ax(i)); b0 = Math.min(b0, ay(i)); b1 = Math.max(b1, ay(i)); }
  for (let i = 0; i < p.count; i++) {
    const fa = a1 > a0 ? (ax(i) - a0) / (a1 - a0) : 0.5, fb = b1 > b0 ? (ay(i) - b0) / (b1 - b0) : 0.5;
    uv.setXY(i, (x0 + 1 + fa * (x1 - x0 - 2)) / 512, 1 - (y0 + 1 + (1 - fb) * (y1 - y0 - 2)) / 256);
  }
  uv.needsUpdate = true; return g;
}
function uvRect(g, cell, flip = false) { // a plane-like geometry with UVs in [0, 1] -> one panel atlas cell
  const [x0, y0, x1, y1] = cell, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const a = flip ? 1 - uv.getX(i) : uv.getX(i), b = uv.getY(i); uv.setXY(i, (x0 + a * (x1 - x0)) / 512, 1 - (y0 + (1 - b) * (y1 - y0)) / 256); }
  uv.needsUpdate = true; return g;
}
const plane = (sx_, sy) => new THREE.PlaneGeometry(sx_, sy);

// colours (desaturated, gritty)
const C = {
  steel: 0x3d4145, black: 0x161717, rubber: 0x1b1b1c, rust: 0x4a3326, axle: 0x2c2b29, wheel: 0x3a3632, disc: 0x55524d, yellow: 0x6e5a22,
  seat: 0x2e3946, seatHead: 0x7c7f7d, pedestal: 0x25272a, floor: 0x2a2d31, aisle: 0x3a3c40, lining: 0x8b8a84, liningLow: 0x55575a, ceiling: 0x9c9b95,
  partition: 0x6d6f70, rack: 0x6a6e72, insulator: 0x5a2e22, grey: 0x55585b, paint: 0x9a9e9c, slate: 0x3a4550, bench: 0x4a5560,
};

// ------------------------------------------------------------------ bogie (two axles) centred at u = 0 (train.js instances it at the pivots)
export function buildBogieGeometry() {
  const B = buckets(), r = 0.43, wb = 2.7, yAx = r, g = CONFIG.railNet.gauge / 2 + 0.036, u = 0;
  for (const a of [-wb / 2, wb / 2]) {
    for (const s of [-1, 1]) {
      B.add('dark', cyl(u + a, yAx, s * g, r, 0.13, 'w', 18), C.wheel);                       // wheel
      B.add('dark', cyl(u + a, yAx, s * (g + 0.075), r * 0.82, 0.03, 'w', 18), C.rust);       // rim face
      B.add('dark', cbox(u + a, yAx, s * 1.06, 0.36, 0.3, 0.22, 0.03), C.steel);                 // axle box
      for (let k = 0; k < 4; k++) B.add('dark', new THREE.TorusGeometry(0.075, 0.018, 5, 10).rotateX(Math.PI / 2).translate(s * 1.06, yAx + 0.2 + k * 0.05, -(u + a)), C.rust); // coil spring
      B.add('dark', cyl(u + a, yAx, s * 0.36, r * 0.68, 0.05, 'w', 16), C.disc);               // brake disc
    }
    B.add('dark', cyl(u + a, yAx, 0, 0.08, 2 * g, 'w', 8), C.axle);                              // axle
  }
  const fs = new THREE.Shape(), L = wb / 2 + 0.55, y0 = yAx + 0.15;
  fs.moveTo(-L, y0); fs.lineTo(-L, y0 + 0.28); fs.lineTo(-0.7, y0 + 0.36); fs.lineTo(-0.5, y0 + 0.12); fs.lineTo(0.5, y0 + 0.12); fs.lineTo(0.7, y0 + 0.36); fs.lineTo(L, y0 + 0.28); fs.lineTo(L, y0); fs.lineTo(0.6, y0 - 0.05); fs.lineTo(-0.6, y0 - 0.05); fs.lineTo(-L, y0);
  for (const s of [-1, 1]) { const gf = extr(fs, 0.14, 0.02); gf.translate(0, 0, -0.07); onSide(gf, s * 1.06, 1); gf.translate(0, 0, -u); B.add('dark', gf, C.steel); }
  B.add('dark', cbox(u, yAx + 0.28, 0, 0.5, 0.24, 2.0, 0.04), C.steel);
  for (const s of [-1, 1]) { B.add('dark', cyl(u, yAx + 0.55, s * 0.95, 0.27, 0.26, 'y', 14), C.rubber); B.add('dark', tube([u - wb / 2 + 0.3, yAx + 0.1, s * 1.18], [u - 0.2, yAx + 0.55, s * 1.18], 0.035), C.black); } // air springs, dampers
  for (const s of [-1, 1]) B.add('dark', cyl(u, yAx + 0.05, s * 0.5, 0.17, 0.5, 'u', 10), C.axle); // traction motors
  return B.merge().dark;
}

// ------------------------------------------------------------------ nose (end car) : a loft of cross-sections from the flat body to the blunt front
// The ring of the body section (rounded roof, vertical sides) is scaled, lowered and rounded toward the front ; the part of the top that is the
// windscreen is its own material. nose() is shared by the lamps, the cab and the blood decals.
const NOSE_T = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.58, 0.66, 0.74, 0.82, 0.9, 1.0];   // slices (t : 0 at the end of the flat body, 1 at the front)
const NOSE_TOP = [[0, 1], [0.2, 0.975], [0.35, 0.92], [0.5, 0.84], [0.58, 0.8], [0.9, 0.6], [1, 0.54]]; // top height (fraction of the car height) along t
const lerpKeys = (K, t) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const a = K[i - 1], b = K[i], k = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * k; } return K[K.length - 1][1]; };
export function noseSection(t) { // { fw : half-width factor, yBot, yTop, round }
  const T = CONFIG.train;
  return { fw: 1 - 0.30 * Math.pow(t, 2.2), yBot: 0.55 + 0.5 * Math.pow(t, 3), yTop: T.height * lerpKeys(NOSE_TOP, t), round: 0.62 * Math.pow(t, 1.3) };
}
function roofProfile() {
  const T = CONFIG.train, Wd = T.width / 2;
  return [[1.45, 3.25], [1.44, 3.45], [1.4, 3.62], [1.31, 3.77], [1.17, 3.88], [0.93, 3.97], [0.58, 4.03], [0.2, 4.05], [-0.2, 4.05], [-0.58, 4.03], [-0.93, 3.97], [-1.17, 3.88], [-1.31, 3.77], [-1.4, 3.62], [-1.44, 3.45], [-1.45, 3.25]]
    .map(([w, y]) => [(w * Wd) / 1.45, 3.25 + ((y - 3.25) * (T.height - 3.25)) / 0.8]);
}
function buildNose(B, u0, Ln, yb, yc) {
  const T = CONFIG.train, Wd = T.width / 2, Ht = T.height, prof = roofProfile();
  // base ring (w, y), counter-clockwise seen from the front : bottom right, right side up, roof right to left, left side down, bottom left
  const base = [[Wd, yb], [Wd, yb + (yc - yb) / 3], [Wd, yb + (2 * (yc - yb)) / 3], ...prof, [-Wd, yb + (2 * (yc - yb)) / 3], [-Wd, yb + (yc - yb) / 3], [-Wd, yb]];
  const n = base.length;
  const isTop = base.map(([w, y]) => y >= yc + 0.12 && Math.abs(w) < 1.2); // the windscreen band of the ring
  const ns = NOSE_T.length, P = new Float32Array(ns * n * 3), cen = [];
  for (let i = 0; i < ns; i++) {
    const t = NOSE_T[i], S = noseSection(t), u = u0 + Ln * t, cy = (S.yBot + S.yTop) / 2, a = Wd * S.fw, b = (S.yTop - S.yBot) / 2;
    cen.push([0, cy, -u]);
    for (let j = 0; j < n; j++) {
      let w = base[j][0] * S.fw, y = S.yBot + ((base[j][1] - yb) / (Ht - yb)) * (S.yTop - S.yBot);
      if (S.round > 0) { // round the corners : toward the ellipse of the same box
        const qx = w / a, qy = (y - cy) / b, r = Math.hypot(qx, qy) || 1;
        w += (a * (qx / r) - w) * S.round; y += (cy + b * (qy / r) - y) * S.round;
      }
      P[(i * n + j) * 3] = w; P[(i * n + j) * 3 + 1] = y; P[(i * n + j) * 3 + 2] = -u;
    }
  }
  const sets = { body: [], frame: [], screen: [], mask: [] };
  const add = (set, i, j, flip) => {
    const j1 = (j + 1) % n, a = i * n + j, b = i * n + j1, c = (i + 1) * n + j1, d = (i + 1) * n + j;
    const cx = cen[i];
    // outward test : the quad's normal against the direction from the slice centre
    const px = (P[a * 3] + P[b * 3] + P[c * 3] + P[d * 3]) / 4, py = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1] + P[d * 3 + 1]) / 4, pz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2] + P[d * 3 + 2]) / 4;
    const e1x = P[c * 3] - P[a * 3], e1y = P[c * 3 + 1] - P[a * 3 + 1], e1z = P[c * 3 + 2] - P[a * 3 + 2], e2x = P[d * 3] - P[b * 3], e2y = P[d * 3 + 1] - P[b * 3 + 1], e2z = P[d * 3 + 2] - P[b * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const out = nx * (px - cx[0]) + ny * (py - cx[1]) + nz * (pz - cx[2]) > 0;
    sets[set].push(...(out ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
  };
  for (let i = 0; i < ns - 1; i++) for (let j = 0; j < n; j++) {
    const top = isTop[j] && isTop[(j + 1) % n], near = isTop[(j + n - 1) % n] || isTop[(j + 2) % n] || isTop[j] || isTop[(j + 1) % n];
    let set = 'body';
    if (i >= ns - 2) set = 'mask';
    else if (i >= 6 && top) set = 'screen';
    else if (i >= 5 && near && (i <= ns - 3)) set = 'frame';
    add(set, i, j);
  }
  const mk = (idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals(); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ns * n * 2), 2)); return g; };
  if (sets.body.length) B.add('body', uvSide(mk(sets.body), ATLAS.side, T.cars[0]));
  if (sets.frame.length) B.add('dark', mk(sets.frame), C.rubber);
  if (sets.screen.length) B.add('screen', mk(sets.screen));
  if (sets.mask.length) B.add('dark', mk(sets.mask), C.black);
  // front cap (flat, black mask) at the last slice
  { const i = ns - 1, idx = [], c = cen[i]; for (let j = 1; j < n - 1; j++) { const a = i * n, b = i * n + j, d = i * n + j + 1; const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], fx = P[d * 3] - P[a * 3], fy = P[d * 3 + 1] - P[a * 3 + 1]; idx.push(...((ex * fy - ey * fx) * -1 > 0 ? [a, b, d] : [a, d, b])); } void c; B.add('dark', mk(idx), C.black); }
  // an inner shell of the nose (the interior of the cab seen from the saloon side of the windscreen : the outer faces are culled from inside)
  return { P, n, ns, base };
}

// ------------------------------------------------------------------ car body
// kind : 'mid' | 'end' (nose toward +u) ; returns { body, dark, inside, glass, screen, panel, flicker, decal }
export function buildCarGeometry(kind) {
  const T = CONFIG.train, W = T.walk, Lay = carLayouts(), Q = kind === 'end' ? Lay.end : Lay.mid, L = Q.len, h = Q.h, Wd = T.width / 2, F0 = T.floor, F1 = T.floorHigh, B = buckets();
  const end = kind === 'end', Ln = T.layout.taper, uF = end ? h - Ln : h, uA = -h; // flat body from uA to uF
  const yb = 0.55, yc = 3.25, lin = W.wall + 0.01, ceil = 3.05;
  const { winW } = Lay, winY0 = Lay.winY0, winY1 = Lay.winY1;
  const dw = T.doorWidth / 2, dTop = F0 + T.doorH;
  const cabWin = end ? { u: Q.cab.u + 0.5, w: 0.5 } : null; // cab side window (end car) : centre u, half width
  // ---- sides : skin with window and door openings (extruded), gaskets, door frames, handrails, buttons
  for (const side of [-1, 1]) {
    const X = (u) => sx(side, u);
    const x0 = Math.min(X(uA), X(uF)), x1 = Math.max(X(uA), X(uF));
    const s = new THREE.Shape([new THREE.Vector2(x0, yb), new THREE.Vector2(x1, yb), new THREE.Vector2(x1, yc), new THREE.Vector2(x0, yc)]);
    for (const q of Q.win) s.holes.push(rrect(X(q.u) - winW / 2, winY0 + q.dy, X(q.u) + winW / 2, winY1 + q.dy, 0.12, true));
    for (const u of Q.doors) s.holes.push(rrect(X(u) - dw, F0 + 0.02, X(u) + dw, dTop, 0.1, true));
    if (cabWin) s.holes.push(rrect(X(cabWin.u) - cabWin.w / 2, 2.0, X(cabWin.u) + cabWin.w / 2, 2.98, 0.08, true));
    const g = extr(s, Wd - lin - 0.02, 0, 4); onSide(g, side > 0 ? lin + 0.02 : -lin - 0.02, side);
    B.add('body', uvSide(g, ATLAS.side, L));
    for (const q of Q.win) {
      const gk = extr(ring(X(q.u) - winW / 2, winY0 + q.dy, X(q.u) + winW / 2, winY1 + q.dy, 0.12, 0.045), 0.02, 0, 4); onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber);
      // (the panes are their own instances, train.js : a window can crack and break during the intro, v0.82.0 ; buildWindowGeometry)
    }
    for (const u of Q.doors) {
      const fr = extr(ring(X(u) - dw, F0 + 0.02, X(u) + dw, dTop, 0.1, 0.07), 0.03, 0, 4); onSide(fr, side * Wd, side); B.add('dark', fr, C.grey);
      for (const e of [-1, 1]) B.add('dark', tube([u + e * (dw + 0.16), F0 + 0.45, side * (Wd + 0.07)], [u + e * (dw + 0.16), F0 + 1.95, side * (Wd + 0.07)], 0.02), C.steel); // handrails
      B.add('dark', cbox(u, F0 - 0.03, side * (Wd - 0.04), T.doorWidth + 0.1, 0.05, 0.2, 0.012), C.steel); // threshold plate
      B.add('dark', cbox(u, F0 - 0.012, side * (Wd + 0.02), T.doorWidth, 0.014, 0.05, 0.004), C.yellow);  // edge band
      const dirIn = u > 0 ? -1 : 1;
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.045, 12).translate(X(u + dirIn * (dw + 0.3)), 1.85, 0), side * (Wd + 0.012), side), PANEL.button)); // outer door button
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.04, 12).translate(X(u + dirIn * (dw + 0.25)), 1.95, 0), side * (lin - 0.012), -side), PANEL.button)); // inner door button
    }
    if (cabWin) {
      const q = cabWin, fr = extr(ring(X(q.u) - q.w / 2, 2.0, X(q.u) + q.w / 2, 2.98, 0.08, 0.04), 0.02, 0, 4); onSide(fr, side * Wd, side); B.add('dark', fr, C.rubber);
      B.add('panel', uvPanel(onSide(new THREE.ShapeGeometry(rrect(X(q.u) - q.w / 2, 2.0, X(q.u) + q.w / 2, 2.98, 0.08), 4), side * (Wd - 0.03), side), PANEL.cab)); // dark glass of the cab window
      const cd = extr(ring(X(q.u) - 0.3, F1 + 0.02, X(q.u) + 0.3, 3.02, 0.05, 0.035), 0.02, 0, 4); onSide(cd, side * Wd, side); B.add('dark', cd, C.grey); // cab door outline
      B.add('dark', tube([q.u - 0.42, F1 + 0.5, side * (Wd + 0.06)], [q.u - 0.42, F1 + 1.7, side * (Wd + 0.06)], 0.018), C.steel);
      B.add('dark', tube([q.u + 0.55, 2.6, side * (Wd + 0.02)], [q.u + 0.82, 2.55, side * (Wd + 0.34)], 0.02), C.black); // mirror arm
      B.add('dark', cbox(q.u + 0.86, 2.55, side * (Wd + 0.37), 0.07, 0.3, 0.12, 0.02), C.black);                         // mirror
    }
    B.add('dark', cbox((uA + uF) / 2, yc + 0.02, side * (Wd - 0.02), uF - uA, 0.06, 0.08, 0.02), C.steel); // gutter at the cant rail
    B.add('dark', cbox((uA + uF) / 2, yb + 0.03, side * (Wd - 0.03), uF - uA - 0.3, 0.07, 0.07, 0.02), C.black); // solebar edge
  }
  // ---- roof : swept profile (cant rail curve, flat crown), AC units
  {
    const prof = roofProfile(), pos = [];
    for (let i = 1; i < prof.length; i++) { const [w0, y0] = prof[i - 1], [w1, y1] = prof[i], A = [w0, y0, -uF], Bp = [w1, y1, -uF], Cp = [w1, y1, -uA], D = [w0, y0, -uA]; pos.push(...A, ...Bp, ...Cp, ...A, ...Cp, ...D); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); g.computeVertexNormals();
    B.add('body', uvRegion(g, ATLAS.roof, (x, y, z) => (-z + h) / L, (x) => (x + Wd) / (2 * Wd)));
    // inner ceiling and coves (interior)
    const cv = [[lin, ceil - 0.12], [0.95, ceil], [-0.95, ceil], [-lin, ceil - 0.12]], uEnd = end ? Q.cab.u : h, pi = [];
    for (let i = 1; i < cv.length; i++) { const [w0, y0] = cv[i - 1], [w1, y1] = cv[i]; pi.push(w0, y0, h - 0.1, w1, y1, h - 0.1, w1, y1, -uEnd + 0.1, w0, y0, h - 0.1, w1, y1, -uEnd + 0.1, w0, y0, -uEnd + 0.1); }
    const gi = new THREE.BufferGeometry(); gi.setAttribute('position', new THREE.Float32BufferAttribute(pi, 3)); gi.computeVertexNormals(); B.add('inside', gi, C.ceiling);
    // roof equipment : air-conditioning units (a vented box with slats), a cable duct along the roof
    const acs = end ? [-3.0] : [-3.4, 1.6];
    for (const u of acs) { B.add('dark', cbox(u, T.height + 0.08, 0, 2.4, 0.26, 1.6, 0.06), C.grey); for (let k = 0; k < 6; k++) B.add('dark', cbox(u - 0.9 + k * 0.36, T.height + 0.22, 0, 0.05, 0.03, 1.3, 0.01), C.black); }
    B.add('dark', cbox((uA + uF) / 2, T.height + 0.015, 0.92, uF - uA - 1.5, 0.04, 0.3, 0.01), C.grey);
  }
  // ---- open gangway ends : end wall with the opening, corrugated bellows, floor plate, lining of the opening
  const gw = W.gangway / 2, gh = ceil - F1 - 0.1;
  for (const uE of Q.openEnds) {
    const dir = Math.sign(uE);
    const s = new THREE.Shape(); s.moveTo(-Wd, yb); s.lineTo(Wd, yb); s.lineTo(Wd, yc); s.quadraticCurveTo(Wd, T.height, 0, T.height); s.quadraticCurveTo(-Wd, T.height, -Wd, yc); s.lineTo(-Wd, yb);
    s.holes.push(rrect(-gw, F1 + 0.01, gw, F1 + gh, 0.08, true));
    const g = extr(s, 0.08, 0, 8); g.translate(0, 0, -0.04); onEnd(g, uE - dir * 0.04, dir);
    B.add('body', uvRegion(g, ATLAS.roof, (x) => (x + Wd) / (2 * Wd), (x, y) => (y - yb) / (T.height - yb)));
    for (let k = 0; k < 6; k++) { // corrugated bellows (rings), from the end out to the middle of the gap
      const o = 0.07 + (k % 2) * 0.05, b0 = uE + dir * (0.04 + k * 0.075);
      const r = extr(ring(-gw - 0.05, F1 - 0.02, gw + 0.05, F1 + gh + 0.1, 0.12, o + 0.12), 0.07, 0, 4); r.translate(0, 0, -0.035); onEnd(r, b0 + dir * 0.035, dir); B.add('dark', r, C.rubber);
    }
    B.add('dark', cbox(uE + dir * 0.25, F1 - 0.02, 0, 0.5, 0.04, W.gangway + 0.1, 0.01), C.steel);
    { // three quads around the opening (a Shape with a hole is triangulated across it : a solid slab, v0.85.1)
      const yT = ceil - 0.12, yO = F1 + gh, sideW = lin - gw;
      for (const [w, hh, cx, cy] of [[sideW, yT - F1, -(lin + gw) / 2, (F1 + yT) / 2], [sideW, yT - F1, (lin + gw) / 2, (F1 + yT) / 2], [2 * gw, yT - yO, 0, (yO + yT) / 2]]) B.add('inside', onEnd(plane(w, hh).translate(cx, cy, 0), uE - dir * 0.09, -dir), C.partition);
      const rv = extr(ring(-gw, F1 + 0.01, gw, F1 + gh, 0.08, 0.04), 0.12, 0, 4); rv.translate(0, 0, -0.06); onEnd(rv, uE - dir * 0.05, dir); B.add('inside', rv, C.rack);
    }
    for (const sw of [-1, 1]) B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.07, 10).translate(sw * 1.15, 1.3, 0), uE + dir * 0.005, dir), PANEL.red));
  }
  // ---- the nose of the end car, and the cab bulkhead of the interior
  if (end) {
    buildNose(B, uF, Ln, yb, yc);
    const ub = Q.cab.u, bh = 0.06, pdw = 0.45;
    const s = new THREE.Shape([new THREE.Vector2(-lin, F1), new THREE.Vector2(lin, F1), new THREE.Vector2(lin, ceil), new THREE.Vector2(-lin, ceil)]);
    s.holes.push(rrect(-pdw, F1 + 0.001, pdw, F1 + 1.95, 0.05, true));
    const g = extr(s, bh, 0, 4); g.translate(0, 0, -bh / 2); onEnd(g, ub, 1); B.add('inside', g, C.partition);
    B.add('inside', cbox(ub + 0.02, F1 + 0.01, 0, 0.14, 0.02, 2 * pdw + 0.06, 0.005), C.steel); // threshold
    B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.05, 12).translate(-0.72, F1 + 1.25, 0), ub - 0.034, -1), PANEL.red)); // « cab » lamp
    B.add('panel', uvRect(onEnd(plane(0.64, 0.12).translate(0, F1 + 2.12, 0), ub - 0.04, -1), PANEL.screen));
    // a door in the front of the cab : locked (steel plate, handle)
    B.add('inside', onEnd(plane(0.8, 0.3).translate(0, F1 + 1.0, 0), ub - 0.036, -1), C.liningLow);
    // underframe of the cab : the front coupler cover
    B.add('dark', cbox(h - 0.18, 0.85, 0, 0.36, 0.3, 1.2, 0.08), C.black);
    for (const sw of [-1, 1]) B.add('dark', cyl(h - 0.1, 0.92, sw * 0.52, 0.035, 0.1, 'u', 8), C.steel);
    // wipers on the windscreen, a roof marker
    for (const sw of [-1, 1]) B.add('dark', tube([h - 1.25, 2.8, sw * 0.32], [h - 0.95, 2.62, sw * 0.82], 0.014), C.black);
  }
  // ---- underframe : equipment boxes under the low floor, skirt
  { const us = end ? [-3.2, 0.2, 2.6] : [-3.0, -0.4, 2.4];
    for (const [i, u] of us.entries()) B.add('dark', cbox(u, yb - 0.2, 0, i === 1 ? 1.8 : 1.4, 0.34, 1.7, 0.05), C.axle);
    for (const s of [-1, 1]) B.add('dark', cbox(0, yb - 0.04, s * (Wd - 0.18), uF - uA - 4, 0.12, 0.08, 0.02), C.black); }

  // ================================================================ interior
  // floors : the low floor all along, the raised floors over the bogies (with two steps) and in front of the cab bulkhead
  B.add('inside', new THREE.PlaneGeometry(2 * lin, uF - uA - 0.2).rotateX(-Math.PI / 2).translate(0, F0, (-(uF + uA)) / 2), C.floor);
  B.add('inside', new THREE.PlaneGeometry(0.8, Q.saloon[1] - Q.saloon[0]).rotateX(-Math.PI / 2).translate(0, F0 + 0.002, -(Q.saloon[0] + Q.saloon[1]) / 2), C.aisle);
  for (const z of Q.zones) {
    const dir = Math.sign(z[2] - z[0]), uEnd = end && dir > 0 ? Q.cab.u : z[2], a = z[0], m = (z[0] + z[1]) / 2, e = uEnd;
    const box = (ua, ub2, top) => { const lo = Math.min(ua, ub2), hi = Math.max(ua, ub2); B.add('inside', cbox((lo + hi) / 2, (F0 + top) / 2 - 0.01, 0, hi - lo, top - F0, 2 * lin - 0.02, 0.01), C.floor); };
    box(a, m, F0 + (F1 - F0) / 2); box(m, e, F1); // two steps, then the high floor
    B.add('inside', cbox((a + m) / 2, F0 + (F1 - F0) / 2 + 0.003, 0, Math.abs(m - a), 0.012, 2 * lin - 0.04, 0.003), C.aisle);
    B.add('dark', cbox((z[0] + z[1]) / 2, F1 + 0.003, 0, 0.04, 0.01, 2 * lin - 0.06, 0.003), C.yellow);   // nosing of the last step
  }
  // linings : lower panel (door openings), upper panel (windows), facing inward
  { const uLo = uA + 0.1, uHi = (end ? Q.cab.u : h) - (end ? 0.06 : 0.1), doors = [...Q.doors].sort((p, q) => p - q);
    for (const side of [-1, 1]) {
      const X = (u) => sx(-side, u); // (the linings face inward : onSide(-side))
      const rangeShape = (p, q, y0, y1) => new THREE.Shape([new THREE.Vector2(Math.min(X(p), X(q)), y0), new THREE.Vector2(Math.max(X(p), X(q)), y0), new THREE.Vector2(Math.max(X(p), X(q)), y1), new THREE.Vector2(Math.min(X(p), X(q)), y1)]);
      let a = uLo; const pieces = [];
      for (const u of doors) { pieces.push([a, u - dw]); a = u + dw; } pieces.push([a, uHi]);
      for (const [p, q] of pieces) {
        B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(p, q, F0, winY0)), side * lin, -side), C.liningLow);
        B.add('inside', onSide(new THREE.ShapeGeometry(rangeShape(p, q, F0 + 0.85, F0 + 0.88)), side * (lin - 0.01), -side), C.rack); // chair rail
        const sh = rangeShape(p, q, winY0, ceil);
        for (const w of Q.win) if (w.u - winW / 2 > p && w.u + winW / 2 < q) sh.holes.push(rrect(X(w.u) - winW / 2, winY0 + w.dy + 0.001, X(w.u) + winW / 2, winY1 + w.dy - 0.001, 0.12, true));
        B.add('inside', onSide(new THREE.ShapeGeometry(sh, 4), side * lin, -side), C.lining);
      }
      for (const u of doors) B.add('inside', onSide(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(X(u) - dw, dTop), new THREE.Vector2(X(u) + dw, dTop), new THREE.Vector2(X(u) + dw, ceil), new THREE.Vector2(X(u) - dw, ceil)])), side * lin, -side), C.lining);
      for (const w of Q.win) { // inner window frames
        const fr = extr(ring(X(w.u) - winW / 2, winY0 + w.dy, X(w.u) + winW / 2, winY1 + w.dy, 0.12, 0.05), 0.025, 0, 4); onSide(fr, side * (lin - 0.025), -side); B.add('inside', fr, C.partition);
      }
      // luggage rack : tube, brackets (saloon only)
      const [r0, r1] = Q.saloon, rw = side * 0.84;
      B.add('inside', cyl((r0 + r1) / 2, 2.68, rw, 0.022, r1 - r0 - 0.2, 'u', 8), C.rack);
      B.add('inside', cyl((r0 + r1) / 2, 2.6, side * (lin - 0.03), 0.018, r1 - r0 - 0.2, 'u', 8), C.rack);
      for (let k = 0; k <= Q.nBay; k++) { const u = Q.bayU0 + k * T.layout.bay; if (u < r0 + 0.1 || u > r1 - 0.1) continue; B.add('inside', tube([u, 2.6, side * (lin - 0.02)], [u, 2.68, rw], 0.015), C.rack); B.add('inside', tube([u, 2.95, side * (lin - 0.02)], [u, 2.68, rw], 0.012), C.rack); }
      B.add('glass', new THREE.PlaneGeometry(lin - 0.86, r1 - r0 - 0.2).rotateX(-Math.PI / 2).translate(side * (lin + 0.84) / 2, 2.665, -(r0 + r1) / 2));
    }
  }
  // ---- seats : extruded side profile (cushion, high back, headrest), pedestal, armrest, headrest cover
  const prof = new THREE.Shape();
  prof.moveTo(0.0, 0.40); prof.lineTo(0.5, 0.41); prof.quadraticCurveTo(0.55, 0.43, 0.52, 0.5); prof.lineTo(0.13, 0.53); prof.lineTo(0.1, 0.6); prof.lineTo(0.03, 1.15);
  prof.quadraticCurveTo(0.02, 1.27, -0.07, 1.26); prof.lineTo(-0.1, 1.2); prof.lineTo(-0.06, 0.5); prof.lineTo(0.0, 0.40);
  const seatW = 0.42;
  for (const st of Q.seats) {
    const g = extr(prof, seatW, 0.015, 4); g.translate(0, 0, -seatW / 2);
    g.rotateY(st.dir > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(st.w, F0, -st.u);
    B.add('inside', g, C.seat);
    B.add('inside', cbox(st.u + st.dir * 0.055, F0 + 1.08, st.w, 0.04, 0.2, 0.3, 0.015), C.seatHead);
    if (Math.abs(st.w) < 0.8) B.add('inside', cbox(st.u + st.dir * 0.3, F0 + 0.66, st.w - Math.sign(st.w) * 0.24, 0.42, 0.05, 0.05, 0.015), C.pedestal); // aisle armrest
  }
  for (const st of Q.seats) if (Math.abs(st.w) > 0.8) B.add('inside', cbox(st.u + st.dir * 0.26, F0 + 0.1, st.w - Math.sign(st.w) * 0.22, 0.3, 0.4, 0.8, 0.03), C.pedestal);
  // ---- fold-up seats and a luggage bar on the raised floors
  for (const b of Q.blocks) { if (b.u1 - b.u0 < 0.9 || b.w1 - b.w0 > 0.6 || Math.abs(b.w0 + b.w1) < 1.0 || b.u1 - b.u0 > 1.3) continue;
    const sd = Math.sign(b.w0 + b.w1), uc = (b.u0 + b.u1) / 2, wc = (b.w0 + b.w1) / 2;
    B.add('inside', cbox(uc, F1 + 0.46, wc, b.u1 - b.u0, 0.07, 0.42, 0.025), C.seat);
    B.add('inside', cbox(uc, F1 + 0.82, sd * (lin - 0.07), b.u1 - b.u0, 0.7, 0.05, 0.02), C.seat);
    B.add('inside', cbox(uc, F1 + 0.23, wc, b.u1 - b.u0 - 0.1, 0.46, 0.34, 0.03), C.bench);
    B.add('inside', tube([b.u0 + 0.05, F1 + 1.05, sd * (lin - 0.5)], [b.u1 - 0.05, F1 + 1.05, sd * (lin - 0.5)], 0.02), C.steel);
  }
  // ---- vestibule partitions (glass upper panes, wide opening), screens
  for (const u0 of Q.parts) {
    const pd = W.partitionDoor / 2, dir = u0 > 0 ? 1 : -1;
    const s = new THREE.Shape([new THREE.Vector2(-lin, F0), new THREE.Vector2(lin, F0), new THREE.Vector2(lin, ceil), new THREE.Vector2(-lin, ceil)]);
    s.holes.push(rrect(-pd, F0 + 0.001, pd, F0 + 2.0, 0.05, true));
    for (const sw of [-1, 1]) s.holes.push(rrect(sw > 0 ? pd + 0.15 : -lin + 0.1, F0 + 0.95, sw > 0 ? lin - 0.1 : -pd - 0.15, F0 + 1.8, 0.06, true));
    const g = extr(s, 0.06, 0, 4); g.translate(0, 0, -0.03); onEnd(g, u0, dir); B.add('inside', g, C.partition);
    for (const sw of [-1, 1]) B.add('glass', onEnd(new THREE.PlaneGeometry(lin - pd - 0.25, 0.85).translate(sw * (lin + pd) / 2, F0 + 1.375, 0), u0, dir));
    for (const face of [-1, 1]) B.add('panel', uvRect(onEnd(plane(0.64, 0.12).translate(0, F0 + 2.12, 0), u0 - face * 0.04, -face), PANEL.screen)); // screens above the doorway (both faces)
    B.add('inside', cbox(u0 - dir * 0.2, F0 + 0.02, 0, 0.4, 0.04, 2 * pd, 0.01), C.steel); // threshold
  }
  // ---- LED strips on the coves : segments, a few dead, two faulty (flicker material)
  { const lo = Q.saloon[0] - 1.6, hi = Math.min(Q.saloon[1] + 1.6, end ? Q.cab.u - 0.8 : h - 0.8);
    for (const side of [-1, 1]) {
      let k = 0;
      for (let u = lo + 0.6; u < hi; u += 1.2, k++) {
        const dead = hash(k, side, 4) > 0.86, flick = !dead && hash(k, side, 5) > 0.88;
        const g = new THREE.PlaneGeometry(0.05, 1.0); g.rotateX(Math.PI / 2); g.rotateZ(-side * 0.32); g.translate(side * 1.12, ceil - 0.005, -u);
        if (dead) B.add('panel', uvRect(g, PANEL.dead)); else B.add(flick ? 'flicker' : 'panel', uvRect(g, PANEL.led));
      }
    } }
  // ---- blood (decals : uv quarters of the blood texture)
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  { const c = Q.legroom[Math.min(1, Q.legroom.length - 1)].u, wnd = Q.win.filter((q) => !q.raised);
    B.add('decal', quarter(new THREE.PlaneGeometry(0.9, 1.5).rotateX(-Math.PI / 2).translate(0.05, F0 + 0.006, -c), 1, 0));                                      // pool in the aisle
    B.add('decal', quarter(onSide(new THREE.PlaneGeometry(0.5, 0.6).translate(sx(-1, wnd[wnd.length - 1].u + 0.95), 1.45, 0), lin - 0.005, -1), 0, 0));          // splatter, right lining
    B.add('decal', quarter(onSide(new THREE.PlaneGeometry(0.45, 0.6).translate(sx(1, wnd[0].u - 0.95), 1.75, 0), -lin + 0.005, 1), 0, 1));                      // hand print, left lining
    B.add('decal', quarter(new THREE.PlaneGeometry(0.6, 1.0).rotateX(-Math.PI / 2).translate(-0.3, F0 + 0.006, -Q.parts[0] * 1.15), 1, 1)); }                    // smear in a vestibule
  return B.merge();
}

// door leaf (plug door) : X across (thickness), Y up, Z along ; centred on its middle ; returns { leaf, glass }
export function buildDoorLeaf() {
  const T = CONFIG.train, F = T.floor, w = T.doorWidth, B = buckets();
  const s = rrect(-w / 2, F + 0.02, w / 2, F + T.doorH, 0.09);
  s.holes.push(rrect(-0.3, F + 0.95, 0.3, F + 1.8, 0.08, true));
  const g = extr(s, 0.05, 0.01, 4); g.translate(0, 0, -0.025); onSide(g, 0, 1);
  { const p = g.attributes.position, uv = g.attributes.uv, [r0, r1] = ATLAS.door; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, 1 - (r0 + (1 - (p.getY(i) - F) / T.doorH) * (r1 - r0)) / 1024); }
  B.add('body', g);
  B.add('glass', onSide(new THREE.ShapeGeometry(rrect(-0.3, F + 0.95, 0.3, F + 1.8, 0.08), 4), 0, 1));
  const out = B.merge();
  return { leaf: out.body, glass: out.glass };
}

// ------------------------------------------------------------------ lamps (nose toward +u) : two LED headlight blocks and a marker ; the tail car turns them (red material)
export function buildLampGeometry() {
  const T = CONFIG.train, h = T.cars[0] / 2, B = buckets();
  for (const sw of [-1, 1]) {
    B.add('lamp', onEnd(new THREE.ShapeGeometry(rrect(sw * 0.68 - 0.17, 1.42, sw * 0.68 + 0.17, 1.58, 0.05), 4), h + 0.012, 1));
    B.add('lamp', onEnd(new THREE.ShapeGeometry(rrect(sw * 0.4 - 0.05, 1.46, sw * 0.4 + 0.05, 1.54, 0.03), 3), h + 0.012, 1));
  }
  B.add('lamp', onEnd(new THREE.CircleGeometry(0.06, 10).translate(0, 1.95, 0), h + 0.012, 1));
  return B.merge().lamp;
}

// ------------------------------------------------------------------ cab (end car, hidden behind the windscreen) : floor, desk with screens, driver's seat
export function buildCabGeometry() {
  const T = CONFIG.train, Y = T.layout, h = T.cars[0] / 2, ub = h - Y.cab, F1 = T.floorHigh, lin = T.walk.wall + 0.01, B = buckets();
  B.add('inside', new THREE.PlaneGeometry(2 * lin, Y.cab - 0.3).rotateX(-Math.PI / 2).translate(0, F1, -(ub + h - 0.3) / 2), C.floor);
  B.add('inside', cbox(h - 1.3, F1 + 0.45, 0, 0.8, 0.9, 1.9, 0.05), C.liningLow);   // desk
  B.add('panel', uvRect(onEnd(plane(0.9, 0.3).rotateX(-0.55).translate(0, F1 + 1.0, 0), h - 1.25, -1), PANEL.screen));
  B.add('panel', uvRect(onEnd(plane(0.5, 0.25).rotateX(-0.5).translate(-0.7, F1 + 0.98, 0), h - 1.28, -1), PANEL.screen));
  B.add('inside', cbox(h - 2.5, F1 + 0.28, 0.35, 0.5, 0.55, 0.5, 0.05), C.seat);
  B.add('inside', cbox(h - 2.75, F1 + 0.78, 0.35, 0.08, 0.6, 0.46, 0.03), C.seat);
  return B.merge();
}

// ------------------------------------------------------------------ pantographs (roof of the middle cars) : raised to the wire, or lowered
export function buildPantograph(up) {
  const T = CONFIG.train, B = buckets(), yRoof = T.height + 0.02, wire = CONFIG.railNet.wire.contact, u = 0;
  B.add('dark', cbox(u, yRoof + 0.1, 0, 1.3, 0.08, 1.4, 0.02), C.steel);
  for (const s of [-1, 1]) for (const du of [-0.5, 0.5]) B.add('dark', cyl(u + du, yRoof + 0.04, s * 0.55, 0.07, 0.14, 'y', 8), C.insulator);
  const knee = up ? [u - 1.25, (yRoof + wire) / 2 + 0.1] : [u - 1.4, yRoof + 0.32], head = up ? [u, wire - 0.08] : [u + 0.2, yRoof + 0.42];
  for (const s of [-1, 1]) { B.add('dark', tube([u + 0.4, yRoof + 0.2, s * 0.35], [knee[0], knee[1], s * 0.3], 0.03), C.steel); B.add('dark', tube([knee[0], knee[1], s * 0.3], [head[0], head[1], s * 0.1], 0.022), C.steel); }
  B.add('dark', cyl(head[0], head[1], 0, 0.035, 1.6, 'w', 8), C.steel);
  for (const s of [-1, 1]) B.add('dark', tube([head[0], head[1], s * 0.8], [head[0], head[1] - 0.18, s * 0.98], 0.02), C.steel);
  B.add('dark', cbox(u + 1.2, yRoof + 0.18, 0, 1.0, 0.3, 0.7, 0.05), C.grey); // breaker
  return B.merge().dark;
}

// ------------------------------------------------------------------ blood thrown on the nose by a zombie run over (v0.82.0) : `n` splatters over the windscreen
// and the front mask, nose toward +u (parented to the car carrier by train.js)
export function buildCabBlood(n = 4) {
  const T = CONFIG.train, h = T.cars[0] / 2, Ln = T.layout.taper, out = [];
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  const at = (t) => { const S = noseSection(t); return [h - Ln + Ln * t, S.yTop]; };
  for (let k = 0; k < n; k++) {
    let g;
    if (k < 3) { // over the windscreen (left, right, then the left again larger) : a plane lying on the slope between t = 0.62 and 0.88
      const t = 0.7 + 0.04 * k, [u, y] = at(t), [u2, y2] = at(t + 0.06), slope = Math.atan2(y - y2, u2 - u); // slope : the drop angle
      const sw = k === 1 ? 1 : -1, d = 0.03 + k * 0.004;
      g = quarter(new THREE.PlaneGeometry(k === 2 ? 1.0 : 0.75, k === 2 ? 0.8 : 0.6), k === 2 ? 1 : 0, 0);
      g.rotateZ(hash(k, 5) * TAU * 0.3); g.rotateX(-Math.PI / 2 + slope); // lying on the slope, facing up and forward
      g.rotateY(Math.PI); g.scale(1, 1, 1);
      g.translate(sw * (0.45 + hash(k, 7) * 0.3), y + d, -u);
    } else { // front mask and bumper
      g = quarter(new THREE.PlaneGeometry(1.4, 0.7), 1, 1); g.rotateY(Math.PI); g.translate(0.15, 1.45, -(h + 0.03));
    }
    out.push(g);
  }
  return out;
}
