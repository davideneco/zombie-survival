import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

// =====================================================================
//  Regional train (v0.80.0) : geometry and materials, no game state. A generic electric locomotive (two cabs, pantograph, BB bogies,
//  number « 17412 », no brand) and a single-deck coach type (2+2 high-back seats in bays, luggage racks, LED strips, screens
//  « Prochain arrêt : Strasbourg », vestibules with door buttons, WC cubicle, blood, gangway bellows, bogies, buffers).
//  One merged geometry per material per vehicle type ; the coaches are drawn as InstancedMeshes (train.js) : ~15 draw calls for the train.
//  Vehicle-local axes : X = w (right of the direction of travel), Y = height above the rail head, Z = -u (u : forward along the vehicle).
//  coachLayout() is pure (no Three.js) : the walkable interior used both by the meshes and by the collision boxes of train.js.
// =====================================================================

const TAU = Math.PI * 2;
const hash = (a, b, k = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------ interior layout (coach-local u, w ; heights above the rail head)
export function coachLayout() {
  const T = CONFIG.train, W = T.walk, L = T.coach, h = L / 2;
  const seats = [];   // { u (back of the seat), dir (+1 faces +u), w (centre), wc } ; blocks : collision boxes { u0, u1, w0, w1 }
  const blocks = [];
  const P = T.partitionAt, bay = 1.9, nBay = Math.floor((2 * P) / bay), u0 = -(nBay * bay) / 2;
  for (let b = 0; b < nBay; b++) {
    const a = u0 + b * bay;
    for (const side of [-1, 1]) {
      if (b === 0 && side < 0) continue; // the WC cubicle stands there
      for (const [ub, dir] of [[a + 0.06, 1], [a + bay - 0.06, -1]]) {
        for (const wcen of [0.665, 1.105]) seats.push({ u: ub, dir, w: side * wcen });
        const lo = Math.min(ub, ub + dir * 0.56), hi = Math.max(ub, ub + dir * 0.56);
        blocks.push({ u0: lo, u1: hi, w0: side > 0 ? 0.4 : -W.wall, w1: side > 0 ? W.wall : -0.4 });
      }
    }
  }
  const wcBox = { u0: u0 + 0.02, u1: u0 + 1.85, w0: -W.wall, w1: -0.42 };
  blocks.push(wcBox);
  // saloon windows (both sides) : centres along u, width, sill and head heights above the rail head ; legroom : free gaps between facing seats
  const winW = 1.62, winY0 = 1.95, winY1 = 2.95, pitch = (2 * P) / T.windows, winU = [];
  for (let i = 0; i < T.windows; i++) winU.push(-P + pitch * (i + 0.5));
  const legroom = []; for (let b = 0; b < nBay; b++) legroom.push(u0 + b * bay + bay / 2);
  return { L, h, P, bay, nBay, u0, seats, blocks, wc: wcBox, doorAt: T.doorAt, doorW: T.doorWidth, wall: W.wall, winU, winW, winY0, winY1, legroom };
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
// body atlas 1024 x 1024 : rows 0-255 coach side (24.5 m x 2.3 m, from y 0.95 to 3.25), 256-511 locomotive side (17.5 m x 3.05 m, from 0.95 to 4.0),
// 512-767 roof and ends (grime), 768-1023 locomotive front
export const ATLAS = { coach: [0, 256, 0.95, 3.25], loco: [256, 512, 0.95, 4.0], roof: [512, 768], front: [768, 1024] };
function bodyTex() {
  const T = CONFIG.train;
  return canvasTex(1024, 1024, (x, W) => {
    const band = (r0, r1, y0m, y1m, len, loco) => { // livery of one side region
      const H = r1 - r0, py = (y) => r0 + (1 - (y - y0m) / (y1m - y0m)) * H, M = W / len;
      const g = x.createLinearGradient(0, r0, 0, r1); g.addColorStop(0, '#80858a'); g.addColorStop(0.7, '#767b7f'); g.addColorStop(1, '#4a4741'); x.fillStyle = g; x.fillRect(0, r0, W, H);
      x.fillStyle = '#3b3f44'; x.fillRect(0, py(loco ? 3.2 : 3.05), W, py(loco ? 2.15 : 1.86) - py(loco ? 3.2 : 3.05)); // window band
      x.fillStyle = '#7d6334'; x.fillRect(0, py(1.76), W, py(1.62) - py(1.76)); // muted ochre stripe
      x.fillStyle = 'rgba(200,190,160,0.25)'; x.fillRect(0, py(1.79), W, 2);
      for (let k = 0; k < len; k += 1.25) { x.fillStyle = 'rgba(30,32,34,0.35)'; x.fillRect(k * M, r0, 1, H); } // panel seams
      for (let k = 0; k < 160; k++) { // grime streaks running down (soft gradients)
        const sx = hash(k, r0) * W, sy = py(1.9) + hash(r0, k) * (r1 - py(1.9)) * 0.6, sh = 10 + hash(k, 4) * 40, gs = x.createLinearGradient(0, sy, 0, sy + sh);
        gs.addColorStop(0, 'rgba(38,30,22,0.16)'); gs.addColorStop(1, 'rgba(38,30,22,0)'); x.fillStyle = gs; x.fillRect(sx, sy, 1 + hash(k, 3) * 2, sh);
      }
      for (let k = 0; k < 40; k++) { const sx = hash(k, 7) * W, sy = py(1.95), sh = 14 + hash(k, 9) * 30, gs = x.createLinearGradient(0, sy, 0, sy + sh); gs.addColorStop(0, 'rgba(92,58,30,0.22)'); gs.addColorStop(1, 'rgba(92,58,30,0)'); x.fillStyle = gs; x.fillRect(sx, sy, 2, sh); } // rust streaks under the windows
      const gd = x.createLinearGradient(0, py(1.4), 0, r1); gd.addColorStop(0, 'rgba(30,24,18,0)'); gd.addColorStop(1, 'rgba(30,24,18,0.75)'); x.fillStyle = gd; x.fillRect(0, py(1.4), W, r1 - py(1.4)); // dirt
      x.fillStyle = 'rgba(85,12,10,0.55)'; x.fillRect(W * 0.37, py(2.1), 26, 20); x.fillRect(W * 0.373, py(1.9), 5, 34); // blood
      if (loco) { // grilles, number
        x.fillStyle = '#26292c'; for (let k = 0; k < 5; k++) { const a = (len / 2 + (k - 2) * 2.1 - 0.85) * M; x.fillRect(a, py(3.4), 1.7 * M, py(2.3) - py(3.4)); x.fillStyle = 'rgba(120,125,130,0.35)'; for (let s = 0; s < 14; s++) x.fillRect(a, py(3.4) + s * ((py(2.3) - py(3.4)) / 14), 1.7 * M, 1.5); x.fillStyle = '#26292c'; }
        x.fillStyle = '#d8d4c8'; x.font = 'bold 30px Arial, sans-serif'; x.textAlign = 'center';
        for (const u of [0.25, 0.75]) x.fillText(T.number, W * u, py(1.45));
      }
    };
    band(0, 256, ...ATLAS.coach.slice(2), T.coach, false);
    band(256, 512, ...ATLAS.loco.slice(2), T.loco, true);
    // roof and ends : grimy grey, streaks
    { const g = x.createLinearGradient(0, 512, 0, 768); g.addColorStop(0, '#4e5154'); g.addColorStop(1, '#3c3d3d'); x.fillStyle = g; x.fillRect(0, 512, W, 256); for (let k = 0; k < 220; k++) { x.fillStyle = `rgba(${20 + hash(k, 1) * 30},${18 + hash(k, 2) * 20},14,0.3)`; x.fillRect(hash(k, 3) * W, 512 + hash(k, 4) * 256, 2 + hash(k, 5) * 20, 1 + hash(k, 6) * 4); } }
    // locomotive front : grey with an ochre chevron, dirt
    { x.fillStyle = '#7a7f83'; x.fillRect(0, 768, W, 256); x.fillStyle = '#7d6334'; x.beginPath(); x.moveTo(0, 900); x.lineTo(W / 2, 860); x.lineTo(W, 900); x.lineTo(W, 925); x.lineTo(W / 2, 885); x.lineTo(0, 925); x.fill();
      const g = x.createLinearGradient(0, 900, 0, 1024); g.addColorStop(0, 'rgba(30,24,18,0)'); g.addColorStop(1, 'rgba(30,24,18,0.8)'); x.fillStyle = g; x.fillRect(0, 900, W, 124);
      x.fillStyle = '#d8d4c8'; x.font = 'bold 26px Arial, sans-serif'; x.textAlign = 'center'; x.fillText(T.number, W / 2, 960);
      x.fillStyle = 'rgba(90,10,8,0.7)'; for (let k = 0; k < 18; k++) x.fillRect(W * 0.3 + hash(k, 1) * W * 0.4, 790 + hash(k, 2) * 40, 3 + hash(k, 3) * 12, 3 + hash(k, 4) * 10); } // blood on the cab front
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
    x.fillStyle = '#2a3440'; x.fillRect(384, 0, 64, 32);
    x.fillStyle = '#05070a'; x.fillRect(0, 64, 512, 96);
    x.fillStyle = '#ffb02a'; x.font = 'bold 30px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('Prochain arrêt : Strasbourg', 256, 104);
    x.fillStyle = '#9ab8ff'; x.font = '20px Arial, sans-serif'; x.fillText('TER 17412 · Terminus', 256, 140);
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
    body: new THREE.MeshStandardMaterial({ map: bodyTex(), roughness: 0.58, metalness: 0.42 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.45 }),
    inside: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06, emissive: 0x0b0d10 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fa4b0, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    panel: new THREE.MeshStandardMaterial({ map: panel, emissiveMap: panel, emissive: 0xdde8ff, emissiveIntensity: 1.0, roughness: 0.4 }),
    flicker: new THREE.MeshStandardMaterial({ map: panel, emissiveMap: panel, emissive: 0xdde8ff, emissiveIntensity: 1.0, roughness: 0.4 }),
    decal: new THREE.MeshStandardMaterial({ map: bloodTex(), transparent: true, depthWrite: false, roughness: 0.35, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  };
  // broken saloon windows (v0.82.0) : cracks over the pane (white hairlines, transparent), jagged shards left in the frame (dirtier glass)
  MATS.crack = new THREE.MeshStandardMaterial({ map: crackTex(), color: 0xdfe6ea, roughness: 0.2, metalness: 0.1, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  MATS.shards = new THREE.MeshStandardMaterial({ color: 0x7c8e96, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  if (envMap) { MATS.glass.envMap = envMap; MATS.shards.envMap = envMap; }
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
  const L = coachLayout(), w = L.winW, y0 = L.winY0, y1 = L.winY1;
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
// blood thrown on the locomotive's front by a zombie run over (v0.82.0) : `n` splatters (windscreens, buffer beam), front nose (dir +1)
export function buildCabBlood(n = 4) {
  const T = CONFIG.train, h = T.loco / 2, phi = Math.atan2(0.4, 1.05), nY = Math.sin(phi), nZ = -Math.cos(phi), out = [];
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  for (let k = 0; k < n; k++) {
    let g;
    if (k < 3) { // over a windscreen (left, right, then the left again larger)
      const sw = k === 1 ? 1 : -1, d = 0.085 + k * 0.004;
      g = quarter(new THREE.PlaneGeometry(k === 2 ? 1.15 : 0.85, k === 2 ? 0.95 : 0.7), k === 2 ? 1 : 0, 0);
      g.rotateZ(hash(k, 5) * TAU); g.translate(0, 0.45 + (hash(k, 6) - 0.5) * 0.3, 0); g.rotateX(-phi); g.rotateY(Math.PI);
      g.translate(sw * (0.5 + hash(k, 7) * 0.3), 2.38 + nY * d, -(h - 0.38) + nZ * d);
    } else { // buffer beam and coupler
      g = quarter(new THREE.PlaneGeometry(1.6, 0.8), 1, 1); g.rotateY(Math.PI); g.translate(0.2, 1.3, -(h + 0.03));
    }
    out.push(g);
  }
  return out;
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
const _va = new THREE.Vector3(), _vb = new THREE.Vector3();
function tube(a, b, r, seg = 6) { // a, b : [u, y, w]
  _va.set(a[2], a[1], -a[0]); _vb.set(b[2], b[1], -b[0]);
  const len = _va.distanceTo(_vb), g = new THREE.CylinderGeometry(r, r, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _vb.clone().sub(_va).normalize()));
  g.translate(_va.x, _va.y, _va.z);
  return g;
}
// flat shape (x along u, y up) placed on the plane w = w0, facing +w (face > 0) or -w
function onSide(g, w0, face) { g.rotateY(face > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(w0, 0, 0); return g; }
// flat shape (x along w, y up) placed on the plane u = u0, facing +u (face > 0) or -u
function onEnd(g, u0, face) { if (face > 0) g.rotateY(Math.PI); g.translate(0, 0, -u0); return g; }
// UVs from positions for a body-atlas region : side (u along the vehicle length L, y) or roof (u, arc ~ w)
function uvSide(g, region, L) {
  const [r0, r1, y0, y1] = region, p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const u = -p.getZ(i), y = p.getY(i); uv.setXY(i, (u + L / 2) / L, 1 - (r0 + (1 - (y - y0) / (y1 - y0)) * (r1 - r0)) / 1024); }
  uv.needsUpdate = true; return g;
}
function uvRegion(g, rows, fx, fy) { // planar mapping into atlas rows [r0, r1] : fx, fy -> [0, 1]
  const p = g.attributes.position, uv = g.attributes.uv, [r0, r1] = rows;
  for (let i = 0; i < p.count; i++) { const a = Math.min(1, Math.max(0, fx(p.getX(i), p.getY(i), p.getZ(i)))), b = Math.min(1, Math.max(0, fy(p.getX(i), p.getY(i), p.getZ(i)))); uv.setXY(i, a, 1 - (r0 + (1 - b) * (r1 - r0)) / 1024); }
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
const plane = (sx, sy) => new THREE.PlaneGeometry(sx, sy);

// colours (desaturated, gritty)
const C = {
  steel: 0x3d4145, black: 0x161717, rubber: 0x1b1b1c, rust: 0x4a3326, axle: 0x2c2b29, wheel: 0x3a3632, disc: 0x55524d, yellow: 0x6e5a22,
  seat: 0x2e3946, seatHead: 0x7c7f7d, pedestal: 0x25272a, floor: 0x2a2d31, aisle: 0x3a3c40, lining: 0x8b8a84, liningLow: 0x55575a, ceiling: 0x9c9b95,
  partition: 0x6d6f70, wc: 0x707370, rack: 0x6a6e72, insulator: 0x5a2e22, grey: 0x55585b,
};

// ------------------------------------------------------------------ bogie (two axles) centred at u, wheel radius r, wheelbase wb
function bogie(B, u, r, wb, heavy = false) {
  const yAx = r, g = CONFIG.railNet.gauge / 2 + 0.036;
  for (const a of [-wb / 2, wb / 2]) {
    for (const s of [-1, 1]) {
      B.add('dark', cyl(u + a, yAx, s * g, r, 0.13, 'w', 18), C.wheel);                       // wheel
      B.add('dark', cyl(u + a, yAx, s * (g + 0.075), r * 0.82, 0.03, 'w', 18), C.rust);       // rim face
      B.add('dark', cbox(u + a, yAx, s * 1.06, 0.36, 0.3, 0.22, 0.03), C.steel);                 // axle box
      for (let k = 0; k < 4; k++) B.add('dark', new THREE.TorusGeometry(0.075, 0.018, 5, 10).rotateX(Math.PI / 2).translate(s * 1.06, yAx + 0.2 + k * 0.05, -(u + a)), C.rust); // coil spring
      if (!heavy) B.add('dark', cyl(u + a, yAx, s * 0.36, r * 0.68, 0.05, 'w', 16), C.disc);   // brake disc
    }
    B.add('dark', cyl(u + a, yAx, 0, 0.08, 2 * g, 'w', 8), C.axle);                              // axle
  }
  // side frames : extruded profile (dips between the axles), transom
  const fs = new THREE.Shape(), L = wb / 2 + 0.55, y0 = yAx + 0.15;
  fs.moveTo(-L, y0); fs.lineTo(-L, y0 + 0.28); fs.lineTo(-0.7, y0 + 0.36); fs.lineTo(-0.5, y0 + 0.12); fs.lineTo(0.5, y0 + 0.12); fs.lineTo(0.7, y0 + 0.36); fs.lineTo(L, y0 + 0.28); fs.lineTo(L, y0); fs.lineTo(0.6, y0 - 0.05); fs.lineTo(-0.6, y0 - 0.05); fs.lineTo(-L, y0);
  for (const s of [-1, 1]) { const gf = extr(fs, 0.14, 0.02); gf.translate(0, 0, -0.07); onSide(gf, s * 1.06, 1); gf.translate(0, 0, -u); B.add('dark', gf, C.steel); }
  B.add('dark', cbox(u, yAx + 0.28, 0, 0.5, 0.24, 2.0, 0.04), C.steel);
  for (const s of [-1, 1]) { B.add('dark', cyl(u, yAx + 0.55, s * 0.95, 0.27, 0.26, 'y', 14), C.rubber); B.add('dark', tube([u - wb / 2 + 0.3, yAx + 0.1, s * 1.18], [u - 0.2, yAx + 0.55, s * 1.18], 0.035), C.black); } // air springs, dampers
}
function buffers(B, uEnd, dir) { // buffers, coupler hook, buffer beam at the end uEnd (dir +1 : front)
  for (const s of [-1, 1]) {
    B.add('dark', cyl(uEnd + dir * 0.17, 1.06, s * 0.875, 0.09, 0.34, 'u', 10), C.steel);
    B.add('dark', cyl(uEnd + dir * 0.36, 1.06, s * 0.875, 0.2, 0.05, 'u', 18), C.black);
  }
  B.add('dark', cbox(uEnd + dir * 0.1, 1.06, 0, 0.2, 0.32, 2.6, 0.04), C.black);
  B.add('dark', cbox(uEnd + dir * 0.32, 1.02, 0, 0.36, 0.12, 0.1, 0.02), C.rust);
}

// ------------------------------------------------------------------ coach type
export function buildCoachGeometry() {
  const T = CONFIG.train, Lay = coachLayout(), L = T.coach, h = L / 2, Wd = T.width / 2, F = T.floor, B = buckets();
  const yb = 0.95, yc = 3.25, lin = T.walk.wall + 0.01; // body bottom, cant rail ; inner lining plane
  const { winW, winY0, winY1, winU } = Lay;
  const doorU = [-T.doorAt, T.doorAt], dw = T.doorWidth / 2, dTop = F + T.doorH;
  // ---- sides : skin with window and door openings (extruded), gaskets, door frames, handrails, steps, buttons
  for (const side of [-1, 1]) {
    const s = new THREE.Shape([new THREE.Vector2(-h, yb), new THREE.Vector2(h, yb), new THREE.Vector2(h, yc), new THREE.Vector2(-h, yc)]);
    for (const u of winU) s.holes.push(rrect(u - winW / 2, winY0, u + winW / 2, winY1, 0.12, true));
    for (const u of doorU) s.holes.push(rrect(u - dw, F + 0.02, u + dw, dTop, 0.1, true));
    const g = extr(s, Wd - lin - 0.02, 0, 4); onSide(g, side > 0 ? lin + 0.02 : -lin - 0.02, side);
    B.add('body', uvSide(g, ATLAS.coach, L));
    for (const u of winU) {
      const gk = extr(ring(u - winW / 2, winY0, u + winW / 2, winY1, 0.12, 0.045), 0.02, 0, 4); onSide(gk, side * Wd, side); B.add('dark', gk, C.rubber);
      // (the panes are their own instances, train.js : a window can crack and break during the intro, v0.82.0 ; buildWindowGeometry)
    }
    for (const u of doorU) {
      const fr = extr(ring(u - dw, F + 0.02, u + dw, dTop, 0.1, 0.07), 0.03, 0, 4); onSide(fr, side * Wd, side); B.add('dark', fr, C.grey);
      for (const e of [-1, 1]) B.add('dark', tube([u + e * (dw + 0.16), 1.25, side * (Wd + 0.07)], [u + e * (dw + 0.16), 2.65, side * (Wd + 0.07)], 0.02), C.steel); // handrails
      B.add('dark', cbox(u, yb - 0.04, side * (Wd - 0.05), T.doorWidth + 0.1, 0.05, 0.32, 0.015), C.steel); // step
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.045, 12).translate(u + (u > 0 ? -1 : 1) * (dw + 0.3), 1.95, 0), side * (Wd + 0.012), side), PANEL.button)); // outer door button
      B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.04, 12).translate(u + (u > 0 ? -1 : 1) * (dw + 0.25), 2.05, 0), side * (lin - 0.012), -side), PANEL.button)); // inner door button
    }
    B.add('dark', cbox(0, yc + 0.02, side * (Wd - 0.02), L, 0.06, 0.08, 0.02), C.steel); // gutter at the cant rail
    B.add('dark', cbox(0, yb + 0.03, side * (Wd - 0.03), L - 0.3, 0.07, 0.07, 0.02), C.black); // solebar edge
  }
  // ---- roof : swept profile (cant rail curve, flat crown), AC units
  {
    const prof = [[1.45, 3.25], [1.44, 3.45], [1.4, 3.62], [1.31, 3.77], [1.17, 3.88], [0.93, 3.97], [0.58, 4.03], [0.2, 4.05], [-0.2, 4.05], [-0.58, 4.03], [-0.93, 3.97], [-1.17, 3.88], [-1.31, 3.77], [-1.4, 3.62], [-1.44, 3.45], [-1.45, 3.25]].map(([w, y]) => [w * Wd / 1.45, 3.25 + (y - 3.25) * (T.height - 3.25) / 0.8]);
    const pos = [];
    for (let i = 1; i < prof.length; i++) { const [w0, y0] = prof[i - 1], [w1, y1] = prof[i], A = [w0, y0, -h], Bp = [w1, y1, -h], Cp = [w1, y1, h], D = [w0, y0, h]; pos.push(...A, ...Bp, ...Cp, ...A, ...Cp, ...D); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); g.computeVertexNormals();
    B.add('body', uvRegion(g, ATLAS.roof, (x, y, z) => (-z + h) / L, (x) => (x + Wd) / (2 * Wd)));
    // inner ceiling and coves (interior)
    const cv = [[lin, 2.93], [0.95, 3.07], [-0.95, 3.07], [-lin, 2.93]];
    const pi = [];
    for (let i = 1; i < cv.length; i++) { const [w0, y0] = cv[i - 1], [w1, y1] = cv[i]; pi.push(w0, y0, h - 0.1, w1, y1, h - 0.1, w1, y1, -h + 0.1, w0, y0, h - 0.1, w1, y1, -h + 0.1, w0, y0, -h + 0.1); }
    const gi = new THREE.BufferGeometry(); gi.setAttribute('position', new THREE.Float32BufferAttribute(pi, 3)); gi.computeVertexNormals(); B.add('inside', gi, C.ceiling);
    for (const u of [-h + 2.6, h - 2.6]) { B.add('dark', cbox(u, T.height + 0.12, 0, 2.4, 0.3, 1.6, 0.06), C.grey); for (let k = 0; k < 6; k++) B.add('dark', cbox(u - 0.9 + k * 0.36, T.height + 0.28, 0, 0.05, 0.03, 1.3, 0.01), C.black); }
  }
  // ---- ends : end wall with the gangway opening, bellows, floor plate, buffers ; inner face
  for (const dir of [-1, 1]) {
    const uE = dir * h, gw = T.walk.gangway / 2;
    const s = new THREE.Shape(); s.moveTo(-Wd, yb); s.lineTo(Wd, yb); s.lineTo(Wd, yc); s.quadraticCurveTo(Wd, T.height, 0, T.height); s.quadraticCurveTo(-Wd, T.height, -Wd, yc); s.lineTo(-Wd, yb);
    s.holes.push(rrect(-gw, F + 0.01, gw, F + 2.05, 0.08, true));
    const g = extr(s, 0.08, 0, 8); g.translate(0, 0, -0.04); onEnd(g, uE - dir * 0.04, dir);
    B.add('body', uvRegion(g, ATLAS.roof, (x) => (x + Wd) / (2 * Wd), (x, y) => (y - yb) / (T.height - yb)));
    for (let k = 0; k < 6; k++) { // corrugated bellows (rings), from the end out to the middle of the gap
      const o = 0.07 + (k % 2) * 0.05, b0 = uE + dir * (0.04 + k * 0.075);
      const r = extr(ring(-gw - 0.05, F - 0.02, gw + 0.05, F + 2.15, 0.12, o + 0.12), 0.07, 0, 4); r.translate(0, 0, -0.035); onEnd(r, b0 + dir * 0.035, dir); B.add('dark', r, C.rubber);
    }
    B.add('dark', cbox(uE + dir * 0.25, F - 0.02, 0, 0.5, 0.04, T.walk.gangway + 0.1, 0.01), C.steel);
    { // inner lining of the end wall (interior colour), around the gangway opening, and the opening's reveal
      // three quads around the opening (a Shape with a hole was triangulated across the opening : a solid slab with a diagonal edge, v0.85.1)
      const yT = 2.93, yO = F + 2.05, sideW = lin - gw;
      for (const [w, h, cx, cy] of [[sideW, yT - F, -(lin + gw) / 2, (F + yT) / 2], [sideW, yT - F, (lin + gw) / 2, (F + yT) / 2], [2 * gw, yT - yO, 0, (yO + yT) / 2]]) {
        B.add('inside', onEnd(plane(w, h).translate(cx, cy, 0), uE - dir * 0.09, -dir), C.partition);
      }
      const rv = extr(ring(-gw, F + 0.01, gw, F + 2.05, 0.08, 0.04), 0.12, 0, 4); rv.translate(0, 0, -0.06); onEnd(rv, uE - dir * 0.05, dir); B.add('inside', rv, C.rack);
    }
    buffers(B, uE, dir);
    // tail lamps (panel red) both ends
    for (const sw of [-1, 1]) B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.07, 10).translate(sw * 1.1, 1.35, 0), uE + dir * 0.005, dir), PANEL.red));
  }
  // ---- underframe : equipment boxes between the bogies, skirt
  for (const [u, sl, sw] of [[-4.5, 2.2, 1.9], [-1.4, 1.6, 1.4], [1.6, 2.4, 2.0], [4.8, 1.4, 1.2]]) B.add('dark', cbox(u, yb - 0.32, 0, sl, 0.56, sw, 0.05), C.axle);
  for (const s of [-1, 1]) B.add('dark', cbox(0, yb - 0.08, s * (Wd - 0.18), 10.4, 0.16, 0.08, 0.02), C.black);
  for (const u of [-T.bogie / 2, T.bogie / 2]) bogie(B, u, 0.46, 2.5);

  // ================================================================ interior
  const lyFloor = F;
  B.add('inside', new THREE.PlaneGeometry(2 * lin, L - 0.2).rotateX(-Math.PI / 2).translate(0, lyFloor, 0), C.floor);
  B.add('inside', new THREE.PlaneGeometry(0.8, 2 * Lay.P).rotateX(-Math.PI / 2).translate(0, lyFloor + 0.002, 0), C.aisle);
  // linings : lower panel (door openings), upper panel (windows), facing inward
  for (const side of [-1, 1]) {
    const lo = new THREE.Shape([new THREE.Vector2(-h + 0.1, F), new THREE.Vector2(h - 0.1, F), new THREE.Vector2(h - 0.1, winY0), new THREE.Vector2(-h + 0.1, winY0)]);
    const up = new THREE.Shape([new THREE.Vector2(-h + 0.1, winY0), new THREE.Vector2(h - 0.1, winY0), new THREE.Vector2(h - 0.1, 2.95), new THREE.Vector2(-h + 0.1, 2.95)]);
    for (const u of winU) up.holes.push(rrect(u - winW / 2, winY0 + 0.001, u + winW / 2, winY1 - 0.001, 0.12, true));
    // doors : cut both panels (the lower one keeps nothing in the opening)
    const loPieces = [], upPieces = [];
    let a = -h + 0.1;
    for (const u of [...doorU].sort((p, q) => p - q)) { loPieces.push([a, u - dw]); a = u + dw; } loPieces.push([a, h - 0.1]);
    for (const [p, q] of loPieces) {
      const sh = new THREE.Shape([new THREE.Vector2(p, F), new THREE.Vector2(q, F), new THREE.Vector2(q, winY0), new THREE.Vector2(p, winY0)]);
      B.add('inside', onSide(new THREE.ShapeGeometry(sh), side * lin, -side), C.liningLow);
      B.add('inside', onSide(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(p, F + 0.85), new THREE.Vector2(q, F + 0.85), new THREE.Vector2(q, F + 0.88), new THREE.Vector2(p, F + 0.88)])), side * (lin - 0.01), -side), C.rack); // chair rail
    }
    // upper panel : the window band, cut at the doors
    const upU = [-h + 0.1, ...[...doorU].sort((p, q) => p - q).flatMap((u) => [u - dw, u + dw]), h - 0.1];
    for (let i = 0; i < upU.length; i += 2) {
      const p = upU[i], q = upU[i + 1], sh = new THREE.Shape([new THREE.Vector2(p, winY0), new THREE.Vector2(q, winY0), new THREE.Vector2(q, 2.95), new THREE.Vector2(p, 2.95)]);
      for (const u of winU) if (u - winW / 2 > p && u + winW / 2 < q) sh.holes.push(rrect(u - winW / 2, winY0 + 0.001, u + winW / 2, winY1 - 0.001, 0.12, true));
      B.add('inside', onSide(new THREE.ShapeGeometry(sh, 4), side * lin, -side), C.lining);
      upPieces.push([p, q]);
    }
    for (const u of doorU) B.add('inside', onSide(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(u - dw, dTop), new THREE.Vector2(u + dw, dTop), new THREE.Vector2(u + dw, 2.95), new THREE.Vector2(u - dw, 2.95)])), side * lin, -side), C.lining);
    for (const u of winU) { // inner window frames
      const fr = extr(ring(u - winW / 2, winY0, u + winW / 2, winY1, 0.12, 0.05), 0.025, 0, 4); onSide(fr, side * (lin - 0.025), side); B.add('inside', fr, C.partition);
    }
    // luggage rack : tube, brackets, glass shelf (saloon only)
    const rw = side * 0.84;
    B.add('inside', cyl(0, 2.68, rw, 0.022, 2 * Lay.P - 0.2, 'u', 8), C.rack);
    B.add('inside', cyl(0, 2.6, side * (lin - 0.03), 0.018, 2 * Lay.P - 0.2, 'u', 8), C.rack);
    for (let u = -Lay.P + 0.2; u <= Lay.P - 0.19; u += Lay.bay) { B.add('inside', tube([u, 2.6, side * (lin - 0.02)], [u, 2.68, rw], 0.015), C.rack); B.add('inside', tube([u, 2.95, side * (lin - 0.02)], [u, 2.68, rw], 0.012), C.rack); }
    B.add('glass', new THREE.PlaneGeometry(lin - 0.86, 2 * Lay.P - 0.2).rotateX(-Math.PI / 2).translate(side * (lin + 0.84) / 2, 2.665, 0));
  }
  // ---- seats : extruded side profile (cushion, high back, headrest), pedestal, armrest, headrest cover
  const prof = new THREE.Shape();
  prof.moveTo(0.0, 0.40); prof.lineTo(0.5, 0.41); prof.quadraticCurveTo(0.55, 0.43, 0.52, 0.5); prof.lineTo(0.13, 0.53); prof.lineTo(0.1, 0.6); prof.lineTo(0.03, 1.15);
  prof.quadraticCurveTo(0.02, 1.27, -0.07, 1.26); prof.lineTo(-0.1, 1.2); prof.lineTo(-0.06, 0.5); prof.lineTo(0.0, 0.40);
  const seatW = 0.42;
  for (const st of Lay.seats) {
    const g = extr(prof, seatW, 0.015, 4); g.translate(0, 0, -seatW / 2);
    // shape x = depth (toward the facing direction), z = across ; -> u = st.u + dir * x, w = st.w + z
    g.rotateY(st.dir > 0 ? Math.PI / 2 : -Math.PI / 2); g.translate(st.w, F, -st.u);
    B.add('inside', g, C.seat);
    B.add('inside', cbox(st.u + st.dir * 0.055, F + 1.08, st.w, 0.04, 0.2, 0.3, 0.015), C.seatHead);
    if (Math.abs(st.w) < 0.8) B.add('inside', cbox(st.u + st.dir * 0.3, F + 0.66, st.w - Math.sign(st.w) * 0.24, 0.42, 0.05, 0.05, 0.015), C.pedestal); // aisle armrest
  }
  for (const st of Lay.seats) if (Math.abs(st.w) > 0.8) B.add('inside', cbox(st.u + st.dir * 0.26, F + 0.2, st.w - Math.sign(st.w) * 0.22, 0.3, 0.4, 0.8, 0.03), C.pedestal);
  // ---- vestibule partitions (glass upper panes, door opening), screens
  for (const dir of [-1, 1]) {
    const u0 = dir * Lay.P, pd = T.walk.partitionDoor / 2;
    const s = new THREE.Shape([new THREE.Vector2(-lin, F), new THREE.Vector2(lin, F), new THREE.Vector2(lin, 3.0), new THREE.Vector2(-lin, 3.0)]);
    s.holes.push(rrect(-pd, F + 0.001, pd, F + 2.0, 0.05, true));
    for (const sw of [-1, 1]) s.holes.push(rrect(sw > 0 ? pd + 0.15 : -lin + 0.1, F + 0.95, sw > 0 ? lin - 0.1 : -pd - 0.15, F + 1.8, 0.06, true));
    const g = extr(s, 0.06, 0, 4); g.translate(0, 0, -0.03); onEnd(g, u0, dir); B.add('inside', g, C.partition);
    for (const sw of [-1, 1]) B.add('glass', onEnd(new THREE.PlaneGeometry(lin - pd - 0.25, 0.85).translate(sw * (lin + pd) / 2, F + 1.375, 0), u0, dir));
    for (const face of [-1, 1]) B.add('panel', uvRect(onEnd(plane(0.64, 0.12).translate(0, F + 2.15, 0), u0 - face * 0.04, -face), PANEL.screen)); // screens above the doorway (both faces)
    B.add('inside', cbox(u0 - dir * 0.2, F + 0.02, 0, 0.4, 0.04, 2 * pd, 0.01), C.steel); // threshold
  }
  // ---- WC cubicle (left side of the first bay)
  { const b = Lay.wc, uc = (b.u0 + b.u1) / 2, wcC = (b.w0 + b.w1) / 2;
    B.add('inside', cbox(uc, F + 0.95, wcC, b.u1 - b.u0, 1.9, b.w1 - b.w0, 0.04), C.wc);
    B.add('inside', onSide(new THREE.ShapeGeometry(rrect(uc - 0.35, F + 0.05, uc + 0.35, F + 1.85, 0.04)), b.w1 + 0.003, 1), C.liningLow); // door
    B.add('panel', uvPanel(onSide(new THREE.CircleGeometry(0.03, 10).translate(uc + 0.25, F + 1.7, 0), b.w1 + 0.006, 1), PANEL.red)); }
  // ---- LED strips on the coves : segments per bay, a few dead, two faulty (flicker material)
  for (const side of [-1, 1]) {
    for (let k = 0; k < 2 * Math.round(Lay.P / 1.2); k++) {
      const u = -Lay.P + 0.6 + k * 1.2, dead = hash(k, side, 4) > 0.86, flick = !dead && hash(k, side, 5) > 0.88;
      const g = new THREE.PlaneGeometry(0.05, 1.0); g.rotateX(Math.PI / 2); g.rotateZ(-side * 0.32); g.translate(side * 1.12, 2.995, -u);
      if (dead) B.add('panel', uvRect(g, PANEL.dead)); else B.add(flick ? 'flicker' : 'panel', uvRect(g, PANEL.led));
    }
    for (const u of [-Lay.h + 1.35, Lay.h - 1.35]) { const g = new THREE.PlaneGeometry(0.05, 1.4); g.rotateX(Math.PI / 2); g.rotateZ(-side * 0.32); g.translate(side * 1.12, 2.995, -u); B.add('panel', uvRect(g, PANEL.led)); } // vestibules
  }
  // ---- blood (decals : uv quarters of the blood texture)
  const quarter = (g, qx, qy) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (qx + uv.getX(i)) / 2, (qy + uv.getY(i)) / 2); return g; };
  B.add('decal', quarter(new THREE.PlaneGeometry(0.9, 1.5).rotateX(-Math.PI / 2).translate(0.05, F + 0.006, -1.4), 1, 0));                    // pool in the aisle
  B.add('decal', quarter(onSide(new THREE.PlaneGeometry(0.5, 0.6).translate(winU[5] + 0.95, 1.75, 0), lin - 0.005, -1), 0, 0));             // splatter, right lining
  B.add('decal', quarter(onSide(new THREE.PlaneGeometry(0.45, 0.6).translate(winU[1] - 0.95, 2.2, 0), -lin + 0.005, 1), 0, 1));             // hand print, left lining
  B.add('decal', quarter(new THREE.PlaneGeometry(0.6, 1.0).rotateX(-Math.PI / 2).translate(-0.3, F + 0.006, -(h - 1.5)), 1, 1));            // smear in the front vestibule
  B.add('decal', quarter(onEnd(new THREE.PlaneGeometry(0.5, 0.7).translate(0.95, F + 1.2, 0), Lay.P - 0.035, -1), 0, 0));                    // partition
  return B.merge();
}

// door leaf (plug door) : X across (thickness), Y up, Z along ; centred on its middle ; returns { leaf, glass }
export function buildDoorLeaf() {
  const T = CONFIG.train, F = T.floor, w = T.doorWidth, B = buckets();
  const s = rrect(-w / 2, F + 0.02, w / 2, F + T.doorH, 0.09);
  s.holes.push(rrect(-0.3, F + 1.05, 0.3, F + 1.85, 0.08, true));
  const g = extr(s, 0.05, 0.01, 4); g.translate(0, 0, -0.025); onSide(g, 0, 1);
  B.add('body', uvSide(g, ATLAS.coach, T.coach));
  B.add('glass', onSide(new THREE.ShapeGeometry(rrect(-0.3, F + 1.05, 0.3, F + 1.85, 0.08), 4), 0, 1));
  const out = B.merge();
  // texture : as if in the door opening at doorAt (the livery runs on)
  const uv = out.body.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + T.doorAt / T.coach);
  return { leaf: out.body, glass: out.glass };
}

// ------------------------------------------------------------------ locomotive
export function buildLocoGeometry() {
  const T = CONFIG.train, L = T.loco, h = L / 2, Wd = 1.475, B = buckets(), yb = 0.95, top = T.height - 0.08;
  // body : side profile (sloped cab noses) extruded across, chamfered
  const nose = [[h, yb], [h, 1.95], [h - 0.35, 2.3], [h - 0.75, 3.35], [h - 1.15, top]];
  // re-order : bottom edge, front nose up, roof, rear nose down
  const pr = new THREE.Shape(); pr.moveTo(-h, yb); pr.lineTo(h, yb); for (const [u, y] of nose.slice(1)) pr.lineTo(u, y); for (const [u, y] of nose.slice(1).reverse()) pr.lineTo(-u, y); pr.lineTo(-h, yb);
  const g = extr(pr, 2 * Wd - 0.12, 0.06, 4); g.translate(0, 0, -(Wd - 0.06)); // shape x = u, z = across -> X = w
  onSide(g, 0, 1); // (x, y, z) -> (z, y, -x) : X = across, Z = -u
  { // UVs : sides from the locomotive side region, the rest (noses, roof) from the front region
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, [r0, r1, y0, y1] = ATLAS.loco;
    for (let i = 0; i < p.count; i++) {
      const u = -p.getZ(i), y = p.getY(i), x = p.getX(i);
      if (Math.abs(n.getX(i)) > 0.6) uv.setXY(i, (n.getX(i) > 0 ? u + h : h - u) / L, 1 - (r0 + (1 - (y - y0) / (y1 - y0)) * (r1 - r0)) / 1024); // (left side mirrored : the number reads right)
      else if (n.getY(i) > 0.8) uv.setXY(i, (u + h) / L, 1 - (512 + ((x + Wd) / (2 * Wd)) * 256) / 1024);
      else uv.setXY(i, (n.getZ(i) < 0 ? Wd - x : x + Wd) / (2 * Wd), 1 - (768 + (1 - Math.min(1, Math.max(0, (y - yb) / (top - yb)))) * 256) / 1024);
    }
  }
  B.add('body', g);
  // windscreens on both noses, side cab windows, cab doors, grilles
  const phi = Math.atan2(0.4, 1.05); // windscreen lean (from vertical)
  for (const dir of [-1, 1]) {
    const nY = Math.sin(phi), nZ = -dir * Math.cos(phi), at = (d) => [2.38 + nY * d, -dir * (h - 0.38) + nZ * d];
    for (const sw of [-1, 1]) {
      const pane = new THREE.ShapeGeometry(rrect(-0.62, 0, 0.62, 0.95, 0.08), 4); // x across, y up the slope ; dark tinted glass over a dim cab
      pane.rotateX(-phi); if (dir > 0) pane.rotateY(Math.PI);
      const [py, pz] = at(0.075); pane.translate(sw * 0.66, py, pz);
      B.add('panel', uvPanel(pane, PANEL.cab));
      const fr = extr(ring(-0.62, 0, 0.62, 0.95, 0.08, 0.05), 0.03, 0, 4); fr.rotateX(-phi); if (dir > 0) fr.rotateY(Math.PI);
      const [fy, fz] = at(0.05); fr.translate(sw * 0.66, fy, fz); B.add('dark', fr, C.rubber);
    }
    B.add('dark', tube([dir * (h - 0.33), 2.45, 0], [dir * (h - 0.66), 3.3, 0], 0.035), C.black); // centre pillar
    for (const side of [-1, 1]) {
      const u0 = dir * (h - 1.75);
      const win = new THREE.ShapeGeometry(rrect(u0 - 0.5, 2.25, u0 + 0.5, 3.1, 0.08), 4); onSide(win, side * (Wd + 0.008), side); B.add('panel', uvPanel(win, PANEL.cab));
      const wf = extr(ring(u0 - 0.5, 2.25, u0 + 0.5, 3.1, 0.08, 0.04), 0.02, 0, 4); onSide(wf, side * Wd, side); B.add('dark', wf, C.rubber);
      const ud = dir * (h - 3.0);
      const df = extr(ring(ud - 0.4, 1.1, ud + 0.4, 3.0, 0.06, 0.04), 0.02, 0, 4); onSide(df, side * Wd, side); B.add('dark', df, C.grey);
      for (const e of [-1, 1]) B.add('dark', tube([ud + e * 0.52, 1.2, side * (Wd + 0.07)], [ud + e * 0.52, 2.7, side * (Wd + 0.07)], 0.02), C.steel);
      for (let k = 0; k < 3; k++) B.add('dark', cbox(ud, 0.55 + k * 0.2, side * (Wd - 0.1 + 0.05), 0.6, 0.03, 0.22, 0.01), C.steel); // cab steps
    }
    // headlights (front end white, rear end red), buffers, plough, buffer beam
    const lamp = dir > 0 ? PANEL.head : PANEL.red;
    for (const sw of [-1, 1]) {
      B.add('dark', cyl(dir * (h + 0.02), 1.6, sw * 0.9, 0.13, 0.08, 'u', 14), C.black);
      B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.1, 14).translate(sw * 0.9, 1.6, 0), dir * (h + 0.065), dir), lamp));
    }
    B.add('panel', uvPanel(onEnd(new THREE.CircleGeometry(0.09, 14).translate(0, 3.5, 0), dir * (h - 0.8), dir), dir > 0 ? PANEL.head : PANEL.dead));
    buffers(B, dir * h, dir);
    const pl = new THREE.Shape(); pl.moveTo(-1.35, 0); pl.lineTo(1.35, 0); pl.lineTo(1.0, 0.45); pl.lineTo(-1.0, 0.45); pl.lineTo(-1.35, 0); // snow plough (trapezoid seen from the front, extruded)
    const pg = extr(pl, 0.14, 0.02, 2); pg.translate(0, 0.2, -0.07); onEnd(pg, dir * (h + 0.25), dir); B.add('dark', pg, C.yellow);
  }
  for (const side of [-1, 1]) for (let k = 0; k < 5; k++) { // grilles : recessed frames with slats (symmetric : the side skins are mirrored)
    const ug = (k - 2) * 2.1;
    const gf = extr(ring(ug - 0.85, 2.3, ug + 0.85, 3.4, 0.03, 0.04), 0.03, 0, 2); onSide(gf, side * Wd, side); B.add('dark', gf, C.steel);
    for (let s2 = 0; s2 < 9; s2++) B.add('dark', cbox(ug, 2.36 + s2 * 0.12, side * (Wd + 0.01), 1.66, 0.03, 0.03, 0.008), C.black);
  }
  // roof : pantographs (front one raised to the contact wire), insulators, breaker, cables, roof walk
  const yRoof = top + 0.02, wire = CONFIG.railNet.wire.contact;
  for (const [u, up] of [[3.6, true], [-3.6, false]]) {
    B.add('dark', cbox(u, yRoof + 0.12, 0, 1.2, 0.08, 1.4, 0.02), C.steel);
    for (const s of [-1, 1]) for (const du of [-0.5, 0.5]) B.add('dark', cyl(u + du, yRoof + 0.05, s * 0.55, 0.07, 0.16, 'y', 8), C.insulator);
    const knee = up ? [u - 1.25, (yRoof + wire) / 2 + 0.1] : [u - 1.4, yRoof + 0.32], head = up ? [u, wire - 0.08] : [u + 0.2, yRoof + 0.42];
    for (const s of [-1, 1]) { B.add('dark', tube([u + 0.4, yRoof + 0.2, s * 0.35], [knee[0], knee[1], s * 0.3], 0.03), C.steel); B.add('dark', tube([knee[0], knee[1], s * 0.3], [head[0], head[1], s * 0.1], 0.022), C.steel); }
    B.add('dark', cyl(head[0], head[1], 0, 0.035, 1.6, 'w', 8), C.steel);
    for (const s of [-1, 1]) B.add('dark', tube([head[0], head[1], s * 0.8], [head[0], head[1] - 0.18, s * 0.98], 0.02), C.steel);
  }
  B.add('dark', cbox(0, yRoof + 0.2, 0, 1.6, 0.36, 0.9, 0.05), C.grey);
  for (const s of [-1, 1]) B.add('dark', cyl(0, yRoof + 0.12, s * 0.62, 0.025, 7.0, 'u', 6), C.insulator);
  B.add('dark', cbox(0, yRoof + 0.03, 0.95, 9.5, 0.03, 0.35, 0.01), C.grey);
  // underframe : transformer, tanks, skirt
  B.add('dark', cbox(0, yb - 0.35, 0, 4.2, 0.6, 2.1, 0.06), C.axle);
  for (const s of [-1, 1]) B.add('dark', cbox(0, yb - 0.08, s * (Wd - 0.15), 12.5, 0.16, 0.08, 0.02), C.black);
  for (const u of [-T.locoBogie / 2, T.locoBogie / 2]) bogie(B, u, 0.62, 2.9, true);
  return B.merge();
}
