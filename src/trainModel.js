import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Train (v0.80.0, rebuilt v0.99.0) : geometry and materials, no game state. A double-decker high-speed trainset of the TGV POS type : two power cars
//  (aerodynamic pointed nose with a raked windscreen and a black mask, locked cab, machine-room louvres) and eight articulated double-decker trailers
//  sharing their Jacobs bogies at the joints, in a NEUTRAL livery : silver-grey body, dark blue lower band, thin red stripe, no logo, no brand, no text.
//  A trailer (18.7 m) : a low saloon between the bogies (floor `floor`) under the upper deck (floor `floorUp`), a vestibule at each end (floor `floorHigh`, plug
//  door on the platform side, gangway to the next car) and, in the stair zone beside it, an up-flight to the upper deck and a descent to the lower saloon.
//  Four car bodies are built : the power car (nose toward +u ; the tail power car is turned by 180 degrees), the middle trailer `tm` (door at its +u end), the
//  head trailer `th` (closed +u end : the power car is behind it) and the tail trailer `tt` (closed -u end, doors at both ends) ; plus bogies, lamps and
//  pantographs as their own small meshes : train.js draws them as InstancedMeshes.
//  Vehicle-local axes : X = w (right of the direction of travel), Y = height above the rail head, Z = -u (u : forward along the vehicle).
//  carLayouts() is pure (no Three.js) : the walkable interior used both by the meshes and by the collision boxes of train.js.
// =====================================================================

const TAU = Math.PI * 2;
const hash = (a, b, k = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ interior layout (car-local u, w ; heights above the rail head)
// A trailer is symmetric under a turn of 180 degrees (u, w -> -u, -w) : at the +u end the up-flight is on the left (w < 0), at the -u end on the right.
// e = +1 / -1 : the end ; `us` : distance of the saloon limit from the car centre ; the stair zone lies between us and h - vest.
export function carLayouts() {
  const T = CONFIG.train, W = T.walk, Y = T.layout, wall = W.wall, wt = W.wall + W.thick, gw = W.gangway / 2;
  const mk = (kind, len) => {
    const h = len / 2, pw = kind === 'pw', us = h - Y.vest - Y.stairs;
    const Q = { kind, len, h, walk: !pw, us, vest: Y.vest, stairs: Y.stairs, down: Y.down, div: Y.div, doors: [], win: [], winUp: [], legroom: [], seats: [], blocks: [], openEnds: [], closed: [], cab: null, ledU: [], boxes: { common: [], d0: [], d1: [] }, saloon: [-us, us] };
    if (pw) return Q;
    const add = (list, u0, u1, w0, w1) => list.push({ u0: Math.min(u0, u1), u1: Math.max(u0, u1), w0: Math.min(w0, w1), w1: Math.max(w0, w1) });
    const closedAt = kind === 'th' ? 1 : kind === 'tt' ? -1 : 0;
    for (const e of [1, -1]) {
      const sideUp = -e, uV = e * (h - Y.vest), uS = e * us, uE = e * h;
      if (closedAt === e) { Q.closed.push(e); Q.cab = { u: e * (h - Y.cab), dir: e }; add(Q.boxes.common, e * (h - 0.35), e * (h + 0.06), -wt, wt); }
      else {
        Q.openEnds.push(uE);
        if (e > 0) { add(Q.boxes.common, uE - 0.12, uE + T.gap / 2 + 0.05, gw, wt); add(Q.boxes.common, uE - 0.12, uE + T.gap / 2 + 0.05, -wt, -gw); }
        else { add(Q.boxes.common, uE - T.gap / 2 - 0.05, uE + 0.12, gw, wt); add(Q.boxes.common, uE - T.gap / 2 - 0.05, uE + 0.12, -wt, -gw); }
      }
      if (e > 0 || kind === 'tt') Q.doors.push(e * (h - Y.door));
      // stair zone : the divider between the flights (both decks), the closed foot of the up-flight (lower deck only : the stair mouth is open on the upper deck),
      // the rail around the descent (upper deck only)
      add(Q.boxes.common, uS, uV, sideUp * Y.div - 0.03, sideUp * Y.div + 0.03);
      add(Q.boxes.d0, uS, uS + e * 0.14, sideUp > 0 ? Y.div : -wt, sideUp > 0 ? wt : -Y.div);
      add(Q.boxes.d1, uS - e * 0.02, uV, sideUp > 0 ? -wt : -Y.div, sideUp > 0 ? Y.div : wt);
    }
    // saloon : bays of two facing rows of 2 seats on each side, an aisle between (identical on both decks)
    const nBay = Math.floor((2 * us) / Y.bay + 1e-6), u0 = -(nBay * Y.bay) / 2;
    Q.nBay = nBay; Q.bayU0 = u0;
    for (let b = 0; b < nBay; b++) {
      const a = u0 + b * Y.bay, c = a + Y.bay / 2;
      Q.win.push({ u: c, dy: 0 }); Q.winUp.push({ u: c }); Q.legroom.push({ u: c }); Q.ledU.push(c);
      for (const side of [-1, 1]) {
        for (const [ub, dir] of [[a + 0.06, 1], [a + Y.bay - 0.06, -1]]) {
          for (const wc of [0.665, 1.105]) Q.seats.push({ u: ub, dir, w: side * wc });
          add(Q.blocks, ub, ub + dir * 0.56, side > 0 ? 0.4 : -wall, side > 0 ? wall : -0.4);
        }
      }
    }
    Q.boxes.common.push(...Q.blocks);
    return Q;
  };
  const pw = mk('pw', T.cars[0]), th = mk('th', T.cars[1]), tm = mk('tm', T.cars[1]), tt = mk('tt', T.cars[1]);
  const n = T.cars.length;
  const cars = T.cars.map((_, i) => (i === 0 || i === n - 1 ? pw : i === 1 ? th : i === n - 2 ? tt : tm));
  return { pw, th, tm, tt, cars, winW: T.winW, winY0: T.winLow[0], winY1: T.winLow[1] };
}
// floor height (above the rail head) at (u, w) of a car on deck 0 / 1 : the vestibules, the stair zones (up-flight ramp beside the descent ramp), the saloons
export function floorOfCar(Q, u, w = 0, deck = 0) {
  const T = CONFIG.train;
  if (!Q.walk) return T.floorHigh;
  const au = Math.abs(u), e = u >= 0 ? 1 : -1, dV = Q.h - Q.vest; // dV : the vestibule edge
  if (au >= dV) return T.floorHigh;
  if (au >= Q.us) {
    const d = dV - au;
    if (-e * w > Q.div) return T.floorHigh + (T.floorUp - T.floorHigh) * clamp(d / Q.stairs, 0, 1); // up-flight (side -e)
    return d < Q.down ? T.floorHigh - ((T.floorHigh - T.floor) * d) / Q.down : T.floor;            // descent
  }
  return deck ? T.floorUp : T.floor;
}
// the deck a walker belongs to after moving to (u, w) : decided on the stairs, kept in the saloons
export function deckAt(Q, u, w, deck) {
  if (!Q.walk) return 0;
  const au = Math.abs(u), e = u >= 0 ? 1 : -1, dV = Q.h - Q.vest;
  if (au >= dV) return 0;
  if (au >= Q.us) return -e * w > Q.div ? (floorOfCar(Q, u, w, 0) > CONFIG.train.walk.deckMid ? 1 : 0) : 0;
  return deck;
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
// body atlas 1024 x 1024 : rows 0-511 car side (y from 0.3 to 4.3), 512-767 roof and ends (grime), 768-1023 door leaf (from the vestibule floor to doorH)
export const ATLAS = { side: [0, 512, 0.3, 4.3], roof: [512, 768], door: [768, 1024] };
function bodyTex() {
  const T = CONFIG.train;
  return canvasTex(1024, 1024, (x, W) => {
    const [r0, r1, y0m, y1m] = ATLAS.side, H = r1 - r0, py = (y) => r0 + (1 - (y - y0m) / (y1m - y0m)) * H;
    const [wl0, wl1] = T.winLow, [wu0, wu1] = T.winUp;
    // livery : silver-grey upper body, dark slate window bands (the pillars between the windows), a dark blue lower band under a thin red stripe (neutral : no logo, no brand)
    const g = x.createLinearGradient(0, r0, 0, r1); g.addColorStop(0, '#c4c9cc'); g.addColorStop(0.5, '#b4babe'); g.addColorStop(1, '#9ca2a6'); x.fillStyle = g; x.fillRect(0, r0, W, H);
    x.fillStyle = '#262d36'; x.fillRect(0, py(wl1 + 0.05), W, py(wl0 - 0.05) - py(wl1 + 0.05)); // lower deck window band
    x.fillRect(0, py(wu1 + 0.05), W, py(wu0 - 0.05) - py(wu1 + 0.05));                              // upper deck window band
    x.fillStyle = 'rgba(190,205,220,0.14)'; x.fillRect(0, py(wl1 + 0.05), W, 2); x.fillRect(0, py(wu1 + 0.05), W, 2);
    x.fillStyle = '#1b2840'; x.fillRect(0, py(0.9), W, r1 - py(0.9));                                // dark blue lower band
    x.fillStyle = '#86302c'; x.fillRect(0, py(0.97), W, py(0.9) - py(0.97));                         // thin red stripe
    for (let k = 0; k < 15; k += 1) { x.fillStyle = 'rgba(30,32,34,0.28)'; x.fillRect(Math.round((k * W) / 15), r0, 1, H); } // panel seams
    for (let k = 0; k < 260; k++) { // grime streaks running down
      const sx = hash(k, r0) * W, sy = py(wl1) + hash(r0, k) * (r1 - py(wl1)) * 0.8, sh = 12 + hash(k, 4) * 60, gs = x.createLinearGradient(0, sy, 0, sy + sh);
      gs.addColorStop(0, 'rgba(38,30,22,0.16)'); gs.addColorStop(1, 'rgba(38,30,22,0)'); x.fillStyle = gs; x.fillRect(sx, sy, 1 + hash(k, 3) * 2, sh);
    }
    for (let k = 0; k < 60; k++) { const sx = hash(k, 7) * W, sy = py(wl0), sh = 18 + hash(k, 9) * 40, gs = x.createLinearGradient(0, sy, 0, sy + sh); gs.addColorStop(0, 'rgba(92,58,30,0.22)'); gs.addColorStop(1, 'rgba(92,58,30,0)'); x.fillStyle = gs; x.fillRect(sx, sy, 2, sh); } // rust streaks under the windows
    const gd = x.createLinearGradient(0, py(1.5), 0, r1); gd.addColorStop(0, 'rgba(30,24,18,0)'); gd.addColorStop(1, 'rgba(30,24,18,0.65)'); x.fillStyle = gd; x.fillRect(0, py(1.5), W, r1 - py(1.5)); // dirt thrown up from the track
    x.fillStyle = 'rgba(85,12,10,0.55)'; x.fillRect(W * 0.37, py(1.25), 30, 26); x.fillRect(W * 0.373, py(1.0), 6, 44); // blood
    // roof and ends : grimy grey, streaks
    { const g2 = x.createLinearGradient(0, 512, 0, 768); g2.addColorStop(0, '#74777a'); g2.addColorStop(1, '#505153'); x.fillStyle = g2; x.fillRect(0, 512, W, 256); for (let k = 0; k < 240; k++) { x.fillStyle = `rgba(${20 + hash(k, 1) * 30},${18 + hash(k, 2) * 20},14,0.3)`; x.fillRect(hash(k, 3) * W, 512 + hash(k, 4) * 256, 2 + hash(k, 5) * 20, 1 + hash(k, 6) * 4); } }
    // door leaf : silver-grey, a darker window panel, dirt
    { const g3 = x.createLinearGradient(0, 768, 0, 1024); g3.addColorStop(0, '#b4babe'); g3.addColorStop(0.7, '#9da3a7'); g3.addColorStop(1, '#4b5058'); x.fillStyle = g3; x.fillRect(0, 768, W, 256);
      for (let k = 0; k < 60; k++) { x.fillStyle = `rgba(30,24,18,${0.05 + hash(k, 2) * 0.12})`; x.fillRect(hash(k, 1) * W, 768 + hash(k, 3) * 256, 2 + hash(k, 4) * 5, 14 + hash(k, 5) * 50); } }
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
    body: new THREE.MeshStandardMaterial({ map: bodyTex(), roughness: 0.5, metalness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.45 }),
    inside: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06, emissive: 0x15181c }),
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
// a flat quad from 4 corners [u, y, w] (in order around it), wound to face the point `face` : no orientation to get wrong ; UVs spread over the whole quad
function q4(a, b, c, d, face) {
  const P = (p) => [p[2], p[1], -p[0]], A = P(a), Bb = P(b), Cc = P(c), D = P(d), F = P(face);
  const n = [(Bb[1] - A[1]) * (Cc[2] - A[2]) - (Bb[2] - A[2]) * (Cc[1] - A[1]), (Bb[2] - A[2]) * (Cc[0] - A[0]) - (Bb[0] - A[0]) * (Cc[2] - A[2]), (Bb[0] - A[0]) * (Cc[1] - A[1]) - (Bb[1] - A[1]) * (Cc[0] - A[0])];
  const flip = n[0] * (F[0] - A[0]) + n[1] * (F[1] - A[1]) + n[2] * (F[2] - A[2]) < 0;
  const v = flip ? [A, Cc, Bb, A, D, Cc] : [A, Bb, Cc, A, Cc, D], g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2));
  return g;
}
// a horizontal quad u0..u1 x w0..w1 at height y, facing up (+1) or down (-1)
const hq = (u0, u1, w0, w1, y, up) => q4([u0, y, w0], [u1, y, w0], [u1, y, w1], [u0, y, w1], [(u0 + u1) / 2, y + up, (w0 + w1) / 2]);
// a vertical quad on the plane u = u0 : w0..w1 x y0..y1, facing +u (face > 0) or -u
const vq = (u0, w0, w1, y0, y1, face) => q4([u0, y0, w0], [u0, y0, w1], [u0, y1, w1], [u0, y1, w0], [u0 + face, (y0 + y1) / 2, (w0 + w1) / 2]);
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
  partition: 0x6d6f70, rack: 0x6a6e72, insulator: 0x5a2e22, grey: 0x55585b, step: 0x44474b, seatUp: 0x3a3340,
};

// ------------------------------------------------------------------ saloon window pane, cracks, shards (v0.82.0) : one lower deck window centred on u = 0,
// in the plane w = 0 facing +w (vehicle-local axes, see the header) ; train.js instances them at side * (width / 2 - 0.025), u = window centre
export function buildWindowGeometry() {
  const L = carLayouts(), w = L.winW, y0 = L.winY0, y1 = L.winY1;
  const pane = onSide(new THREE.ShapeGeometry(rrect(-w / 2, y0, w / 2, y1, 0.1), 4), 0, 1);
  const crack = onSide(new THREE.ShapeGeometry(rrect(-w / 2, y0, w / 2, y1, 0.1), 4), 0.004, 1);
  { const p = crack.attributes.position, uv = crack.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, (p.getY(i) - y0) / (y1 - y0)); }
  // shards : the frame keeps a jagged rim of glass (deterministic outline, 0.05 to 0.3 m deep)
  const s = rrect(-w / 2, y0, w / 2, y1, 0.1), hole = new THREE.Path(), n = 34, pts = [];
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

// ------------------------------------------------------------------ bogie (two axles) centred at u = 0 (train.js instances it at the pivots) : 'motor' (power car :
// traction motors, gearboxes) or 'jacobs' (trailer : the articulation bolster between two cars, air springs, brake discs)
export function buildBogieGeometry(kind = 'jacobs') {
  const B = buckets(), r = 0.46, wb = 3.0, yAx = r, g = CONFIG.railNet.gauge / 2 + 0.036, u = 0, motor = kind === 'motor';
  for (const a of [-wb / 2, wb / 2]) {
    for (const s of [-1, 1]) {
      B.add('dark', cyl(u + a, yAx, s * g, r, 0.13, 'w', 18), C.wheel);                       // wheel
      B.add('dark', cyl(u + a, yAx, s * (g + 0.075), r * 0.82, 0.03, 'w', 18), C.rust);       // rim face
      B.add('dark', cbox(u + a, yAx, s * 1.06, 0.36, 0.3, 0.22, 0.03), C.steel);                 // axle box
      for (let k = 0; k < 4; k++) B.add('dark', new THREE.TorusGeometry(0.075, 0.018, 5, 10).rotateX(Math.PI / 2).translate(s * 1.06, yAx + 0.2 + k * 0.05, -(u + a)), C.rust); // coil spring
      B.add('dark', cyl(u + a, yAx, s * (motor ? 0.62 : 0.36), r * 0.68, 0.05, 'w', 16), C.disc);               // brake disc
    }
    B.add('dark', cyl(u + a, yAx, 0, 0.08, 2 * g, 'w', 8), C.axle);                              // axle
  }
  const fs = new THREE.Shape(), L = wb / 2 + 0.55, y0 = yAx + 0.15;
  fs.moveTo(-L, y0); fs.lineTo(-L, y0 + 0.28); fs.lineTo(-0.7, y0 + 0.36); fs.lineTo(-0.5, y0 + 0.12); fs.lineTo(0.5, y0 + 0.12); fs.lineTo(0.7, y0 + 0.36); fs.lineTo(L, y0 + 0.28); fs.lineTo(L, y0); fs.lineTo(0.6, y0 - 0.05); fs.lineTo(-0.6, y0 - 0.05); fs.lineTo(-L, y0);
  for (const s of [-1, 1]) { const gf = extr(fs, 0.14, 0.02); gf.translate(0, 0, -0.07); onSide(gf, s * 1.06, 1); gf.translate(0, 0, -u); B.add('dark', gf, C.steel); }
  B.add('dark', cbox(u, yAx + 0.28, 0, 0.5, 0.24, 2.0, 0.04), C.steel);
  for (const s of [-1, 1]) { B.add('dark', cyl(u, yAx + 0.5, s * 0.95, 0.24, 0.2, 'y', 14), C.rubber); B.add('dark', tube([u - wb / 2 + 0.3, yAx + 0.1, s * 1.18], [u - 0.2, yAx + 0.5, s * 1.18], 0.035), C.black); } // air springs, dampers
  if (motor) for (const a of [-wb / 2, wb / 2]) for (const s of [-1, 1]) { B.add('dark', cyl(u + a * 0.45, yAx + 0.05, s * 0.32, 0.22, 0.62, 'w', 12), C.axle); B.add('dark', cyl(u + a * 0.7, yAx + 0.02, s * 0.32, 0.12, 0.3, 'w', 10), C.steel); } // traction motors and gearboxes
  else { B.add('dark', cbox(u, yAx + 0.7, 0, 0.9, 0.16, 1.1, 0.04), C.steel); B.add('dark', cyl(u, yAx + 0.8, 0, 0.2, 0.2, 'y', 14), C.black); } // articulation bolster and pivot
  return B.merge().dark;
}

// ------------------------------------------------------------------ nose (power car) : a loft of cross-sections from the flat body to the pointed front
// The ring of the body section (rounded roof, vertical sides) is scaled, lowered and narrowed toward the front ; the raked part of the top is the windscreen
// (its own material), the lowest slices are the black mask. noseSection() is shared by the lamps and the blood decals.
const NOSE_T = [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.88, 0.94, 1.0];   // slices (t : 0 at the end of the flat body, 1 at the tip)
const NOSE_TOP = [[0, 1], [0.15, 0.985], [0.3, 0.93], [0.44, 0.85], [0.6, 0.7], [0.8, 0.56], [0.92, 0.5], [1, 0.46]]; // top height (fraction of the car height) along t
const lerpKeys = (K, t) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const a = K[i - 1], b = K[i], k = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * k; } return K[K.length - 1][1]; };
export function noseSection(t) { // { fw : half-width factor, yBot, yTop, round }
  const T = CONFIG.train;
  return { fw: 1 - 0.52 * Math.pow(t, 1.9), yBot: 0.5 + 0.5 * Math.pow(t, 3), yTop: T.powerHeight * lerpKeys(NOSE_TOP, t), round: 0.7 * Math.pow(t, 1.2) };
}
const ROOF_OLD = [[1.45, 3.25], [1.44, 3.45], [1.4, 3.62], [1.31, 3.77], [1.17, 3.88], [0.93, 3.97], [0.58, 4.03], [0.2, 4.05], [-0.2, 4.05], [-0.58, 4.03], [-0.93, 3.97], [-1.17, 3.88], [-1.31, 3.77], [-1.4, 3.62], [-1.44, 3.45], [-1.45, 3.25]];
function roofProfile(H, yc) { // the cant rail curve and the crown : from (Wd, yc) to (-Wd, yc)
  const Wd = CONFIG.train.width / 2;
  return ROOF_OLD.map(([w, y]) => [(w * Wd) / 1.45, yc + ((y - 3.25) * (H - yc)) / 0.8]);
}
function buildNose(B, u0, Ln, yb, yc) {
  const T = CONFIG.train, Wd = T.width / 2, Ht = T.powerHeight, prof = roofProfile(Ht, yc);
  // base ring (w, y), counter-clockwise seen from the front : bottom right, right side up, roof right to left, left side down, bottom left
  const base = [[Wd, yb], [Wd, yb + (yc - yb) / 3], [Wd, yb + (2 * (yc - yb)) / 3], ...prof, [-Wd, yb + (2 * (yc - yb)) / 3], [-Wd, yb + (yc - yb) / 3], [-Wd, yb]];
  const n = base.length;
  const isTop = base.map(([w, y]) => y >= yc + 0.1 && Math.abs(w) < 1.2); // the windscreen band of the ring
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
  const add = (set, i, j) => {
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
    const tm = (NOSE_T[i] + NOSE_T[i + 1]) / 2, top = isTop[j] && isTop[(j + 1) % n], near = isTop[(j + n - 1) % n] || isTop[(j + 2) % n] || isTop[j] || isTop[(j + 1) % n];
    let set = 'body';
    if (tm >= 0.84) set = 'mask';
    else if (tm >= 0.44 && top) set = 'screen';
    else if (tm >= 0.4 && near) set = 'frame';
    add(set, i, j);
  }
  const mk = (idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals(); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ns * n * 2), 2)); return g; };
  if (sets.body.length) B.add('body', uvSide(mk(sets.body), ATLAS.side, T.cars[0]));
  if (sets.frame.length) B.add('dark', mk(sets.frame), C.rubber);
  if (sets.screen.length) B.add('screen', mk(sets.screen));
  if (sets.mask.length) B.add('dark', mk(sets.mask), C.black);
  // front cap (flat, black mask) at the last slice
  { const i = ns - 1, idx = []; for (let j = 1; j < n - 1; j++) { const a = i * n, b = i * n + j, d = i * n + j + 1; const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], fx = P[d * 3] - P[a * 3], fy = P[d * 3 + 1] - P[a * 3 + 1]; idx.push(...((ex * fy - ey * fx) * -1 > 0 ? [a, b, d] : [a, d, b])); } B.add('dark', mk(idx), C.black); }
  return { P, n, ns, base };
}

// ------------------------------------------------------------------ car body
// kind : 'pw' (power car, nose toward +u) | 'tm' | 'th' | 'tt' (trailers) ; returns { body, dark, inside, glass, screen, panel, flicker, decal }
export function buildCarGeometry(kind) {
  const T = CONFIG.train, W = T.walk, Y = T.layout, Lay = carLayouts(), Q = Lay[kind], L = Q.len, h = Q.h, Wd = T.width / 2, B = buckets();
  const pw = kind === 'pw', H = pw ? T.powerHeight : T.height, yb = 0.5, yc = pw ? 3.4 : 3.6, lin = W.wall + 0.01;
  const F0 = T.floor, Fv = T.floorHigh, Fu = T.floorUp, cl = T.ceilLow, cu = T.ceilUp, cv = Fv + 2.05;
  const dw = T.doorWidth / 2, dTop = Fv + T.doorH, winW = T.winW, [wl0, wl1] = T.winLow, [wu0, wu1] = T.winUp;
  const uF = pw ? h - Y.nose : h, uA = -h; // flat body from uA to uF
  const prof = roofProfile(H, yc);
  const outline = (k, path) => { // the outline of the body section (scaled about its centre by k)
    const cy = (yb + H) / 2, s = path ? new THREE.Path() : new THREE.Shape();
    [[-Wd, yb], [Wd, yb], ...prof].forEach(([w, y], i) => { const X = w * k, Yy = cy + (y - cy) * k; if (i) s.lineTo(X, Yy); else s.moveTo(X, Yy); });
    return s;
  };
  // ---- sides : skin with window and door openings (extruded), gaskets, door frames, handrails, buttons
  for (const side of [-1, 1]) {
    const X = (u) => sx(side, u);
    const x0 = Math.min(X(uA), X(uF)), x1 = Math.max(X(uA), X(uF));
    const s = new THREE.Shape([new THREE.Vector2(x0, yb), new THREE.Vector2(x1, yb), new THREE.Vector2(x1, yc), new THREE.Vector2(x0, yc)]);
    for (const q of Q.win) s.holes.push(rrect(X(q.u) - winW / 2, wl0, X(q.u) + winW / 2, wl1, 0.1, true));
    for (const q of Q.winUp) s.holes.push(rrect(X(q.u) - winW / 2, wu0, X(q.u) + winW / 2, wu1, 0.1, true));
    for (const u of Q.doors) s.holes.push(rrect(X(u) - dw, Fv + 0.02, X(u) + dw, dTop, 0.1, true));
    if (pw) s.holes.push(rrect(X(uF - 0.6) - 0.3, 2.5, X(uF - 0.6) + 0.3, 3.2, 0.08, true)); // cab side window
    const g = extr(s, Wd - lin - 0.02, 0, 4); onSide(g, side > 0 ? lin + 0.02 : -lin - 0.02, side);
    B.add('body', uvSide(g, ATLAS.side, L));
    for (const q of Q.win) { const gk = extr(ring(X(q.u) - winW / 2, wl0, X(q.u) + winW / 2, wl1, 0.1, 0.045), 0.02, 0, 4); onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber); } // (the lower panes are their own instances : a window can crack and break, buildWindowGeometry)
    for (const q of Q.winUp) {
      const gk = extr(ring(X(q.u) - winW / 2, wu0, X(q.u) + winW / 2, wu1, 0.1, 0.045), 0.02, 0, 4); onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber);
      B.add('glass', onSide(new THREE.ShapeGeometry(rrect(X(q.u) - winW / 2, wu0, X(q.u) + winW / 2, wu1, 0.1), 4), side * (Wd - 0.025), side));
    }
    for (const u of Q.doors) {
      const fr = extr(ring(X(u) - dw, Fv + 0.02, X(u) + dw, dTop, 0.1, 0.07), 0.03, 0, 4); onSide(fr, side * Wd, side); B.add('dark', fr, C.grey);
      for (const e of [-1, 1]) B.add('dark', tube([u + e * (dw + 0.16), Fv + 0.2, side * (Wd + 0.07)], [u + e * (dw + 0.16), Fv + 1.65, side * (Wd + 0.07)], 0.02), C.steel); // handrails
      B.add('dark', cbox(u, Fv - 0.03, side * (Wd - 0.04), T.doorWidth + 0.1, 0.05, 0.2, 0.012), C.steel); // threshold plate
      B.add('dark', cbox(u, Fv - 0.012, side * (Wd + 0.02), T.doorWidth, 0.014, 0.05, 0.004), C.yellow);  // edge band
      B.add('dark', cbox(u, 0.86, side * (Wd + 0.1), T.doorWidth + 0.04, 0.05, 0.3, 0.012), C.steel);    // folding step
      B.add('dark', cbox(u, 0.89, side * (Wd + 0.235), T.doorWidth + 0.04, 0.012, 0.03, 0.004), C.yellow);
      const dirIn = u > 0 ? -1 : 1;
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.045, 12).translate(X(u + dirIn * (dw + 0.3)), 1.85, 0), side * (Wd + 0.012), side), PANEL.button)); // outer door button
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.04, 12).translate(X(u + dirIn * (dw + 0.25)), 1.95, 0), side * (lin - 0.012), -side), PANEL.button)); // inner door button
    }
    if (pw) { // cab door and mirror, machine-room louvres
      const cuD = uF - 1.8, fr = extr(ring(X(cuD) - 0.45, 0.95, X(cuD) + 0.45, 3.1, 0.06, 0.04), 0.02, 0, 4); onSide(fr, side * Wd, side); B.add('dark', fr, C.grey); // cab door outline
      const wf = extr(ring(X(uF - 0.6) - 0.3, 2.5, X(uF - 0.6) + 0.3, 3.2, 0.08, 0.04), 0.02, 0, 4); onSide(wf, side * Wd, side); B.add('dark', wf, C.rubber);
      B.add('panel', uvPanel(onSide(new THREE.ShapeGeometry(rrect(X(uF - 0.6) - 0.3, 2.5, X(uF - 0.6) + 0.3, 3.2, 0.08), 4), side * (Wd - 0.03), side), PANEL.cab)); // dark glass of the cab window
      B.add('dark', tube([cuD - 0.38, 1.6, side * (Wd + 0.06)], [cuD - 0.38, 2.5, side * (Wd + 0.06)], 0.018), C.steel);
      B.add('dark', tube([uF - 0.2, 3.0, side * (Wd + 0.02)], [uF + 0.05, 2.95, side * (Wd + 0.34)], 0.02), C.black); // mirror arm
      B.add('dark', cbox(uF + 0.09, 2.95, side * (Wd + 0.37), 0.07, 0.3, 0.12, 0.02), C.black);                       // mirror
      for (let k = 0; k < 5; k++) { // louvres of the machine room : a recessed grille with slats
        const uc = -h + 2.6 + k * 2.55;
        B.add('dark', cbox(uc, 2.05, side * (Wd - 0.01), 2.0, 1.55, 0.06, 0.02), C.black);
        for (let q = 0; q < 6; q++) B.add('dark', cbox(uc, 1.45 + q * 0.24, side * (Wd + 0.012), 1.9, 0.045, 0.03, 0.01), C.steel);
      }
    }
    B.add('dark', cbox((uA + uF) / 2, yc + 0.02, side * (Wd - 0.02), uF - uA, 0.06, 0.08, 0.02), C.steel); // gutter at the cant rail
    B.add('dark', cbox((uA + uF) / 2, yb + 0.03, side * (Wd - 0.03), uF - uA - 0.3, 0.07, 0.07, 0.02), C.black); // solebar edge
  }
  // ---- roof : swept profile (cant rail curve, flat crown), equipment
  {
    const pos = [];
    for (let i = 1; i < prof.length; i++) { const [w0, y0] = prof[i - 1], [w1, y1] = prof[i], A = [w0, y0, -uF], Bp = [w1, y1, -uF], Cp = [w1, y1, -uA], D = [w0, y0, -uA]; pos.push(...A, ...Bp, ...Cp, ...A, ...Cp, ...D); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); g.computeVertexNormals();
    B.add('body', uvRegion(g, ATLAS.roof, (x, y, z) => (-z + h) / L, (x) => (x + Wd) / (2 * Wd)));
    B.add('dark', cbox((uA + uF) / 2, H + 0.015, 0.92, uF - uA - 1.5, 0.04, 0.3, 0.01), C.grey); // cable duct
    if (pw) { // cooling grids
      for (const u of [-6.8, -2.6, 1.4]) { B.add('dark', cbox(u, H + 0.07, 0, 2.6, 0.2, 1.7, 0.05), C.grey); for (let k = 0; k < 7; k++) B.add('dark', cbox(u - 1.0 + k * 0.33, H + 0.18, 0, 0.05, 0.03, 1.4, 0.01), C.black); }
    } else {
      for (const u of [-3.4, 1.0]) { B.add('dark', cbox(u, H + 0.08, 0, 2.2, 0.22, 1.5, 0.06), C.grey); for (let k = 0; k < 5; k++) B.add('dark', cbox(u - 0.8 + k * 0.4, H + 0.2, 0, 0.05, 0.03, 1.2, 0.01), C.black); }
    }
  }
  // ---- both ends of the car : the end plate (with the gangway opening when open), the rubber frame of the bellows around the joint
  const gw = W.gangway / 2, gh = cv - Fv - 0.1;
  for (const e of [1, -1]) {
    if (pw && e > 0) continue; // (the nose)
    const uE = e * h, closed = pw ? true : Q.closed.includes(e), gapE = pw || (kind === 'th' && e > 0) || (kind === 'tt' && e < 0) ? T.gapPower : T.gap;
    const s = outline(1);
    if (!closed) s.holes.push(rrect(-gw, Fv + 0.01, gw, Fv + gh, 0.08, true));
    const g = extr(s, 0.08, 0, 6); g.translate(0, 0, -0.04); onEnd(g, uE - e * 0.04, e);
    B.add('body', uvRegion(g, ATLAS.roof, (x) => (x + Wd) / (2 * Wd), (x, y) => (y - yb) / (H - yb)));
    const rs = outline(0.99); rs.holes.push(outline(0.9, true));   // the rubber frame between two cars
    const rg = extr(rs, gapE / 2 + 0.03, 0, 6); rg.translate(0, 0, -(gapE / 2 + 0.03) / 2); onEnd(rg, uE + e * (gapE / 4 - 0.015), e); B.add('dark', rg, C.rubber);
    if (pw) continue;
    if (!closed) { // gangway : corrugated bellows rings, floor plate, lining of the opening
      for (let k = 0; k < 4; k++) {
        const o = 0.07 + (k % 2) * 0.05, b0 = uE + e * (0.04 + k * 0.07);
        const r = extr(ring(-gw - 0.05, Fv - 0.02, gw + 0.05, Fv + gh + 0.1, 0.12, o + 0.12), 0.07, 0, 4); r.translate(0, 0, -0.035); onEnd(r, b0 + e * 0.035, e); B.add('dark', r, C.rubber);
      }
      B.add('dark', cbox(uE + e * 0.2, Fv - 0.02, 0, 0.4, 0.04, W.gangway + 0.1, 0.01), C.steel);
      const yT = cv - 0.1, yO = Fv + gh, sideW = lin - gw; // three quads around the opening (a Shape with a hole is triangulated across it)
      for (const [w, hh, cx, cy] of [[sideW, yT - Fv, -(lin + gw) / 2, (Fv + yT) / 2], [sideW, yT - Fv, (lin + gw) / 2, (Fv + yT) / 2], [2 * gw, yT - yO, 0, (yO + yT) / 2]]) B.add('inside', onEnd(plane(w, hh).translate(cx, cy, 0), uE - e * 0.09, -e), C.partition);
      const rv = extr(ring(-gw, Fv + 0.01, gw, Fv + gh, 0.08, 0.04), 0.12, 0, 4); rv.translate(0, 0, -0.06); onEnd(rv, uE - e * 0.05, e); B.add('inside', rv, C.rack);
      for (const sw of [-1, 1]) B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.07, 10).translate(sw * 1.15, 1.6, 0), uE + e * 0.005, e), PANEL.red));
    } else { // the closed end : a bulkhead with a locked service door
      const ub = Q.cab.u, pdw = 0.45, s2 = new THREE.Shape([new THREE.Vector2(-lin, Fv), new THREE.Vector2(lin, Fv), new THREE.Vector2(lin, cv), new THREE.Vector2(-lin, cv)]);
      s2.holes.push(rrect(-pdw, Fv + 0.001, pdw, Fv + 1.95, 0.05, true));
      const gb = extr(s2, 0.06, 0, 4); gb.translate(0, 0, -0.03); onEnd(gb, ub, e); B.add('inside', gb, C.partition);
      B.add('inside', cbox(ub - e * 0.04, Fv + 0.01, 0, 0.14, 0.02, 2 * pdw + 0.06, 0.005), C.steel);
      B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.05, 12).translate(-0.72, Fv + 1.25, 0), ub - e * 0.034, -e), PANEL.red));
      B.add('panel', uvRect(onEnd(plane(0.64, 0.12).translate(0, Fv + 2.0, 0), ub - e * 0.04, -e), PANEL.screen));
    }
  }
  // ---- the nose of the power car ; underframe : the hull bottom, skirts, equipment boxes
  if (pw) {
    buildNose(B, uF, Y.nose, yb, yc);
    B.add('dark', cbox(h - 0.5, 0.78, 0, 0.5, 0.3, 1.0, 0.08), C.black);              // coupler cover
    for (const sw of [-1, 1]) B.add('dark', cyl(h - 0.3, 0.9, sw * 0.4, 0.035, 0.1, 'u', 8), C.steel);
    for (const sw of [-1, 1]) B.add('dark', tube([h - 2.1, 2.95, sw * 0.32], [h - 1.7, 2.82, sw * 0.82], 0.014), C.black); // wipers
    const sk = (u0, u1) => B.add('dark', cbox((u0 + u1) / 2, yb - 0.12, 0, u1 - u0, 0.3, 2 * Wd - 0.3, 0.05), C.axle);
    sk(-h + 0.4, -h + 3.8); sk(-3.2, 3.2); sk(h - Y.nose - 3.8, h - Y.nose - 0.4);
  } else {
    for (const u of [-3.6, -0.3, 3.0]) B.add('dark', cbox(u, yb - 0.1, 0, 2.2, 0.28, 1.9, 0.05), C.axle);
  }
  B.add('dark', hq(uA, uF, -Wd + 0.1, Wd - 0.1, yb, -1), C.black);  // underside of the hull
  for (const s of [-1, 1]) B.add('dark', cbox((uA + uF) / 2, yb - 0.04, s * (Wd - 0.18), uF - uA - 3, 0.12, 0.08, 0.02), C.black);
  if (pw) return B.merge();

  // ================================================================ trailer interior
  // floors, ceilings, the upper deck slab, the stair zones, linings, seats, racks, LED strips
  const us = Q.us, dV = h - Q.vest;
  // lower saloon : floor and aisle, ceiling = underside of the upper deck ; upper saloon : floor, cove ceiling
  B.add('inside', hq(-us, us, -lin, lin, F0, 1), C.floor);
  B.add('inside', hq(-us, us, -0.37, 0.37, F0 + 0.002, 1), C.aisle);
  B.add('inside', hq(-us, us, -lin, lin, cl, -1), C.ceiling);
  B.add('inside', hq(-us, us, -lin, lin, Fu, 1), C.floor);
  B.add('inside', hq(-us, us, -0.37, 0.37, Fu + 0.002, 1), C.aisle);
  { // cove of the upper saloon ceiling (a polyline across the section, swept along u)
    const cv2 = [[lin, 3.5], [1.2, 3.8], [0.95, 4.0], [0.65, cu], [-0.65, cu], [-0.95, 4.0], [-1.2, 3.8], [-lin, 3.5]];
    for (let i = 1; i < cv2.length; i++) B.add('inside', q4([-us, cv2[i - 1][1], cv2[i - 1][0]], [us, cv2[i - 1][1], cv2[i - 1][0]], [us, cv2[i][1], cv2[i][0]], [-us, cv2[i][1], cv2[i][0]], [0, 3.0, 0]), C.ceiling);
  }
  for (const e of [1, -1]) {
    const sideUp = -e, uV = e * dV, uS = e * us, uE = e * h, ws = (a, b) => [Math.min(a, b), Math.max(a, b)];
    // vestibule : floor, ceiling
    B.add('inside', hq(Math.min(uV, uE), Math.max(uV, uE), -lin, lin, Fv, 1), C.floor);
    B.add('inside', hq(Math.min(uV, uE), Math.max(uV, uE), -lin, lin, cv, -1), C.ceiling);
    // stair zone : descent side (flat ceiling, floor ramp as steps, landing), up-flight side (steps, inclined ceiling)
    const wUp = ws(sideUp * (Y.div + 0.03), sideUp * lin), wDn = ws(-sideUp * lin, sideUp * (Y.div - 0.03));
    const nUp = 7, rise = (Fu - Fv) / nUp, run = Y.stairs / nUp;
    for (let k = 0; k < nUp; k++) { // up-flight steps : solid blocks from the lower floor up to the tread
      const d0 = dV - k * run, d1 = dV - (k + 1) * run, top = Fv + (k + 1) * rise;
      B.add('inside', cbox(e * (d0 + d1) / 2, (F0 + top) / 2, (wUp[0] + wUp[1]) / 2, run, top - F0, wUp[1] - wUp[0], 0.008), C.step);
      B.add('inside', cbox(e * (d0 + d1) / 2, top + 0.002, (wUp[0] + wUp[1]) / 2, run * 0.98, 0.012, wUp[1] - wUp[0] - 0.02, 0.003), C.aisle);
    }
    const nDn = 3, runD = Y.down / nDn, riseD = (Fv - F0) / nDn;
    for (let k = 0; k < nDn - 1; k++) { // descent steps (the last one is the saloon floor)
      const d0 = dV - k * runD, d1 = dV - (k + 1) * runD, top = Fv - (k + 1) * riseD;
      B.add('inside', cbox(e * (d0 + d1) / 2, (F0 + top) / 2, (wDn[0] + wDn[1]) / 2, runD, top - F0, wDn[1] - wDn[0], 0.008), C.step);
      B.add('inside', cbox(e * (d0 + d1) / 2, top + 0.002, (wDn[0] + wDn[1]) / 2, runD * 0.98, 0.012, wDn[1] - wDn[0] - 0.02, 0.003), C.aisle);
    }
    B.add('inside', hq(Math.min(uS, e * (dV - Y.down)), Math.max(uS, e * (dV - Y.down)), wDn[0], wDn[1], F0, 1), C.floor);   // descent landing
    B.add('dark', cbox(e * (dV - Y.down), Fv + 0.003, (wDn[0] + wDn[1]) / 2, 0.04, 0.01, wDn[1] - wDn[0], 0.003), C.yellow);   // nosing at the head of the descent
    B.add('inside', hq(Math.min(uS, uV), Math.max(uS, uV), wDn[0], wDn[1], cv, -1), C.ceiling);
    B.add('inside', q4([uV, cv, wUp[0]], [uV, cv, wUp[1]], [uS, cu, wUp[1]], [uS, cu, wUp[0]], [e * (dV - 1), 2.5, sideUp * 0.9]), C.ceiling);
    // walls : the lower saloon end under the up-flight, the upper saloon end partition (over the descent), the divider panel, the handrail along the stairs
    B.add('inside', vq(uS, wUp[0] - 0.03, wUp[1] + 0.03, F0, cl, -e), C.liningLow);
    B.add('inside', vq(uS, wDn[0], wDn[1] + 0.06, cl, cu, -e), C.partition);   // (upper saloon side)
    B.add('inside', vq(uS, wDn[0], wDn[1] + 0.06, cl, cv, e), C.partition);    // (from the descent)
    B.add('inside', vq(uS, wUp[0], wUp[1], cl, Fu, e), C.liningLow);
    for (const f of [0.1, 1.0]) B.add('inside', q4([uV, Fv, sideUp * Y.div], [uS, Fu, sideUp * Y.div], [uS, Fu + 0.9, sideUp * Y.div], [uV, Fv + 0.9, sideUp * Y.div], [e * dV, 1.5, sideUp * f * (f < 0.5 ? 0.1 : 1.0)]), C.liningLow); // divider, both faces
    B.add('inside', tube([uV, Fv + 0.95, sideUp * Y.div], [uS, Fu + 0.95, sideUp * Y.div], 0.022), C.steel);
    // LED strip in the vestibule
    B.add('panel', uvRect(hq(Math.min(uV, uE) + 0.4, Math.max(uV, uE) - 0.4, -0.1, 0.1, cv - 0.005, -1), PANEL.led));
  }
  // linings : lower saloon (windows), upper saloon (windows), end zones (door holes), facing inward
  for (const side of [-1, 1]) {
    const X = (u) => sx(-side, u); // (the linings face inward : onSide(-side))
    const rect = (p, q, y0, y1) => new THREE.Shape([new THREE.Vector2(Math.min(X(p), X(q)), y0), new THREE.Vector2(Math.max(X(p), X(q)), y0), new THREE.Vector2(Math.max(X(p), X(q)), y1), new THREE.Vector2(Math.min(X(p), X(q)), y1)]);
    const put = (sh, col, off = 0) => B.add('inside', onSide(new THREE.ShapeGeometry(sh, 4), side * (lin - off), -side), col);
    // lower saloon
    { const sh = rect(-us, us, F0, cl); for (const w of Q.win) sh.holes.push(rrect(X(w.u) - winW / 2, wl0, X(w.u) + winW / 2, wl1, 0.1, true)); put(sh, C.lining); put(rect(-us, us, F0 + 0.5, F0 + 0.53), C.rack, 0.01); }
    // upper saloon : to the cove start
    { const sh = rect(-us, us, Fu, 3.5); for (const w of Q.winUp) sh.holes.push(rrect(X(w.u) - winW / 2, wu0, X(w.u) + winW / 2, wu1, 0.1, true)); put(sh, C.lining); put(rect(-us, us, Fu + 0.5, Fu + 0.53), C.rack, 0.01); }
    for (const w of Q.win) { const fr = extr(ring(X(w.u) - winW / 2, wl0, X(w.u) + winW / 2, wl1, 0.1, 0.05), 0.025, 0, 4); onSide(fr, side * (lin - 0.025), -side); B.add('inside', fr, C.partition); }
    for (const w of Q.winUp) { const fr = extr(ring(X(w.u) - winW / 2, wu0, X(w.u) + winW / 2, wu1, 0.1, 0.05), 0.025, 0, 4); onSide(fr, side * (lin - 0.025), -side); B.add('inside', fr, C.partition); }
    // end zones (vestibule + stairs) : full height wall, a hole for the door
    for (const e of [1, -1]) {
      const a = e * us, b = e * h, door = Q.doors.find((d) => Math.sign(d) === e);
      const sh = rect(a, b, F0, cu);
      if (door != null) sh.holes.push(rrect(X(door) - dw, Fv + 0.02, X(door) + dw, dTop, 0.1, true));
      put(sh, C.lining);
      if (door != null) put(rect(door - dw, door + dw, dTop, cv), C.lining, 0.002);
    }
    // luggage racks : tube and brackets along each deck
    for (const [y, u0, u1] of [[2.0, -us + 0.1, us - 0.1], [Fu + 1.3, -us + 0.1, us - 0.1]]) {
      B.add('inside', cyl((u0 + u1) / 2, y, side * 1.12, 0.022, u1 - u0, 'u', 8), C.rack);
      B.add('inside', cyl((u0 + u1) / 2, y - 0.07, side * (lin - 0.03), 0.018, u1 - u0, 'u', 8), C.rack);
      for (let k = 0; k <= Q.nBay; k++) { const u = Q.bayU0 + k * Y.bay; B.add('inside', tube([u, y - 0.07, side * (lin - 0.02)], [u, y, side * 1.12], 0.015), C.rack); }
    }
  }
  // ---- seats : extruded side profile (cushion, high back, headrest), pedestal, armrest, headrest cover ; the same layout on both decks
  const sprof = new THREE.Shape();
  sprof.moveTo(0.0, 0.40); sprof.lineTo(0.5, 0.41); sprof.quadraticCurveTo(0.55, 0.43, 0.52, 0.5); sprof.lineTo(0.13, 0.53); sprof.lineTo(0.1, 0.6); sprof.lineTo(0.03, 1.1);
  sprof.quadraticCurveTo(0.02, 1.2, -0.07, 1.19); sprof.lineTo(-0.1, 1.13); sprof.lineTo(-0.06, 0.5); sprof.lineTo(0.0, 0.40);
  const seatW = 0.42;
  for (const [fl, col] of [[F0, C.seat], [Fu, C.seatUp]]) {
    for (const st of Q.seats) {
      const g = extr(sprof, seatW, 0.012, 2); g.translate(0, 0, -seatW / 2);
      g.rotateY(st.dir > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(st.w, fl, -st.u);
      B.add('inside', g, col);
      B.add('inside', cbox(st.u + st.dir * 0.055, fl + 1.02, st.w, 0.04, 0.18, 0.3, 0.012), C.seatHead);
      if (Math.abs(st.w) < 0.8) B.add('inside', cbox(st.u + st.dir * 0.3, fl + 0.64, st.w - Math.sign(st.w) * 0.24, 0.42, 0.05, 0.05, 0.015), C.pedestal); // aisle armrest
      else B.add('inside', cbox(st.u + st.dir * 0.26, fl + 0.1, st.w - Math.sign(st.w) * 0.22, 0.3, 0.4, 0.8, 0.03), C.pedestal);
    }
  }
  // ---- LED strips on the ceilings : segments, a few dead, two faulty (flicker material) ; lower saloon, upper saloon
  { let k = 0;
    for (const c of Q.ledU) for (const [y, side0] of [[cl - 0.005, 0.8], [cu - 0.005, 0.62]]) for (const side of [-1, 1]) {
      const dead = hash(k, side, 4) > 0.9, flick = !dead && hash(k, side, 5) > 0.9; k++;
      const g = hq(c - 0.6, c + 0.6, side * side0 - 0.05, side * side0 + 0.05, y, -1);
      if (dead) B.add('panel', uvRect(g, PANEL.dead)); else B.add(flick ? 'flicker' : 'panel', uvRect(g, PANEL.led));
    } }
  // ---- blood (decals : uv quarters of the blood texture)
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  { const c = Q.legroom[Math.min(1, Q.legroom.length - 1)].u;
    B.add('decal', quarter(new THREE.PlaneGeometry(0.9, 1.5).rotateX(-Math.PI / 2).translate(0.05, F0 + 0.006, -c), 1, 0));                                      // pool in the aisle
    B.add('decal', quarter(new THREE.PlaneGeometry(0.9, 1.5).rotateX(-Math.PI / 2).translate(-0.1, Fu + 0.006, -(c - 2.0)), 0, 1));                              // smear on the upper deck
    B.add('decal', quarter(onSide(new THREE.PlaneGeometry(0.5, 0.6).translate(sx(-1, c + 0.95), 1.45, 0), lin - 0.005, -1), 0, 0));                           // splatter, right lining
    B.add('decal', quarter(new THREE.PlaneGeometry(0.6, 1.0).rotateX(-Math.PI / 2).translate(-0.3, Fv + 0.006, -(dV + 0.8)), 1, 1)); }                          // smear in a vestibule
  return B.merge();
}

// door leaf (plug door) : X across (thickness), Y up, Z along ; centred on its middle ; returns { leaf, glass }
export function buildDoorLeaf() {
  const T = CONFIG.train, F = T.floorHigh, w = T.doorWidth, B = buckets();
  const s = rrect(-w / 2, F + 0.02, w / 2, F + T.doorH, 0.09);
  s.holes.push(rrect(-0.27, F + 0.85, 0.27, F + 1.7, 0.08, true));
  const g = extr(s, 0.05, 0.01, 4); g.translate(0, 0, -0.025); onSide(g, 0, 1);
  { const p = g.attributes.position, uv = g.attributes.uv, [r0, r1] = ATLAS.door; for (let i = 0; i < p.count; i++) uv.setXY(i, (-p.getZ(i) + w / 2) / w, 1 - (r0 + (1 - (p.getY(i) - F) / T.doorH) * (r1 - r0)) / 1024); }
  B.add('body', g);
  B.add('glass', onSide(new THREE.ShapeGeometry(rrect(-0.27, F + 0.85, 0.27, F + 1.7, 0.08), 4), 0, 1));
  const out = B.merge();
  return { leaf: out.body, glass: out.glass };
}

// ------------------------------------------------------------------ lamps (nose toward +u) : two LED headlight blocks and a marker ; the tail power car turns them (red material)
export function buildLampGeometry() {
  const T = CONFIG.train, h = T.cars[0] / 2, B = buckets();
  for (const sw of [-1, 1]) {
    B.add('lamp', onEnd(new THREE.ShapeGeometry(rrect(sw * 0.4 - 0.15, 1.16, sw * 0.4 + 0.15, 1.32, 0.05), 4), h + 0.012, 1));
    B.add('lamp', onEnd(new THREE.ShapeGeometry(rrect(sw * 0.18 - 0.04, 1.2, sw * 0.18 + 0.04, 1.28, 0.03), 3), h + 0.012, 1));
  }
  B.add('lamp', onEnd(new THREE.CircleGeometry(0.05, 10).translate(0, 1.66, 0), h + 0.012, 1));
  return B.merge().lamp;
}

// ------------------------------------------------------------------ pantographs (roof of the trailers next to the power cars) : raised to the wire, or lowered
export function buildPantograph(up) {
  const T = CONFIG.train, B = buckets(), yRoof = T.height + 0.02, wire = CONFIG.railNet.wire.contact, u = 0;
  B.add('dark', cbox(u, yRoof + 0.1, 0, 1.3, 0.08, 1.4, 0.02), C.steel);
  for (const s of [-1, 1]) for (const du of [-0.5, 0.5]) B.add('dark', cyl(u + du, yRoof + 0.04, s * 0.55, 0.07, 0.14, 'y', 8), C.insulator);
  const knee = up ? [u - 1.25, (yRoof + wire) / 2 + 0.1] : [u - 1.4, yRoof + 0.32], head = up ? [u, wire - 0.08] : [u + 0.2, yRoof + 0.42];
  for (const s of [-1, 1]) { B.add('dark', tube([u + 0.4, yRoof + 0.2, s * 0.35], [knee[0], knee[1], s * 0.3], 0.03), C.steel); B.add('dark', tube([knee[0], knee[1], s * 0.3], [head[0], head[1], s * 0.1], 0.022), C.steel); }
  B.add('dark', cyl(head[0], head[1], 0, 0.035, 1.6, 'w', 8), C.steel);
  for (const s of [-1, 1]) B.add('dark', tube([head[0], head[1], s * 0.8], [head[0], head[1] - 0.18, s * 0.98], 0.02), C.steel);
  B.add('dark', cbox(u + 1.6, yRoof + 0.2, 0, 1.0, 0.34, 0.7, 0.05), C.grey); // breaker
  for (const du of [1.2, 2.0]) B.add('dark', cyl(u + du, yRoof + 0.08, 0, 0.1, 0.16, 'y', 8), C.insulator);
  return B.merge().dark;
}

// ------------------------------------------------------------------ blood thrown on the nose by a zombie run over (v0.82.0) : `n` splatters over the windscreen
// and the front mask, nose toward +u (parented to the car carrier by train.js)
export function buildCabBlood(n = 4) {
  const T = CONFIG.train, h = T.cars[0] / 2, Ln = T.layout.nose, out = [];
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  const at = (t) => { const S = noseSection(t); return [h - Ln + Ln * t, S.yTop]; };
  for (let k = 0; k < n; k++) {
    let g;
    if (k < 3) { // over the windscreen (left, right, then the left again larger) : a plane lying on the slope
      const t = 0.5 + 0.06 * k, [u, y] = at(t), [u2, y2] = at(t + 0.06), slope = Math.atan2(y - y2, u2 - u); // slope : the drop angle
      const sw = k === 1 ? 1 : -1, d = 0.03 + k * 0.004;
      g = quarter(new THREE.PlaneGeometry(k === 2 ? 0.9 : 0.65, k === 2 ? 0.8 : 0.6), k === 2 ? 1 : 0, 0);
      g.rotateZ(hash(k, 5) * TAU * 0.3); g.rotateX(-Math.PI / 2 + slope); // lying on the slope, facing up and forward
      g.rotateY(Math.PI);
      g.translate(sw * (0.3 + hash(k, 7) * 0.25), y + d, -u);
    } else { // front mask and bumper
      g = quarter(new THREE.PlaneGeometry(0.9, 0.5), 1, 1); g.rotateY(Math.PI); g.translate(0.1, 1.45, -(h + 0.03));
    }
    out.push(g);
  }
  return out;
}
