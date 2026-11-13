import * as THREE from 'three';
import { gpuOnly } from '../gpuOnly.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { trackGeometry, inStationClip, normalFromCanvas } from '../railNet.js';

// =====================================================================
//  Gare de Strasbourg (v0.79.0) : meshes. Everything static is built in the station frame of plan.js and merged per material
//  (one draw call per material). Mesh-local axes : X = v (toward the forecourt), Y = up, Z = -u (u : along the tracks, north-north-east).
//    - the 1883 sandstone building : wings, central pavilion with three tall arches and the clock, corner pavilions, slate roofs with dormers,
//      plinth, pilasters, string courses, cornices, quoins, arched windows ; the pavilions and annexes beyond it (OSM parts)
//    - the hall (salle des pas perdus) : stone floor, wainscot, coffered ceiling, ticket counter, departures board, benches, kiosk, underpass
//      stairs filled with rubble
//    - the 2007 verrière : glass shell swept along its real curved footprint (quarter-ellipse profile), steel ribs every 3 m, purlins
//    - the 1883 train shed (two naves of riveted lattice arches on cast-iron columns, roof with a skylight band, glazed end screens)
//    - platforms (real outlines), edge lines and tactile strips ; the SNCF tracks (railNet.trackGeometry : ballast prism, sleepers, extruded rails),
//      the quai 1 track along the intro route (v0.80.0 : the parked train of train.js stands on it ; the v0.79 dead train is gone)
//    - Place de la Gare : paving, roads, the CTS line C stop « Gare Centrale », lamps, barriers, a burnt-out bus
//  No PointLight here : light spots are returned to the pooled lights of realworld.js.
// =====================================================================

const TAU = Math.PI * 2;
const hash = (a, b, k = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, srgb = true, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const tileFloorTex = () => canvasTex(512, 512, (x, w, h) => { // hall floor : worn stone tiles, 0.6 m (8 per texture : 4.8 m)
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const k = (i + j) % 2, n = hash(i, j, 3);
    const l = k ? 112 + n * 14 : 100 + n * 14;
    x.fillStyle = `rgb(${l + 6},${l + 2},${l - 6})`; x.fillRect(i * 64, j * 64, 64, 64);
    x.fillStyle = 'rgba(0,0,0,0.06)'; for (let s = 0; s < 6; s++) x.fillRect(i * 64 + hash(i, j, s) * 60, j * 64 + hash(j, i, s) * 60, 3, 2);
  }
  x.strokeStyle = 'rgba(30,26,22,0.6)'; x.lineWidth = 2;
  for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, h); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); }
  const g = x.createRadialGradient(w * 0.3, h * 0.6, 10, w * 0.3, h * 0.6, 260); g.addColorStop(0, 'rgba(20,16,12,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
}, true, true);
// ashlar sandstone (grey-beige, 1883 building) : courses of 0.5 m, staggered blocks, joints, tone per block, weathering ; 512 px = 4 m
const ashlarTex = (base) => canvasTex(512, 512, (x, w, h) => {
  const [r0, g0, b0] = base;
  x.fillStyle = `rgb(${r0},${g0},${b0})`; x.fillRect(0, 0, w, h);
  const ch = 64; // 0.5 m
  for (let r = 0; r < 8; r++) {
    let cx = (r % 2) * 40 - 40;
    while (cx < w) {
      const bw = 120 + Math.floor(hash(r, cx, 1) * 90), n = (hash(r, cx, 2) - 0.5) * 22;
      x.fillStyle = `rgb(${r0 + n},${g0 + n - 1},${b0 + n - 3})`; x.fillRect(cx + 2, r * ch + 2, bw - 3, ch - 3);
      for (let k = 0; k < 40; k++) { const t = hash(r * 31 + k, cx, 3); x.fillStyle = `rgba(${t > 0.5 ? '255,250,240' : '40,34,28'},0.06)`; x.fillRect(cx + 2 + hash(k, r, cx) * (bw - 6), r * ch + 3 + hash(cx, k, r) * (ch - 6), 3 + t * 6, 2); }
      cx += bw;
    }
  }
  x.fillStyle = 'rgba(60,52,44,0.55)'; for (let r = 0; r <= 8; r++) x.fillRect(0, r * ch - 1, w, 2);
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(30,28,26,0.18)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(40,34,28,0.12)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let k = 0; k < 18; k++) { x.fillStyle = 'rgba(30,26,22,0.08)'; x.fillRect(hash(k, 9) * w, 0, 3 + hash(k, 8) * 10, h * (0.3 + hash(k, 7) * 0.7)); } // rain streaks
}, true, true);
const slateTex = () => canvasTex(256, 256, (x, w, h) => { // slate roof : staggered rows, 0.25 m (16 rows per 4 m)
  x.fillStyle = '#2e3236'; x.fillRect(0, 0, w, h);
  for (let r = 0; r < 16; r++) for (let c = 0; c < 10; c++) {
    const n = hash(r, c, 7), off = r % 2 ? 12.8 : 0;
    x.fillStyle = `rgb(${46 + n * 18},${50 + n * 18},${56 + n * 18})`; x.fillRect(c * 25.6 + off, r * 16, 24.6, 15);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(c * 25.6 + off, r * 16 + 13, 24.6, 2);
  }
}, true, true);
const corrugatedTex = () => canvasTex(128, 128, (x, w, h) => { // shed roof : corrugated sheet + streaks
  for (let i = 0; i < w; i++) { const l = 52 + 22 * Math.sin((i / w) * TAU * 8); x.fillStyle = `rgb(${l},${l + 2},${l + 4})`; x.fillRect(i, 0, 1, h); }
  x.fillStyle = 'rgba(60,40,24,0.25)'; for (let k = 0; k < 14; k++) x.fillRect(hash(k, 1) * w, 0, 2 + hash(k, 2) * 4, h);
}, true, true);
const ballastTex = () => canvasTex(256, 256, (x, w, h) => {
  x.fillStyle = '#3e3a35'; x.fillRect(0, 0, w, h);
  for (let k = 0; k < 2400; k++) { const l = 40 + hash(k, 1) * 70; x.fillStyle = `rgb(${l + 6},${l + 2},${l - 4})`; const s = 2 + hash(k, 3) * 5; x.fillRect(hash(k, 4) * w, hash(k, 5) * h, s, s * 0.8); }
  x.fillStyle = 'rgba(40,24,12,0.25)'; for (let k = 0; k < 30; k++) x.fillRect(hash(k, 6) * w, hash(k, 7) * h, 30, 18); // rust and oil
}, true, true);
const boardTex = () => canvasTex(1024, 256, (x, w, h) => { // departures board (emissive : black background, amber dot matrix)
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#ffb02a'; x.font = 'bold 34px "Courier New", monospace'; x.fillText('DÉPARTS', 22, 42);
  x.font = 'bold 26px "Courier New", monospace';
  const rows = [['17412', 'MULHOUSE', 'SUPPRIMÉ'], ['830152', 'SAVERNE', 'SUPPRIMÉ'], ['17829', 'OFFENBURG', 'SUPPRIMÉ'], ['---', 'TOUS TRAINS', 'ANNULÉS']];
  rows.forEach(([n, d, s], i) => { const y = 92 + i * 42; x.fillStyle = i === 3 ? '#ff5a2a' : '#ffb02a'; x.fillText(n, 22, y); x.fillText(d, 200, y); x.fillText(s, 700, y); });
  x.fillStyle = 'rgba(0,0,0,0.5)'; for (let y = 0; y < h; y += 4) x.fillRect(0, y, w, 1);
});
const signTex = (text, sub = null, bg = '#1b2a3a', fg = '#e8eef4') => canvasTex(512, 128, (x, w, h) => {
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 4; x.strokeRect(4, 4, w - 8, h - 8);
  x.fillStyle = fg; x.textAlign = 'center'; x.font = `bold ${sub ? 50 : 64}px Arial, sans-serif`; x.fillText(text, w / 2, sub ? 62 : 86, w - 30);
  if (sub) { x.font = '28px Arial, sans-serif'; x.fillStyle = '#b8c4d0'; x.fillText(sub, w / 2, 104, w - 30); }
});
const clockTex = () => canvasTex(256, 256, (x, w) => {
  x.fillStyle = '#d8d0b8'; x.beginPath(); x.arc(128, 128, 122, 0, TAU); x.fill();
  x.strokeStyle = '#1a1a1a'; x.lineWidth = 6; x.stroke();
  x.fillStyle = '#1a1a1a'; x.font = 'bold 28px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((r, i) => { const a = (i / 12) * TAU - Math.PI / 2; x.fillText(r, 128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); });
  x.lineCap = 'round'; x.lineWidth = 9; x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + 50 * Math.cos(-2.2), 128 + 50 * Math.sin(-2.2)); x.stroke(); // stopped at 23:20
  x.lineWidth = 5; x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + 84 * Math.cos(0.52), 128 + 84 * Math.sin(0.52)); x.stroke();
});

// ------------------------------------------------------------------ geometry kit (mesh-local : X = v, Y = up, Z = -u)
const keepStd = (g) => { // position / normal / uv only, non-indexed (mergeGeometries needs the same attributes everywhere)
  let q = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
  if (!q.attributes.normal) q.computeVertexNormals();
  if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
  return q;
};
// box spanning u [u0, u1], v [v0, v1], y [y0, y1], UVs in metres
function bx(u0, u1, v0, v1, y0, y1) {
  const w = Math.abs(v1 - v0), h = Math.abs(y1 - y0), d = Math.abs(u1 - u0);
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  g.translate((v0 + v1) / 2, (y0 + y1) / 2, -(u0 + u1) / 2);
  return g;
}
// beam (square / rectangular section w x h) between two local points [u, y, v]
const _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
function beam(a, b, w, h = w) {
  _a.set(a[2], a[1], -a[0]); _b.set(b[2], b[1], -b[0]);
  const len = _a.distanceTo(_b);
  const g = new THREE.BoxGeometry(w, h, len);
  const dir = _b.clone().sub(_a).normalize();
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, Math.abs(dir.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : _up);
  g.applyMatrix4(m);
  g.translate((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2);
  return g;
}
function cyl(u, v, y0, h, r0, r1 = r0, seg = 12) { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(v, y0 + h / 2, -u); return g; }
// shape (x along the wall, y up) extruded `depth` m outward from a wall : side +1 (facade v = vw facing +v, x along +u from u0) or -1 (facing -v, x along -u)
function onWall(shapeGeo, side, u0, vw) {
  shapeGeo.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  shapeGeo.translate(vw, 0, -u0);
  return shapeGeo;
}
const archShape = (w, h, x0 = 0, y0 = 0) => { // rectangle with a semicircular head (opening of width w, total height h)
  const s = new THREE.Shape(), r = w / 2, hs = Math.max(0, h - r);
  s.moveTo(x0 - r, y0); s.lineTo(x0 + r, y0); s.lineTo(x0 + r, y0 + hs);
  s.absarc(x0, y0 + hs, r, 0, Math.PI, false);
  s.lineTo(x0 - r, y0);
  return s;
};
const archPath = (w, h, x0 = 0, y0 = 0) => { const p = new THREE.Path(), r = w / 2, hs = Math.max(0, h - r); p.moveTo(x0 - r, y0); p.lineTo(x0 - r, y0 + hs); p.absarc(x0, y0 + hs, r, Math.PI, 0, true); p.lineTo(x0 + r, y0); p.lineTo(x0 - r, y0); return p; };
// arch-shaped frame (ring with legs) around an opening of width w and height h, border b, standing on y0
const archRing = (w, h, b, y0 = 0) => {
  const s = new THREE.Shape(), r = w / 2, R = r + b, hs = Math.max(0, h - r);
  s.moveTo(-R, y0); s.lineTo(-R, y0 + hs); s.absarc(0, y0 + hs, R, Math.PI, 0, true); s.lineTo(R, y0); s.lineTo(r, y0); s.lineTo(r, y0 + hs);
  s.absarc(0, y0 + hs, r, 0, Math.PI, false); s.lineTo(-r, y0); s.lineTo(-R, y0);
  return s;
};
// spandrel above an arched opening (w wide, head top at `top`) up to y = yTop
const spandrel = (w, top, yTop) => {
  const s = new THREE.Shape(), r = w / 2;
  s.moveTo(-r, top - r); s.lineTo(-r, yTop); s.lineTo(r, yTop); s.lineTo(r, top - r); s.absarc(0, top - r, r, 0, Math.PI, false);
  return s;
};
// glazed tympanum of an arched opening, from y0 to the head
const tympanum = (w, top, y0) => { const s = new THREE.Shape(), r = w / 2; s.moveTo(-r, y0); s.lineTo(-r, top - r); s.absarc(0, top - r, r, Math.PI, 0, true); s.lineTo(r, y0); s.lineTo(-r, y0); return s; };
const rectShape = (x0, y0, x1, y1) => { const s = new THREE.Shape(); s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0); return s; };
const extr = (shape, depth, bevel = 0) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 10 });
// flat horizontal polygon (local [u, v] points) at height y, UVs = (v, u) in metres
function flatPoly(pts, y, holes = []) {
  const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(v, u)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(v, u))));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2); // (x, y) -> (x, 0, y) : X = v, Z = u … mirror Z to get -u
  g.scale(1, 1, -1);
  const pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) { pos.setY(i, y); nor.setXYZ(i, 0, 1, 0); }
  return g; // (the mirror turned the downward-facing triangles of the rotation back up : counter-clockwise from above)
}
// slab : polygon extruded from y0 to y1 (platforms)
function slab(pts, y0, y1) {
  const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(v, u)));
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // (x, y, z) -> (x, z, -y) : X = v, Y = extrusion, Z = -u
  g.translate(0, y0, 0);
  return g;
}

// ------------------------------------------------------------------ main builder
export function buildGareMeshes({ plan, gare, rail, pbr, tiled, props, envMap, route = null }) {
  const G = CONFIG.gare, B = plan.body, F = plan.frame;
  const root = new THREE.Group(); root.name = 'gare';
  const local = new THREE.Group(); local.name = 'gare:local';
  local.position.set(F.ox, 0, F.oz);
  local.rotation.y = Math.atan2(-F.vz, F.vx);
  root.add(local);
  const L = (x, z) => plan.L(x, z);
  const loc = (pts) => pts.map(([x, z]) => L(x, z));
  const colliders = []; // extra collision boxes : { u, v, lu, lv, rot (local), h }

  // ---------------------------------------------------------------- materials (PBR, desaturated, rough)
  const rep = (m, k) => { for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.repeat.set(k, k); return m; };
  const M = {
    sand: new THREE.MeshStandardMaterial({ map: ashlarTex([150, 140, 124]), normalMap: pbr.plaster.normalMap, roughness: 0.82, metalness: 0.02 }),
    sandDark: new THREE.MeshStandardMaterial({ map: ashlarTex([116, 108, 96]), normalMap: pbr.plaster.normalMap, roughness: 0.86 }),
    sandTrim: new THREE.MeshStandardMaterial({ map: ashlarTex([172, 163, 146]), normalMap: pbr.plaster.normalMap, roughness: 0.78 }),
    plasterIn: rep(tiled(pbr.plaster, 1, 1, { color: 0x8a8174, roughness: 0.88 }), 1 / 3),
    slate: new THREE.MeshStandardMaterial({ map: slateTex(), color: 0xb8bcc2, roughness: 0.72, metalness: 0.15 }),
    zinc: new THREE.MeshStandardMaterial({ color: 0x5c6266, roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2b3431, roughness: 0.6, metalness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x4d5357, roughness: 0.48, metalness: 0.65 }),
    glassDark: new THREE.MeshStandardMaterial({ color: 0x10161c, roughness: 0.18, metalness: 0.7, envMapIntensity: 0.9 }),
    glassDS: new THREE.MeshStandardMaterial({ color: 0x141b22, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    glassLit: new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.25, metalness: 0.3, emissive: 0xffa54a, emissiveIntensity: 0.28 }),
    verre: new THREE.MeshPhysicalMaterial({ color: 0xa8c0cc, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4, emissive: 0x2a3a4a, emissiveIntensity: 0.35 }),
    skylight: new THREE.MeshStandardMaterial({ color: 0x46545a, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    roofSheet: new THREE.MeshStandardMaterial({ map: corrugatedTex(), color: 0x9a9c9e, roughness: 0.66, metalness: 0.5, side: THREE.DoubleSide }),
    concrete: rep(tiled(pbr.plaster, 1, 1, { color: 0x6e6c67, roughness: 0.9 }), 1 / 2.2),
    paving: rep(tiled(pbr.cobble, 1, 1, { color: 0x8a8680 }), 1 / 2.2),
    asphalt: rep(tiled(pbr.cobble, 1, 1, { color: 0x3b3b3c, roughness: 0.92 }), 1 / 6),
    floor: new THREE.MeshStandardMaterial({ map: tileFloorTex(), roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    ballast: new THREE.MeshStandardMaterial({ map: ballastTex(), roughness: 0.95, color: 0xb0aaa0 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x7a7470, roughness: 0.35, metalness: 0.7 }), // polished head : the one exception to the roughness rule
    sleeper: new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.9 }),
    white: new THREE.MeshStandardMaterial({ color: 0xc8c6be, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    tactile: new THREE.MeshStandardMaterial({ color: 0xa89a62, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x3a2a1f, roughness: 0.8 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9, metalness: 0.35 }),
    burnt: new THREE.MeshStandardMaterial({ color: 0x1d1a18, roughness: 0.95, metalness: 0.2 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
    rubble: new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.95, flatShading: true }),
    board: new THREE.MeshStandardMaterial({ map: boardTex(), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0.9, roughness: 0.4 }),
    clock: new THREE.MeshStandardMaterial({ map: clockTex(), emissive: 0xffe6b0, emissiveIntensity: 0.18, roughness: 0.5 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffa040, emissiveIntensity: 2.6, roughness: 0.3 }),
    led: new THREE.MeshStandardMaterial({ color: 0xc8e0ff, emissive: 0x8cc4ff, emissiveIntensity: 2.2, roughness: 0.3 }),
    ctsGreen: new THREE.MeshStandardMaterial({ color: 0x2d3a34, roughness: 0.55, metalness: 0.5 }),
  };
  M.board.emissiveMap = M.board.map;
  for (const k of ['sand', 'sandDark', 'sandTrim']) { M[k].map.repeat.set(0.25, 0.25); M[k].emissive = new THREE.Color(0xe8c49c); M[k].emissiveMap = M[k].map; M[k].emissiveIntensity = k === 'sandDark' ? 0.04 : 0.09; } // floodlit at night
  M.slate.map.repeat.set(0.25, 0.25); M.ballast.map.repeat.set(1 / 3, 1 / 3); M.floor.map.repeat.set(1 / 4.8, 1 / 4.8);
  M.ballast.normalMap = normalFromCanvas(M.ballast.map.image, 3); M.ballast.normalMap.repeat.set(1 / 3, 1 / 3); M.ballast.normalScale.set(0.8, 0.8); // stones in relief
  if (envMap) for (const k of ['verre', 'glassDark']) M[k].envMap = envMap;
  const buckets = new Map(); // material -> [geometry]
  const add = (mat, g) => { if (!g) return; let l = buckets.get(mat); if (!l) buckets.set(mat, l = []); l.push(keepStd(g)); };
  // ground planes, small emissive or flat details : no shadow pass (fewer draw calls)
  const noCast = new Set([M.lamp, M.led, M.white, M.tactile, M.board, M.clock, M.glassLit, M.glassDark, M.glassDS, M.rail, M.rubber, M.rubble, M.concrete, M.paving, M.asphalt, M.floor, M.ballast, M.sleeper]);
  const flush = (parent, shadowOff = noCast) => {
    for (const [mat, list] of buckets) {
      if (!list.length) continue;
      const g = mergeGeometries(list, false); list.forEach((q) => q.dispose());
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = !shadowOff.has(mat) && !mat.transparent; m.receiveShadow = true;
      m.name = 'gare:mesh'; gpuOnly(m);
      parent.add(m);
    }
    buckets.clear();
  };

  const cMid = plan.cMid, H = plan.hall, BH = G.building;
  const T = 0.8; // wall thickness
  const wingH = BH.wing, pavH = BH.pavilion, cenH = BH.center;
  const cen0 = cMid - 15, cen1 = cMid + 15;          // central pavilion
  const corner = 12.5;                                 // corner pavilions of the main body
  const heightAt = (u) => (u >= cen0 && u <= cen1 ? cenH : u <= B.u0 + corner || u >= B.u1 - corner ? pavH : wingH);

  // ================================================================ 1883 building : walls with openings
  // wall along the line v = vw, from u0 to u1, height h, openings [[a, b, top, arch]]
  const wallRun = (vw, u0, u1, y0, h, openings, mat) => {
    let u = u0;
    const ops = openings.filter(([a, b]) => b > u0 && a < u1).sort((p, q) => p[0] - q[0]);
    for (const [a, b, top, arch] of ops) {
      if (a > u) add(mat, bx(u, a, vw - T / 2, vw + T / 2, y0, h));
      // above the opening : lintel (flat or with the arch cut out)
      if (arch) {
        const w = b - a;
        const g = extr(spandrel(w, top, Math.min(h, top + 1.2)), T); g.translate(0, 0, -T / 2); // centred on the wall plane
        g.rotateY(Math.PI / 2); g.translate(vw, 0, -(a + b) / 2);
        add(mat, g);
        if (top + 1.2 < h) add(mat, bx(a, b, vw - T / 2, vw + T / 2, top + 1.2, h));
      } else add(mat, bx(a, b, vw - T / 2, vw + T / 2, top, h));
      u = b;
    }
    if (u < u1) add(mat, bx(u, u1, vw - T / 2, vw + T / 2, y0, h));
  };
  // main body : rear wall (track side) and facade, split by heights (wings, corner pavilions, central pavilion)
  const spans = [[B.u0, B.u0 + corner], [B.u0 + corner, cen0], [cen0, cen1], [cen1, B.u1 - corner], [B.u1 - corner, B.u1]];
  const rearOps = plan.rearDoors.map(([a, b]) => [a, b, 4.6, true]);
  const archOps = plan.arches.map(([a, b]) => [a, b, 9.6, true]);
  for (const [a, b] of spans) {
    const h = heightAt((a + b) / 2);
    wallRun(B.v0, a, b, 0, h, rearOps, M.sand);
    wallRun(B.v1, a, b, 0, h, archOps, M.sand);
  }
  for (const u of [B.u0, B.u1]) add(M.sand, bx(u - T / 2, u + T / 2, B.v0, B.v1, 0, pavH));
  // hall partitions and ceiling ; the central pavilion block above the hall
  for (const u of [H.u0, H.u1]) add(M.plasterIn, bx(u - T / 2, u + T / 2, B.v0 + T / 2, B.v1 - T / 2, 0, H.height));
  add(M.plasterIn, bx(H.u0, H.u1, B.v0, B.v1, H.height, H.height + 0.6));
  for (const u of [cen0, cen1]) add(M.sand, bx(u - T / 2, u + T / 2, B.v0, B.v1, wingH - 0.5, cenH));

  // ---------------------------------------------------------------- facade dressing (both long sides)
  for (const side of [1, -1]) {
    const vw = side > 0 ? B.v1 : B.v0, out = vw + side * T / 2; // outer face
    const P = (u, y) => [out, y, -u];
    // plinth, string course, cornice, frieze (stepped profiles)
    for (const [a, b] of spans) {
      const h = heightAt((a + b) / 2);
      const strip = (y0, y1, d) => { const g = bx(a, b, side > 0 ? out : out - d, side > 0 ? out + d : out, y0, y1); add(M.sandTrim, g); };
      strip(0, 1.1, 0.18);              // plinth
      strip(1.1, 1.22, 0.24);           // plinth cap
      strip(5.6, 5.85, 0.16);           // string course above the ground floor arcade
      strip(h - 1.3, h - 0.75, 0.1);    // frieze
      strip(h - 0.75, h - 0.45, 0.28);  // cornice
      strip(h - 0.45, h - 0.2, 0.5);    // drip
      strip(h - 0.2, h, 0.38);
    }
    // bays : pilasters and windows (arched below, rectangular with a pediment above)
    for (const [a, b] of spans) {
      const h = heightAt((a + b) / 2), centre = a === cen0;
      const bayW = centre ? 10 : 6.4, n = Math.max(1, Math.round((b - a) / bayW)), bw = (b - a) / n;
      for (let i = 0; i <= n; i++) { // pilasters
        const u = a + i * bw;
        add(M.sandTrim, bx(u - 0.38, u + 0.38, side > 0 ? out : out - 0.22, side > 0 ? out + 0.22 : out, 1.22, h - 1.3));
      }
      for (let i = 0; i < n; i++) {
        const uc = a + (i + 0.5) * bw;
        const doorHere = (side > 0 ? plan.arches : plan.rearDoors).some(([p, q]) => uc > p - 1 && uc < q + 1);
        if (centre && side > 0) continue; // the three great arches (see below)
        if (!doorHere) { // ground floor : arched window (stone frame + dark glass)
          const w = Math.min(2.6, bw - 1.8), wh = 4.0;
          add(M.sandTrim, onWall(extr(archRing(w, wh, 0.3, 1.4), 0.16), side, uc, out));
          add(M.sandTrim, onWall(extr(rectShape(-w / 2 - 0.4, 1.22, w / 2 + 0.4, 1.4), 0.24), side, uc, out)); // sill
          const gl = new THREE.ShapeGeometry(archShape(w, wh, 0, 1.4)); add(hash(uc, side) > 0.82 ? M.glassLit : M.glassDark, onWall(gl, side, uc, out + side * 0.02));
          add(M.iron, onWall(new THREE.ShapeGeometry(rectShape(-0.03, 1.4, 0.03, 1.4 + wh)), side, uc, out + side * 0.04));
          add(M.iron, onWall(new THREE.ShapeGeometry(rectShape(-w / 2, 3.4, w / 2, 3.46)), side, uc, out + side * 0.04));
        }
        // upper floors : rectangular windows with a pediment
        for (const y of h > 13 ? [7.0, 10.3] : [7.0]) {
          if (y + 2.4 > h - 1.4) continue;
          const w = 1.5, wh = 2.3;
          const fr = rectShape(-w / 2 - 0.25, y - 0.2, w / 2 + 0.25, y + wh + 0.2); fr.holes.push(new THREE.Path([new THREE.Vector2(-w / 2, y), new THREE.Vector2(w / 2, y), new THREE.Vector2(w / 2, y + wh), new THREE.Vector2(-w / 2, y + wh)]));
          add(M.sandTrim, onWall(extr(fr, 0.14), side, uc, out));
          add(M.sandTrim, onWall(extr(rectShape(-w / 2 - 0.45, y + wh + 0.2, w / 2 + 0.45, y + wh + 0.42), 0.3), side, uc, out)); // pediment
          add(hash(uc, y + side) > 0.86 ? M.glassLit : M.glassDark, onWall(new THREE.ShapeGeometry(rectShape(-w / 2, y, w / 2, y + wh)), side, uc, out + side * 0.02));
          add(M.iron, onWall(new THREE.ShapeGeometry(rectShape(-0.03, y, 0.03, y + wh)), side, uc, out + side * 0.04));
        }
      }
      // quoins at the pavilion corners
      if (a === B.u0 || b === B.u1 || a === cen0) {
        for (const u of a === cen0 ? [cen0, cen1] : [a === B.u0 ? a + corner : b - corner]) {
          for (let k = 0; k * 0.55 < h - 1.6; k++) {
            const w = k % 2 ? 0.45 : 0.75;
            add(M.sandTrim, bx(u - w / 2, u + w / 2, side > 0 ? out : out - 0.07, side > 0 ? out + 0.07 : out, 1.22 + k * 0.55, 1.22 + k * 0.55 + 0.48));
          }
        }
      }
    }
    // rear doorways and the three great arches : stone frames, glazed tympana with iron glazing bars
    const ops = side > 0 ? plan.arches.map(([a2, b2]) => [a2, b2, 9.6]) : plan.rearDoors.map(([a2, b2]) => [a2, b2, 4.6]);
    for (const [a2, b2, top] of ops) {
      const w = b2 - a2, uc = (a2 + b2) / 2;
      add(M.sandTrim, onWall(extr(archRing(w, top, 0.5, 0), 0.3), side, uc, out));
      add(M.sandTrim, onWall(extr(rectShape(-0.35, top - 0.2, 0.35, top + 0.65), 0.42), side, uc, out)); // keystone
      if (top > 6) { // tympanum glazing above the doors
        add(M.glassDS, onWall(new THREE.ShapeGeometry(tympanum(w, top, 4.2)), side, uc, vw));
        for (let k = -2; k <= 2; k++) add(M.iron, beam([uc + (k * w) / 6, 4.2, vw], [uc + (k * w) / 6, top - 0.3 * Math.abs(k), vw], 0.08));
        add(M.iron, beam([a2, 4.2, vw], [b2, 4.2, vw], 0.14));
        add(M.iron, beam([a2, 6.6, vw], [b2, 6.6, vw], 0.08));
      }
    }
  }
  // central pavilion above the arches : attic, clock, pediment
  {
    const out = B.v1 + T / 2;
    add(M.sandTrim, bx(cen0 + 1, cen1 - 1, out, out + 0.3, 11.2, 11.6));
    add(M.sandTrim, bx(cen0 + 1, cen1 - 1, out, out + 0.12, 15.6, 16.2));
    const clock = new THREE.CircleGeometry(1.7, 40); clock.rotateY(Math.PI / 2); clock.translate(out + 0.32, 18.6, -cMid); add(M.clock, clock);
    const ring = new THREE.TorusGeometry(1.85, 0.16, 8, 40); ring.rotateY(Math.PI / 2); ring.translate(out + 0.3, 18.6, -cMid); add(M.sandTrim, ring);
    // twin columns flanking the arches
    for (const u of [cen0 + 1.6, cMid - 3.5, cMid + 3.5, cen1 - 1.6]) { colliders.push({ u, v: out + 0.45, lu: 1.0, lv: 0.9, rot: 0, h: 11 }); add(M.sandTrim, cyl(u, out + 0.45, 1.2, 9.6, 0.38, 0.32, 14)); add(M.sandTrim, bx(u - 0.55, u + 0.55, out, out + 0.9, 10.8, 11.25)); add(M.sandTrim, bx(u - 0.5, u + 0.5, out, out + 0.85, 0, 1.2)); }
    // allegorical statues on the attic (silhouettes) and the pediment
    for (const u of [cen0 + 2, cen1 - 2]) { add(M.sandDark, cyl(u, out - 0.3, cenH, 1.4, 0.45, 0.3, 10)); add(M.sandDark, new THREE.SphereGeometry(0.32, 10, 8).translate(out - 0.3, cenH + 1.7, -u)); }
  }

  // ---------------------------------------------------------------- roofs : slate hips over the wings, steep pavilion roofs, dormers
  const hipRoof = (u0, u1, v0, v1, y, rh, mat = M.slate) => { // hipped roof over a rectangle ; ridge along u
    const vm = (v0 + v1) / 2, inset = Math.min((v1 - v0) / 2, (u1 - u0) / 2);
    const P = (u, yy, v) => [v, yy, -u];
    const r0 = P(u0 + inset, y + rh, vm), r1 = P(u1 - inset, y + rh, vm);
    const c = [P(u0, y, v0), P(u1, y, v0), P(u1, y, v1), P(u0, y, v1)];
    const pos = [...c[0], ...c[1], ...r1, ...c[0], ...r1, ...r0, ...c[2], ...c[3], ...r0, ...c[2], ...r0, ...r1, ...c[1], ...c[2], ...r1, ...c[3], ...c[0], ...r0];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // UVs : planar in metres (along the eave, up the slope)
    const uv = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i + 2] + pos[i], pos[i + 1] * 1.6);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    // make every face point up (double winding check)
    const n = g.attributes.normal, p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) if (n.getY(i) < 0) { for (const k of [0, 1, 2]) n.setXYZ(i + k, -n.getX(i + k), -n.getY(i + k), -n.getZ(i + k)); const ax = p.getX(i + 1), ay = p.getY(i + 1), az = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, ax, ay, az); }
    add(mat, g);
  };
  hipRoof(B.u0 + corner, cen0, B.v0 - 0.6, B.v1 + 0.6, wingH, BH.roof);
  hipRoof(cen1, B.u1 - corner, B.v0 - 0.6, B.v1 + 0.6, wingH, BH.roof);
  hipRoof(cen0 - 0.4, cen1 + 0.4, B.v0 - 0.8, B.v1 + 0.8, cenH, BH.roof + 3.5);
  hipRoof(B.u0 - 0.4, B.u0 + corner + 0.4, B.v0 - 0.8, B.v1 + 0.8, pavH, BH.roof + 2);
  hipRoof(B.u1 - corner - 0.4, B.u1 + 0.4, B.v0 - 0.8, B.v1 + 0.8, pavH, BH.roof + 2);
  for (const [a, b] of [[B.u0 + corner + 3, cen0 - 3], [cen1 + 3, B.u1 - corner - 3]]) { // dormers on both slopes
    for (let u = a; u <= b; u += 6.4) for (const s of [1, -1]) {
      const vv = s * (B.v1 - 3.2), y0 = wingH + 1.0;
      add(M.zinc, bx(u - 0.9, u + 0.9, vv - 0.9, vv + 0.9, y0, y0 + 1.7));
      const fr = new THREE.ShapeGeometry(rectShape(-0.55, y0 + 0.2, 0.55, y0 + 1.45)); add(M.glassDark, onWall(fr, s, u, vv + s * 0.91));
      const gab = new THREE.Shape([new THREE.Vector2(-1.05, y0 + 1.7), new THREE.Vector2(1.05, y0 + 1.7), new THREE.Vector2(0, y0 + 2.5)]);
      add(M.slate, onWall(extr(gab, 1.9), s, u, vv - s * 0.95));
    }
  }
  // finials and ridge crest on the pavilions
  for (const u of [B.u0 + corner / 2, B.u1 - corner / 2]) add(M.zinc, cyl(u, 0, pavH + BH.roof + 2, 1.6, 0.12, 0.03, 8));
  add(M.zinc, cyl(cMid, 0, cenH + BH.roof + 3.5, 2.4, 0.16, 0.03, 8));

  // ---------------------------------------------------------------- pavilions and annexes beyond the main body (real OSM parts)
  for (const p of [...plan.pavilions.map((b) => ({ ...b, h: 14.5, stone: true })), ...plan.annexes.map((b) => ({ ...b, h: 11.5, stone: false }))]) {
    const mat = p.stone ? M.sand : M.sandDark;
    add(mat, bx(p.u0, p.u1, p.v0, p.v1, 0, p.h));
    add(M.sandTrim, bx(p.u0 - 0.1, p.u1 + 0.1, p.v0 - 0.1, p.v1 + 0.1, 0, 1.0));
    add(M.sandTrim, bx(p.u0 - 0.25, p.u1 + 0.25, p.v0 - 0.25, p.v1 + 0.25, p.h - 0.5, p.h));
    hipRoof(p.u0 - 0.3, p.u1 + 0.3, p.v0 - 0.3, p.v1 + 0.3, p.h, p.stone ? 5 : 3.2);
    for (const s of [1, -1]) { // windows on the long sides
      const vw = s > 0 ? p.v1 : p.v0;
      for (let u = p.u0 + 2.5; u <= p.u1 - 2; u += 4.2) for (const y of [1.6, 5.4, 8.8]) {
        if (y + 2.2 > p.h - 0.8) continue;
        const w = 1.3, wh = y < 2 ? 2.6 : 2.0;
        add(hash(u, y + s) > 0.9 ? M.glassLit : M.glassDark, onWall(new THREE.ShapeGeometry(y < 2 ? archShape(w, wh, 0, y) : rectShape(-w / 2, y, w / 2, y + wh)), s, u, vw + s * 0.02));
        const fr = y < 2 ? archShape(w + 0.4, wh + 0.2, 0, y - 0.1) : rectShape(-w / 2 - 0.2, y - 0.15, w / 2 + 0.2, y + wh + 0.15);
        fr.holes.push(y < 2 ? archPath(w, wh, 0, y) : new THREE.Path([new THREE.Vector2(-w / 2, y), new THREE.Vector2(w / 2, y), new THREE.Vector2(w / 2, y + wh), new THREE.Vector2(-w / 2, y + wh)]));
        add(M.sandTrim, onWall(extr(fr, 0.12), s, u, vw));
      }
    }
  }

  // ================================================================ hall (salle des pas perdus)
  {
    const u0 = H.u0 + T / 2, u1 = H.u1 - T / 2, v0 = B.v0 + T / 2, v1 = B.v1 - T / 2, hh = H.height;
    // floor with the two underpass stair wells (holes, filled with rubble)
    const wells = [-1, 1].map((s) => ({ u: cMid + s * 6, v: -1, lu: 3.2, lv: 6 }));
    add(M.floor, flatPoly([[H.u0, B.v0], [H.u1, B.v0], [H.u1, B.v1], [H.u0, B.v1]], 0.012, wells.map((w) => [[w.u - w.lu / 2, w.v - w.lv / 2], [w.u + w.lu / 2, w.v - w.lv / 2], [w.u + w.lu / 2, w.v + w.lv / 2], [w.u - w.lu / 2, w.v + w.lv / 2]])));
    for (const w of wells) {
      for (let k = 0; k < 8; k++) add(M.concrete, bx(w.u - w.lu / 2, w.u + w.lu / 2, w.v - w.lv / 2 + k * 0.7, w.v - w.lv / 2 + (k + 1) * 0.7, -0.2 - k * 0.3, -k * 0.3)); // steps down
      for (const s of [-1, 1]) add(M.concrete, bx(w.u - w.lu / 2, w.u + w.lu / 2, w.v + s * w.lv / 2 - 0.12, w.v + s * w.lv / 2 + 0.12, -3, 0.012));
      for (const s of [-1, 1]) add(M.concrete, bx(w.u + s * w.lu / 2 - 0.12, w.u + s * w.lu / 2 + 0.12, w.v - w.lv / 2, w.v + w.lv / 2, -3, 0.012));
      // balustrade (stone posts + iron rail) on three sides, rubble mound and twisted rebar
      for (const [a, b] of [[[w.u - w.lu / 2, w.v + w.lv / 2], [w.u + w.lu / 2, w.v + w.lv / 2]], [[w.u - w.lu / 2, w.v - w.lv / 2], [w.u - w.lu / 2, w.v + w.lv / 2]], [[w.u + w.lu / 2, w.v - w.lv / 2], [w.u + w.lu / 2, w.v + w.lv / 2]]]) {
        add(M.iron, beam([a[0], 1.0, a[1]], [b[0], 1.0, b[1]], 0.07));
        const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.6);
        for (let i = 0; i <= n; i++) { const t = i / n; add(M.iron, beam([a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t], [a[0] + (b[0] - a[0]) * t, 1.0, a[1] + (b[1] - a[1]) * t], 0.035)); }
      }
      for (let k = 0; k < 16; k++) {
        const r = 0.35 + hash(w.u, k) * 0.6, g = new THREE.DodecahedronGeometry(r, 0);
        g.scale(1, 0.6, 1); g.rotateY(hash(k, w.u) * TAU);
        g.translate(w.v + (hash(k, 2) - 0.5) * w.lv * 0.8, -0.2 + hash(k, 3) * 0.6, -(w.u + (hash(k, 4) - 0.5) * w.lu * 0.8)); add(M.rubble, g);
      }
      for (let k = 0; k < 3; k++) add(M.rust, beam([w.u - 1 + k, -0.2, w.v - 1.5], [w.u - 0.6 + k * 0.7, 1.1, w.v + 0.4 * k], 0.05));
      colliders.push({ u: w.u, v: w.v, lu: w.lu + 0.3, lv: w.lv + 0.3, rot: 0, h: 1.05 });
    }
    // plaster lining of the long walls (the openings stay open), wainscot, arched wall recesses, cornice, coffered ceiling
    for (const [vv, s, ops] of [[v0, 1, plan.rearDoors.map(([a, b2]) => [a, b2, 4.6])], [v1, -1, plan.arches.map(([a, b2]) => [a, b2, 9.6])]]) {
      let u = u0;
      for (const [a, b2, top] of [...ops.filter(([a]) => a > u0 && a < u1), [u1, u1, 0]]) {
        if (a > u) add(M.plasterIn, bx(u, a, s > 0 ? vv : vv - 0.04, s > 0 ? vv + 0.04 : vv, 1.3, hh - 1.2));
        if (top) add(M.plasterIn, bx(a, b2, s > 0 ? vv : vv - 0.04, s > 0 ? vv + 0.04 : vv, top + 0.6, hh - 1.2));
        u = b2;
      }
    }
    for (const [a, b, vv, s] of [[u0, u1, v0, 1], [u0, u1, v1, -1]]) add(M.wood, bx(a, b, s > 0 ? vv : vv - 0.06, s > 0 ? vv + 0.06 : vv, 0, 1.3));
    for (const [uu, s] of [[u0, 1], [u1, -1]]) add(M.wood, bx(s > 0 ? uu : uu - 0.06, s > 0 ? uu + 0.06 : uu, v0, v1, 0, 1.3));
    add(M.sandTrim, bx(u0, u1, v0, v0 + 0.4, hh - 1.2, hh - 0.8)); add(M.sandTrim, bx(u0, u1, v1 - 0.4, v1, hh - 1.2, hh - 0.8));
    for (let u = u0; u <= u1 + 0.01; u += (u1 - u0) / 6) add(M.sandTrim, bx(u - 0.25, u + 0.25, v0, v1, hh - 0.9, hh)); // ceiling beams
    for (let v = v0; v <= v1 + 0.01; v += (v1 - v0) / 4) add(M.sandTrim, bx(u0, u1, v - 0.2, v + 0.2, hh - 0.6, hh));
    for (const [uu, s] of [[u0, 1], [u1, -1]]) for (const vc of [v0 + 5, (v0 + v1) / 2, v1 - 5]) { // blind arcades on the partitions
      // shape x along v ; on the partition plane, facing the hall (+u for the west partition, -u for the east one)
      const g = extr(archRing(3.0, 6.6, 0.3, 1.6), 0.15); if (s > 0) g.rotateY(Math.PI); g.translate(vc, 0, -uu); add(M.sandTrim, g);
      const pane = new THREE.ShapeGeometry(archShape(3.0, 6.6, 0, 1.6)); if (s > 0) pane.rotateY(Math.PI); pane.translate(vc, 0, -(uu + s * 0.03)); add(M.sandDark, pane);
    }
    // ticket counter (guichets) along the west partition, glass screens
    const tu = u0 + 0.9;
    add(M.wood, bx(tu - 0.5, tu + 0.5, v1 - 9, v1 - 1.5, 0, 1.1));
    add(M.sandTrim, bx(tu - 0.6, tu + 0.6, v1 - 9.1, v1 - 1.4, 1.1, 1.18));
    for (let v = v1 - 9; v <= v1 - 1.4; v += 1.5) add(M.iron, beam([tu, 1.18, v], [tu, 2.6, v], 0.06));
    add(M.glassDark, bx(tu - 0.02, tu + 0.02, v1 - 9, v1 - 1.5, 1.18, 2.6));
    add(M.wood, bx(tu - 0.5, tu + 0.5, v1 - 9, v1 - 1.5, 2.6, 3.0));
    colliders.push({ u: tu, v: v1 - 5.25, lu: 1.2, lv: 7.6, rot: 0, h: 3 });
    // departures board hanging from the ceiling (both faces)
    const bu = cMid, bv = -4.5;
    for (const s of [1, -1]) { const pl = new THREE.PlaneGeometry(4.2, 1.05); pl.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2); pl.translate(bv + s * 0.08, 6.4, -bu); add(M.board, pl); }
    add(M.steel, bx(bu - 2.2, bu + 2.2, bv - 0.07, bv + 0.07, 5.8, 7.0));
    for (const du of [-1.6, 1.6]) add(M.steel, beam([bu + du, 7.0, bv], [bu + du, hh - 0.6, bv], 0.04));
    // benches (back to back) and the kiosk
    for (const u of [cMid - 14, cMid - 10, cMid + 10, cMid + 14]) for (const v of [3, 5.6]) {
      add(M.wood, bx(u - 1.4, u + 1.4, v - 0.25, v + 0.25, 0.42, 0.48)); add(M.wood, bx(u - 1.4, u + 1.4, v - 0.05, v + 0.05, 0.48, 0.95));
      for (const du of [-1.2, 1.2]) add(M.iron, bx(u + du - 0.05, u + du + 0.05, v - 0.3, v + 0.3, 0, 0.42));
      colliders.push({ u, v, lu: 2.8, lv: 0.6, rot: 0, h: 0.95, vault: true });
    }
    {
      const ku = cMid + 7, kv = 6.5;
      add(M.ctsGreen, bx(ku - 1.6, ku + 1.6, kv - 1.2, kv + 1.2, 0, 2.4));
      add(M.wood, bx(ku - 1.75, ku + 1.75, kv - 1.35, kv + 1.35, 2.4, 2.55));
      add(M.glassDark, bx(ku - 1.2, ku + 1.2, kv + 1.21, kv + 1.23, 1.0, 2.1));
      add(M.lamp, bx(ku - 1.2, ku + 1.2, kv + 1.3, kv + 1.34, 2.15, 2.3));
      colliders.push({ u: ku, v: kv, lu: 3.4, lv: 2.6, rot: 0, h: 2.5 });
    }
    // chandeliers (cold iron rings with warm lamps)
    for (const s of [-1, 1]) {
      const cu = cMid + s * 12, ring = new THREE.TorusGeometry(1.4, 0.06, 6, 24); ring.rotateX(Math.PI / 2); ring.translate(0, 8.8, -cu); add(M.iron, ring);
      add(M.iron, beam([cu, 8.8, 0], [cu, hh - 0.6, 0], 0.05));
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; add(M.lamp, new THREE.SphereGeometry(0.12, 8, 6).translate(Math.cos(a) * 1.4, 8.95, -cu + Math.sin(a) * 1.4)); }
    }
  }

  // ================================================================ verrière (2007) : glass shell on the real curved footprint
  {
    const V = G.verriere, vf = plan.verFront, v1 = B.v1 + T / 2;
    const us = [], ds = [];
    for (let i = 0; i < vf.length; i++) { us.push(vf[i][0]); ds.push(Math.max(0, vf[i][1] - v1)); }
    const dmax = Math.max(...ds);
    const hAt = (d) => Math.max(2.2, V.height * Math.pow(d / dmax, 0.55));
    const K = 14; // profile samples (quarter ellipse : horizontal at the facade, vertical at the ground)
    const prof = (i, k) => { const d = ds[i], hh = hAt(d), a = (k / K) * (Math.PI / 2); return [us[i], hh * Math.cos(a), v1 + d * Math.sin(a)]; }; // [u, y, v]
    const pos = [], uv = [];
    const ent = plan.entrance;
    for (let i = 1; i < us.length; i++) for (let k = 0; k < K; k++) {
      const p00 = prof(i - 1, k), p10 = prof(i, k), p01 = prof(i - 1, k + 1), p11 = prof(i, k + 1);
      if (Math.min(p01[1], p11[1]) < 3.6 && (us[i - 1] + us[i]) / 2 > ent[0] - 0.4 && (us[i - 1] + us[i]) / 2 < ent[1] + 0.4) continue; // entrance opening
      for (const p of [p00, p10, p11, p00, p11, p01]) { pos.push(p[2], p[1], -p[0]); uv.push(p[0], p[1]); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    add(M.verre, g);
    // ribs every ribEvery m (curved steel arcs), purlins along the shell, a curb at the foot
    let next = us[0];
    for (let i = 0; i < us.length; i++) {
      if (us[i] + 1e-6 < next && i !== us.length - 1) continue;
      next = us[i] + V.ribEvery;
      for (let k = 1; k <= K; k++) add(M.steel, beam(prof(i, k - 1), prof(i, k), 0.14, 0.32));
    }
    for (const k of [3, 6, 9, 12]) for (let i = 1; i < us.length; i++) add(M.steel, beam(prof(i - 1, k), prof(i, k), 0.08));
    for (let i = 1; i < us.length; i++) { const a = prof(i - 1, K), b = prof(i, K); add(M.concrete, beam([a[0], 0.2, a[2]], [b[0], 0.2, b[2]], 0.5, 0.4)); }
    // entrance portal (paid door of the forecourt) : steel frame
    const e0 = [ent[0], plan.vFront(ent[0])], e1 = [ent[1], plan.vFront(ent[1])];
    for (const e of [e0, e1]) add(M.steel, beam([e[0], 0, e[1]], [e[0], 3.7, e[1]], 0.22));
    add(M.steel, beam([e0[0], 3.7, e0[1]], [e1[0], 3.7, e1[1]], 0.26, 0.4));
    // floor of the gallery (polished stone, like the hall), LED uplights along the facade
    add(M.floor, flatPoly(vf, 0.012));
    for (let u = vf[0][0] + 6; u < vf[vf.length - 1][0] - 4; u += 6) add(M.led, bx(u - 0.3, u + 0.3, v1 + 0.2, v1 + 0.5, 0, 0.12));
    // boarded-up shop fronts in the gallery (wings)
    for (const [a, b] of [[vf[0][0] + 4, cen0 - 1], [cen1 + 1, vf[vf.length - 1][0] - 4]]) {
      for (let u = a; u + 5 <= b; u += 6.4) {
        add(M.iron, bx(u, u + 5, v1 + 0.02, v1 + 0.1, 0.2, 3.8)); // shop front : dark steel shutter, a few boards nailed across
        for (let k = 0; k < 3; k++) add(M.wood, beam([u - 0.1, 0.8 + k * 1.1 + hash(u, k) * 0.3, v1 + 0.14], [u + 5.1, 1.0 + k * 1.1 - hash(k, u) * 0.3, v1 + 0.14], 0.24, 0.05));
      }
    }
  }

  // ================================================================ train shed (1883) : two naves of lattice arches
  {
    const S = G.shed;
    const naves = plan.shed.map((n) => ({ ...n }));
    for (let i = 1; i < naves.length; i++) { const a = naves[i - 1], b = naves[i]; if (Math.abs(a.v0 - b.v1) < 1.5) a.v0 = b.v1 = (a.v0 + b.v1) / 2; } // shared column line
    for (const nave of naves) {
      const va = nave.v0, vb = Math.min(nave.v1, B.v0 - T / 2), span = vb - va, vm = (va + vb) / 2;
      const rise = S.crown - S.spring, R = (span * span / 4 + rise * rise) / (2 * rise), yc = S.crown - R;
      const a0 = Math.asin((span / 2) / R);
      const arcPt = (t, r) => { const a = -a0 + 2 * a0 * t; return [vm + Math.sin(a) * r, yc + Math.cos(a) * r]; }; // [v, y]
      const N = 22;
      const nArch = Math.max(2, Math.round((nave.u1 - nave.u0) / S.archEvery));
      for (let i = 0; i <= nArch; i++) {
        const u = nave.u0 + ((nave.u1 - nave.u0) * i) / nArch;
        for (let k = 0; k < N; k++) {
          const [va0, ya0] = arcPt(k / N, R), [va1, ya1] = arcPt((k + 1) / N, R), [vi0, yi0] = arcPt(k / N, R - 0.75), [vi1, yi1] = arcPt((k + 1) / N, R - 0.75);
          add(M.iron, beam([u, ya0, va0], [u, ya1, va1], 0.16, 0.22));
          add(M.iron, beam([u, yi0, vi0], [u, yi1, vi1], 0.14, 0.18));
          add(M.iron, beam([u, k % 2 ? yi0 : ya0, k % 2 ? vi0 : va0], [u, k % 2 ? ya1 : yi1, k % 2 ? va1 : vi1], 0.07));
        }
        // columns (cast iron : base, fluted shaft, capital, bracket) ; on the building side the arch rests on a corbel
        for (const [vv, wall] of [[va, false], [vb, vb >= B.v0 - T]]) {
          const [, yS] = arcPt(vv === va ? 0 : 1, R);
          if (wall) { add(M.sandTrim, bx(u - 0.5, u + 0.5, vv - 0.5, vv + 0.05, yS - 1.4, yS)); continue; }
          add(M.iron, cyl(u, vv, 0, 0.5, 0.42, 0.36, 10));
          colliders.push({ u, v: vv, lu: 0.8, lv: 0.8, rot: 0, h: Infinity });
          add(M.iron, cyl(u, vv, 0.5, yS - 1.0, 0.2, 0.17, 10));
          add(M.iron, cyl(u, vv, yS - 0.5, 0.5, 0.2, 0.36, 10));
          for (const s of [-1, 1]) add(M.iron, beam([u, yS - 2.6, vv], [u, yS - 0.1, vv + s * 2.0], 0.1));
        }
      }
      // purlins and the roof : corrugated sheet with a glazed skylight band at the crown
      for (let k = 0; k <= N; k += 2) { const [vv, yy] = arcPt(k / N, R + 0.15); add(M.iron, beam([nave.u0, yy, vv], [nave.u1, yy, vv], 0.12)); }
      const pos = [], uv = [], posG = [], uvG = [];
      for (let k = 0; k < N; k++) {
        const [v0, y0] = arcPt(k / N, R + 0.25), [v1, y1] = arcPt((k + 1) / N, R + 0.25);
        const sky = Math.abs(k + 0.5 - N / 2) < 2.6;
        const P = sky ? posG : pos, U = sky ? uvG : uv;
        const c = [[nave.u0 - 1.2, y0, v0], [nave.u1 + 1.2, y0, v0], [nave.u1 + 1.2, y1, v1], [nave.u0 - 1.2, y1, v1]];
        for (const j of [0, 1, 2, 0, 2, 3]) { P.push(c[j][2], c[j][1], -c[j][0]); U.push(c[j][0] / 2, (k + (j === 2 || j === 3 ? 1 : 0)) * (2 * a0 * R / N) / 2); }
      }
      for (const [P, U, mat] of [[pos, uv, M.roofSheet], [posG, uvG, M.skylight]]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals(); add(mat, g); }
      // gable ends : valance (fringe) and a glazed screen with radiating bars
      for (const u of [nave.u0 - 1.2, nave.u1 + 1.2]) {
        for (let k = 0; k < N; k++) {
          const [v0, y0] = arcPt(k / N, R + 0.25), [v1, y1] = arcPt((k + 1) / N, R + 0.25), [w0, z0] = arcPt(k / N, R - 0.6), [w1, z1] = arcPt((k + 1) / N, R - 0.6);
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute([v0, y0, -u, v1, y1, -u, w1, z1, -u, v0, y0, -u, w1, z1, -u, w0, z0, -u], 3)); g.computeVertexNormals();
          add(M.zinc, g);
          { const [bv, by] = arcPt(k / N, R - 0.6); if (k % 2 === 0 && by > S.spring + 2.4) add(M.iron, beam([u, S.spring + 2.2, vm], [u, by, bv], 0.06)); }
        }
        const fan = []; const yb = S.spring + 2.2;
        for (let k = 0; k < N; k++) { const [v0, y0] = arcPt(k / N, R - 0.6), [v1, y1] = arcPt((k + 1) / N, R - 0.6); if (y0 < yb || y1 < yb) continue; fan.push(vm, yb, -u, v0, y0, -u, v1, y1, -u); }
        if (fan.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fan, 3)); g.computeVertexNormals(); add(M.skylight, g); }
        add(M.iron, beam([u, yb, va + 2], [u, yb, vb - 2], 0.18, 0.3));
      }
      // hanging lamps over the platforms
      for (let u = nave.u0 + 6; u < nave.u1 - 3; u += 16) for (const vv of [vm - span * 0.25, vm + span * 0.25]) {
        add(M.iron, beam([u, 5.6, vv], [u, arcPt(0.5, R - 0.75)[1], vv], 0.03));
        add(M.zinc, new THREE.ConeGeometry(0.42, 0.35, 12, 1, true).translate(vv, 5.45, -u));
        add(M.lamp, new THREE.SphereGeometry(0.16, 8, 6).translate(vv, 5.3, -u));
      }
    }
  }

  // ================================================================ platforms, tracks, the dead train
  {
    const top = G.platformY, bot = G.railY;
    for (const p of gare.platforms || []) {
      const pts = loc(p.pts);
      if (/^230/.test(p.ref || '')) continue; // CTS platforms : see the tram stop
      let minU = Infinity, maxU = -Infinity; for (const [u] of pts) { minU = Math.min(minU, u); maxU = Math.max(maxU, u); }
      const c = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length], [0, 0]);
      if (Math.abs(c[0]) > 260 || c[1] < -140 || c[1] > -5) continue;
      try { add(M.concrete, slab(pts, bot, top)); } catch { /* degenerate outline */ }
      // edge lines : white line at the edge, yellow tactile strip 0.9 m in (along the long edges)
      for (const side of [0, 1]) {
        const line = [];
        for (let u = Math.ceil(minU + 1); u <= maxU - 1; u += 3) { const s = scanV(pts, u); if (s && s[1] - s[0] > 3) line.push([u, s[side]]); }
        if (p.ref === '1' && side === 1) continue; // quai 1 : the building side
        const inward = side === 0 ? 1 : -1;
        for (let i = 1; i < line.length; i++) {
          const [a, b] = [line[i - 1], line[i]];
          add(M.white, flatPoly([[a[0], a[1] + inward * 0.05], [b[0], b[1] + inward * 0.05], [b[0], b[1] + inward * 0.2], [a[0], a[1] + inward * 0.2]].sort(() => 0), top + 0.004));
          add(M.tactile, flatPoly([[a[0], a[1] + inward * 0.75], [b[0], b[1] + inward * 0.75], [b[0], b[1] + inward * 1.15], [a[0], a[1] + inward * 1.15]], top + 0.004));
        }
      }
    }
    // rail yard ground (ballast) under everything west of the building
    add(M.ballast, flatPoly([[-260, -150], [260, -150], [260, B.v0 - 0.2], [-260, B.v0 - 0.2]], bot));
    // tracks (v0.80.0, railNet.trackGeometry) : SNCF Réseau shapes (rail.json) clipped to the station box, except the pieces the intro route
    // follows : the route itself is laid instead (moved beside quai 1, see CONFIG.railNet.route). Mesh frame : X = v, Z = -u.
    const tg = {}, toMesh = ([u, v]) => [v, -u];
    const offRoute = (x, z) => !route || route.track.project(x, z, 2, _pr).d > 1.6;
    const _pr = {};
    let phase = 0;
    const lay = (pts) => { if (pts.length > 1) trackGeometry(pts.map(toMesh), bot, tg, { phase: (phase += 0.23) % CONFIG.railNet.sleeperEvery }); };
    for (const t of rail.tracks || []) {
      if (t.type === 'OSM') continue;
      let run = [];
      const dense = [];
      for (let i = 1; i < t.pts.length; i++) { const [ax, az] = t.pts[i - 1], [bx, bz] = t.pts[i], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 2)); for (let k = i === 1 ? 0 : 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]); }
      for (const [x, z] of dense) {
        const [u, v] = L(x, z);
        if (inStationClip(plan, u, v) && offRoute(x, z)) run.push([u, v]); else { lay(run); run = []; }
      }
      lay(run);
    }
    if (route) { // the route inside the station box
      let run = [];
      for (let i = 0; i < route.track.n; i++) { const [u, v] = L(route.track.x[i], route.track.z[i]); if (inStationClip(plan, u, v)) run.push([u, v]); else { lay(run); run = []; } }
      lay(run);
    }
    for (const g of tg.ballast || []) add(M.ballast, g);
    for (const g of tg.sleeper || []) add(M.sleeper, g);
    for (const g of tg.rail || []) add(M.rail, g);
    // timber footbridges over the two tracks between quai 1 and quai 2/3 (deck at platform level, trestles, railings)
    for (const c of plan.crossings) {
      add(M.wood, slab(c, top - 0.22, top));
      const u0 = c[0][0], u1 = c[2][0], va = c[0][1], vb = c[1][1];
      for (const u of [u0 + 0.3, u1 - 0.3]) {
        for (const v of [(va + vb) / 2]) add(M.wood, bx(u - 0.12, u + 0.12, v - 0.12, v + 0.12, bot, top - 0.22));
        add(M.iron, beam([u, 1.05, va], [u, 1.05, vb], 0.06)); add(M.iron, beam([u, 0.55, va], [u, 0.55, vb], 0.04));
        for (let k = 0; k <= 4; k++) { const v = va + ((vb - va) * k) / 4; add(M.iron, beam([u, 0, v], [u, 1.05, v], 0.05)); }
      }
      for (let u = u0 + 0.25; u < u1; u += 0.3) add(M.rubber, bx(u, u + 0.02, va, vb, top - 0.003, top + 0.002)); // plank joints
    }
  }

  // ================================================================ Place de la Gare : paving, roads, tram stop, lamps, barriers
  {
    // paving : the whole forecourt side, clipped at x = -851 (the island ground starts there)
    const big = [[-175, B.v0 + 1], [180, B.v0 + 1], [180, 215], [-175, 215]].map(([u, v]) => plan.W(u, v));
    const clipped = clipX(big, -851);
    if (clipped.length >= 3) add(M.paving, flatPoly(loc(clipped), 0));
    // roads (OSM) : asphalt ribbons over the paving
    for (const r of gare.roads || []) {
      if (!['secondary', 'busway'].includes(r.type)) continue;
      const w = r.type === 'secondary' ? 3.5 : 1.8, pts = loc(r.pts);
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.1) continue;
        const nu = -(b[1] - a[1]) / len * w, nv = (b[0] - a[0]) / len * w;
        const quad = [[a[0] + nu, a[1] + nv], [b[0] + nu, b[1] + nv], [b[0] - nu, b[1] - nv], [a[0] - nu, a[1] - nv]];
        if (quad.some(([u, v]) => plan.W(u, v)[0] > -853)) continue;
        add(M.asphalt, flatPoly(quad, 0.008));
      }
    }
    // CTS line C : grooved rails in a concrete slab, the two platforms, shelters, totem
    const st = plan.stop, tr = loc(st.track).filter(([u, v]) => v < 95);
    for (let i = 1; i < tr.length; i++) {
      const [a, b] = [tr[i - 1], tr[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.1) continue;
      const nu = -(b[1] - a[1]) / len, nv = (b[0] - a[0]) / len;
      add(M.concrete, flatPoly([[a[0] + nu * 1.4, a[1] + nv * 1.4], [b[0] + nu * 1.4, b[1] + nv * 1.4], [b[0] - nu * 1.4, b[1] - nv * 1.4], [a[0] - nu * 1.4, a[1] - nv * 1.4]], 0.006));
      for (const s of [-1, 1]) add(M.rail, beam([a[0] + nu * s * 0.7175, 0.0, a[1] + nv * s * 0.7175], [b[0] + nu * s * 0.7175, 0.0, b[1] + nv * s * 0.7175], 0.08, 0.03));
    }
    const sl = st.l; // stop centre (local)
    for (const p of (gare.platforms || []).filter((q) => /^230G/.test(q.ref || ''))) {
      const pts = loc(p.pts);
      try { add(M.concrete, slab(pts, 0, 0.05)); } catch { /* ignore */ }
      const c = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length], [0, 0]);
      // shelter : steel frame, glass back, dark roof with a light strip, bench
      const su = c[0], sv = sl[1] + 6;
      add(M.ctsGreen, bx(su - 0.9, su + 0.9, sv - 3, sv + 3, 2.55, 2.7));
      add(M.led, bx(su - 0.6, su + 0.6, sv - 2.6, sv + 2.6, 2.5, 2.55));
      for (const dv of [-2.8, 2.8]) add(M.steel, bx(su + (su > sl[0] ? 0.7 : -0.8), su + (su > sl[0] ? 0.8 : -0.7), sv + dv - 0.05, sv + dv + 0.05, 0, 2.55));
      add(M.verre, bx(su + (su > sl[0] ? 0.72 : -0.78), su + (su > sl[0] ? 0.78 : -0.72), sv - 2.8, sv + 2.8, 0.15, 2.5));
      add(M.wood, bx(su - 0.2 + (su > sl[0] ? 0.3 : -0.3), su + 0.2 + (su > sl[0] ? 0.3 : -0.3), sv - 1.5, sv + 1.5, 0.45, 0.52));
      colliders.push({ u: su + (su > sl[0] ? 0.75 : -0.75), v: sv, lu: 0.2, lv: 5.8, rot: 0, h: 2.6 });
    }
    // name totem « Gare Centrale » (emissive sign) near the buffer
    {
      const tu = sl[0] - 4.6, tv = sl[1] - 14;
      add(M.ctsGreen, bx(tu - 0.25, tu + 0.25, tv - 0.25, tv + 0.25, 0, 3.4));
      const sg = new THREE.PlaneGeometry(1.6, 0.42); const smat = new THREE.MeshStandardMaterial({ map: signTex('Gare Centrale', 'Tram C · A · D'), emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 }); smat.emissiveMap = smat.map;
      for (const s of [1, -1]) { const g = sg.clone(); g.rotateY(s > 0 ? 0 : Math.PI); g.translate(tv, 2.9, -tu + s * 0.27); add(smat, g); }
      colliders.push({ u: tu, v: tv, lu: 0.5, lv: 0.5, rot: 0, h: 3.4 });
      // buffer stop at the end of the track
      const bl = L(st.buffer[0], st.buffer[1]);
      add(M.rust, bx(bl[0] - 1.2, bl[0] + 1.2, bl[1] - 0.6, bl[1] - 0.1, 0, 1.1)); add(M.lamp, bx(bl[0] - 0.2, bl[0] + 0.2, bl[1] - 0.05, bl[1], 0.8, 1.0));
    }
    // catenary poles along the C track
    for (let i = 1; i < tr.length; i += 1) {
      const [u, v] = tr[i]; if (v > 70) continue;
      add(M.steel, cyl(u - 3.4, v, 0, 6.2, 0.13, 0.1, 8)); add(M.steel, beam([u - 3.4, 5.9, v], [u + 0.4, 5.9, v], 0.06));
      colliders.push({ u: u - 3.4, v, lu: 0.35, lv: 0.35, rot: 0, h: 6 });
    }
    // street lamps (the lit spots of plan.lights on the forecourt)
    for (const l of plan.lights) {
      if (!l.post) continue;
      const [u, v] = l.l;
      add(M.iron, cyl(u, v, 0, 6.2, 0.14, 0.08, 10)); add(M.iron, cyl(u, v, 0, 0.6, 0.24, 0.2, 10));
      add(M.lamp, new THREE.SphereGeometry(0.26, 10, 8).scale(1, 1.3, 1).translate(v, 6.45, -u)); add(M.zinc, new THREE.ConeGeometry(0.42, 0.3, 10).translate(v, 6.85, -u));
      colliders.push({ u, v, lu: 0.4, lv: 0.4, rot: 0, h: 6 });
    }
    // underground tram entrances (lines A / D) : glass pavilions, escalators blocked by debris
    for (const [u, v] of [[14, 62], [26, 62]]) {
      add(M.steel, bx(u - 1.8, u + 1.8, v - 4, v + 4, 2.9, 3.05));
      for (const [du, dv] of [[-1.8, -4], [1.8, -4], [-1.8, 4], [1.8, 4]]) add(M.steel, bx(u + du - 0.06, u + du + 0.06, v + dv - 0.06, v + dv + 0.06, 0, 2.9));
      add(M.verre, bx(u - 1.8, u + 1.8, v + 3.95, v + 4.0, 0.1, 2.9)); for (const s of [-1, 1]) add(M.verre, bx(u + s * 1.8 - 0.03, u + s * 1.8 + 0.03, v - 4, v + 4, 0.1, 2.9));
      add(M.rubble, bx(u - 1.5, u + 1.5, v - 3.6, v + 3.6, 0, 0.9));
      colliders.push({ u, v, lu: 3.8, lv: 8.2, rot: 0, h: 3.05 });
    }
  }

  // ================================================================ burnt-out bus across the south-west exit
  {
    const a = plan.outer[6], b = plan.outer[7], uc = (a[0] + b[0]) / 2 + 3, vc = (a[1] + b[1]) / 2 - 2, ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const parts = [];
    const shell = new THREE.Shape(); shell.moveTo(-1.25, 0); shell.lineTo(1.25, 0); shell.lineTo(1.25, 2.7); shell.quadraticCurveTo(1.2, 3.05, 0.9, 3.08); shell.lineTo(-0.9, 3.08); shell.quadraticCurveTo(-1.2, 3.05, -1.25, 2.7); shell.lineTo(-1.25, 0);
    const body = extr(shell, 11.5, 0.05); body.translate(0, 0.45, -5.75); parts.push([body, M.burnt]);
    for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { const w = new THREE.PlaneGeometry(1.5, 1.1); w.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2); w.translate(s * 1.31, 2.25, -4.5 + k * 1.75); parts.push([w, M.glassDark]); }
    for (const z of [-3.6, 3.9]) for (const s of [-1, 1]) { const w = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14); w.rotateZ(Math.PI / 2); w.translate(s * 1.05, 0.5, z); parts.push([w, M.rubber]); }
    parts.push([new THREE.BoxGeometry(2.6, 0.15, 11.6).translate(0, 3.12, 0).rotateZ(0.04), M.rust]);
    for (const [g, mat] of parts) { g.rotateY(-ang); g.translate(vc, 0, -uc); add(mat, g); }
    colliders.push({ u: uc, v: vc, lu: 11.8, lv: 2.6, rot: ang, h: 3.2, alongU: true });
  }

  flush(local);

  // ---------------------------------------------------------------- instanced props (props.js library) : barriers, benches, boards, bikes, cars
  const inst = new Map(); // type -> [Matrix4]
  const put = (type, u, v, yawLocal, s = 1) => {
    const [x, z] = plan.W(u, v);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawLocal + local.rotation.y, 0)), new THREE.Vector3(s, s, s));
    (inst.get(type) || inst.set(type, []).get(type)).push(m);
  };
  // crowd barriers along every barrier wall, concrete blocks every few metres ; platform end barricades
  for (const w of plan.walls) {
    if (w.kind !== 'barrier') continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), n = Math.max(1, Math.round(len / 2.05));
    const ang = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]); // local direction (u, v) -> yaw : prop x axis along the segment
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, u = w.a[0] + (w.b[0] - w.a[0]) * t, v = w.a[1] + (w.b[1] - w.a[1]) * t;
      put(i % 5 === 2 ? 'jersey' : 'crowd', u, v, Math.PI / 2 - ang);
    }
  }
  for (const u of [plan.walls.length ? G.playU[0] : 0, G.playU[1]]) for (const vv of [B.v0 - 3, B.v0 - 7, plan.at(plan.q23E, u) - 3, plan.at(plan.q23W, u) + 3]) put('crate', u + (u < 0 ? -1.2 : 1.2), vv, hash(u, vv) * 3);
  for (const f of gare.furniture || []) {
    const [u, v] = L(f.p[0], f.p[1]);
    if (!inPoly(plan.placeL, u, v)) continue;
    if (f.kind === 'bench') { put('bench', u, v, hash(u, v) > 0.5 ? 0 : Math.PI / 2); colliders.push({ u, v, lu: 1.9, lv: 0.6, rot: 0, h: 0.9, vault: true, prop: true }); }
    else if (f.kind === 'bicycle_parking' && hash(u, v, 5) > 0.55) put('bike', u, v, Math.PI / 2 + hash(u, v) * 0.3);
    else if (f.kind === 'waste_basket') put('bin', u, v, 0);
  }
  for (const f of gare.extraFurniture || []) {
    const [u, v] = L(f.p[0], f.p[1]);
    if (!inPoly(plan.placeL, u, v) || nearCollider(colliders, u, v, 1.2)) continue;
    if (f.kind === 'board') put('board', u, v, hash(u, v) * TAU);
    else if (f.kind === 'column') put('column', u, v, 0);
  }
  for (const [u, v, a] of [[60, 108, 0.4], [-30, 112, 0.1], [104, 66, 1.4], [-96, 40, 2.6]]) { put('car', u, v, a); colliders.push({ u, v, lu: 4.4, lv: 1.9, rot: a, h: 1.5, prop: true }); }
  for (const u of [-50, -20, 15, 40]) put('bench', u, B.v0 - 3.2, 0); // platform benches
  const P = props.lib;
  for (const [type, list] of inst) {
    for (const [geo, mat] of P[type] || []) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => { im.setMatrixAt(i, m); if (type === 'car' && geo === P.car[0][0]) im.setColorAt(i, new THREE.Color(0x2a2826)); });
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.name = 'gare:' + type;
      root.add(im);
    }
  }
  for (const u of [-50, -20, 15, 40]) colliders.push({ u, v: B.v0 - 3.2, lu: 1.9, lv: 0.6, rot: 0, h: 0.9, vault: true, prop: true });

  // ---------------------------------------------------------------- platform signs and screens (emissive, local)
  {
    const mk = (t, s) => { const m = new THREE.MeshStandardMaterial({ map: signTex(t, s), emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.5 }); m.emissiveMap = m.map; return m; };
    const signs = [[mk('Quai 1', 'Voie A · B'), (u) => [u, B.v0 - 4.5]], [mk('Quai 2 / 3', 'Voies C · D'), (u) => [u, (plan.at(plan.q23E, u) + plan.at(plan.q23W, u)) / 2]]];
    for (const [mat, at] of signs) for (const u of [-40, 0, 40]) {
      const [uu, vv] = at(u);
      add(M.iron, beam([uu, 0, vv], [uu, 3.1, vv], 0.08));
      for (const s of [1, -1]) { const g = new THREE.PlaneGeometry(1.7, 0.42); g.rotateY(s > 0 ? Math.PI : 0); g.translate(vv, 3.3, -uu - s * 0.03); add(mat, g); }
      colliders.push({ u: uu, v: vv, lu: 0.3, lv: 0.3, rot: 0, h: 3 });
    }
    flush(local);
  }
  return { root, local, colliders, mats: M };
}

// polygon helpers
export function scanV(poly, c) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [u0, v0] = poly[i], [u1, v1] = poly[(i + 1) % poly.length];
    if ((u0 - c) * (u1 - c) > 0 || u0 === u1) continue;
    const v = v0 + ((v1 - v0) * (c - u0)) / (u1 - u0);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return lo <= hi ? [lo, hi] : null;
}
function clipX(poly, xMax) { // Sutherland-Hodgman against x <= xMax (world)
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = a[0] <= xMax, ib = b[0] <= xMax;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (xMax - a[0]) / (b[0] - a[0]); out.push([xMax, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
function inPoly(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const nearCollider = (cs, u, v, r) => cs.some((c) => Math.abs(c.u - u) < c.lu / 2 + r && Math.abs(c.v - v) < c.lv / 2 + r);
