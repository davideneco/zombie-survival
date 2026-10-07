import * as THREE from 'three';
import { halberdierGeometries, mergeParts } from './ironArmor.js';

// =====================================================================
//  Place de l'Homme de Fer (Strasbourg) : rotonde de verre du tram, abris de quai, rails, quais, rames Eurotram
//  à l'arrêt, totems et statue de l'Homme de Fer.
//  Décor 100 % déterministe : aucun Math.random, toutes les machines construisent exactement le même décor.
//  Trois temps, comme le reste du monde réel (voir realworld.js) :
//    planHdf            : axes des rails et phase des colonnes, par lancers de rayons (grille de collision déjà construite)
//    buildHdfStructures : rotonde et abris (avant la grille de collision définitive : colonnes et abris bloquent)
//    buildHdfDecor      : rails, quais, rames, totems, statue (une fois les zones et les machines placées)
//  Matériaux nouveaux : verre, fer (statue), laiton (statue), acier (structures, quais, rails, pièces sombres des rames),
//  livrée (rames et totems, un seul atlas). Aucune PointLight : seulement des entrées `lightSources`.
// =====================================================================

export const HDF = {
  zone: 'Homme de Fer',
  rotunda: { height: 9, thickness: 0.35, holeRatio: 0.45, colRadius: 0.22, colCircle: 12.5, columns: 12, ribs: 24 },
  shelterHeight: 3,
  // Statue : angle sud-ouest de la façade ouest d'un immeuble (nœud OSM tourism=artwork), normale extérieure
  statue: { x: -267.7, z: -171.5, nx: -0.98, nz: 0.18, offset: 0.35, scale: 0.9, consoleTop: 2.15 },
  rail: { gauge: 1.435, reach: 40, bed: 3.0 },
  tram: { module: 4.7, body: 4.4, width: 2.4, height: 3.4, floor: 0.32, minReach: 8, maxReach: 45, side: 1.5 },
};

// Un `building=roof` en l'air (min_height >= 2,5 m) : la rotonde du tram. Les verrières posées au sol (sans min_height) restent
// de simples bâtiments.
export const isRotunda = (tags) => tags.building === 'roof' && (parseFloat(tags.min_height) || 0) >= 2.5;

// Abri de quai sans hauteur ni niveaux dans OSM : l'extraction lui a tiré une hauteur d'immeuble au hasard (12 à 18 m).
export const isOpenShelter = (tags) => tags.amenity === 'shelter' && tags.height == null && tags['building:levels'] == null && !isRotunda(tags);

// Aléatoire reproductible (textures et salissures)
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ géométrie : petits outils
const colorize = (g, hex) => {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
// Boîte colorée : dimensions, centre, rotation autour de y
const boxAt = (w, h, d, x, y, z, color, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return colorize(g, color); };
// UV en mètres (le verre est une texture de 8 m de côté) pour un panneau de direction (ux, uz)
const metricUV = (g, ux, uz) => {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * ux + p.getZ(i) * uz, p.getY(i));
  return g;
};

// ------------------------------------------------------------------ matériaux (créés une fois)
let MATS = null;
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function mats() {
  if (MATS) return MATS;
  // verre : carreaux et montants (cellules de 2 m, texture de 8 m)
  const glassTex = canvasTex(512, 512, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const g = x.createLinearGradient(i * 128, j * 128, i * 128 + 128, j * 128 + 128);
      g.addColorStop(0, 'rgba(205,236,244,0.95)'); g.addColorStop(0.5, 'rgba(160,205,220,0.8)'); g.addColorStop(1, 'rgba(190,226,238,0.9)');
      x.fillStyle = g; x.fillRect(i * 128, j * 128, 128, 128);
    }
    x.strokeStyle = 'rgba(32,38,44,1)'; x.lineWidth = 12;
    for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(k * 128, 0); x.lineTo(k * 128, h); x.moveTo(0, k * 128); x.lineTo(w, k * 128); x.stroke(); }
  });
  glassTex.wrapS = glassTex.wrapT = THREE.RepeatWrapping;
  glassTex.repeat.set(1 / 8, 1 / 8);
  MATS = {
    glass: new THREE.MeshStandardMaterial({ map: glassTex, color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide }),
    iron: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.85, roughness: 0.4, emissive: 0x14161a }), // un peu d'émission : sans reflets (pas d'envmap) un métal sombre serait noir pur
    brass: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.8, roughness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.6 }),
  };
  return MATS;
}

// ------------------------------------------------------------------ plan : axes des rails et phase des colonnes
function ringInfo(pts) {
  const n = pts.length;
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x / n; cz += z / n; }
  let R = 0;
  for (const [x, z] of pts) R += Math.hypot(x - cx, z - cz) / n;
  return { cx, cz, R };
}

export const rotundaInfo = (pts) => ({ pts, ...ringInfo(pts) });

// Les deux directions les plus dégagées autour de la rotonde (lancers de rayons à 1 m du sol depuis un cercle de 14 m, juste hors
// des colonnes), à au moins 40° l'une de l'autre ; puis la phase des colonnes qui les éloigne le plus des rails.
export function planHdf(collision, cx, cz) {
  const free = (deg) => { // trois rayons parallèles (axe et ±1,6 m) : le lit des rails (3 m) ne doit pas raser une façade
    const a = (deg * Math.PI) / 180, ux = Math.cos(a), uz = Math.sin(a);
    return 14 + Math.min(...[-1.6, 0, 1.6].map((o) => collision.rayHit(cx + ux * 14 - uz * o, 1, cz + uz * 14 + ux * o, ux, 0, uz, 80)));
  };
  const cand = [];
  for (let d = 0; d < 180; d += 5) { const f = free(d), b = free(d + 180); cand.push({ deg: d, f, b, score: Math.min(f, 45) + Math.min(b, 45) }); }
  const sep = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
  const first = cand.reduce((p, c) => (c.score > p.score ? c : p), cand[0]);
  const second = cand.filter((c) => sep(c.deg, first.deg) >= 40).reduce((p, c) => (!p || c.score > p.score ? c : p), null) || cand[0];
  const axes = [first, second].map((a) => {
    const r = (a.deg * Math.PI) / 180;
    return { deg: a.deg, ux: Math.cos(r), uz: Math.sin(r), f: a.f, b: a.b };
  });
  const step = 360 / HDF.rotunda.columns;
  let phase = 0, best = -1;
  for (let ph = 0; ph < step; ph++) { // éloigne chaque axe de la colonne la plus proche
    const away = (deg) => { const m = (((deg - ph) % step) + step) % step; return Math.min(m, step - m); };
    const s = Math.min(away(axes[0].deg), away(axes[1].deg));
    if (s > best) { best = s; phase = ph; }
  }
  return { axes, colPhase: phase, cx, cz };
}

// Distance d'un point au plus proche des deux axes de rails (m), Infinity au-delà de leur portée : les machines et les armes
// murales de la zone ne se posent pas sur les rails
export function railDist(plan, x, z) {
  let m = Infinity;
  for (const a of plan.axes) {
    const s = (x - plan.cx) * a.ux + (z - plan.cz) * a.uz, lat = Math.abs(-(x - plan.cx) * a.uz + (z - plan.cz) * a.ux);
    if (s > -(HDF.rail.reach + 2) && s < HDF.rail.reach + 2) m = Math.min(m, lat);
  }
  return m;
}

// ------------------------------------------------------------------ abris : rectangle orienté, dos du côté extérieur
export function shelterInfo(pts, from) {
  const { cx, cz } = ringInfo(pts);
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const l = Math.hypot(bx - ax, bz - az);
    if (l > best) { best = l; ux = (bx - ax) / l; uz = (bz - az) / l; }
  }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = (x - cx) * ux + (z - cz) * uz, v = -(x - cx) * uz + (z - cz) * ux;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const len = u1 - u0, dep = v1 - v0;
  const mx = cx + (ux * (u0 + u1)) / 2 - (uz * (v0 + v1)) / 2, mz = cz + (uz * (u0 + u1)) / 2 + (ux * (v0 + v1)) / 2;
  const away = (mx - from[0]) * -uz + (mz - from[1]) * ux; // le dos est du côté opposé à la place
  return { x: mx, z: mz, ux, uz, len, dep, back: away >= 0 ? 1 : -1 };
}

// ------------------------------------------------------------------ rotonde et abris
const meshOf = (scene, geo, mat, { shadow = false, receive = false, name = 'hdf' } = {}) => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = receive; m.name = 'hdf:' + name;
  scene.add(m);
  return m;
};

// rotundas : [{ pts, cx, cz, R }] ; shelters : [shelterInfo] ; plan : planHdf (phase des colonnes)
export function buildHdfStructures({ scene, collision, lightSources, rotundas, shelters, plan }) {
  const M = mats(), C = HDF.rotunda;
  const out = { columns: [], rotundas: [], shelters: [] };
  const steel = []; // pièces d'acier (sommets colorés)

  for (const r of rotundas) {
    // colonnes (seule la rotonde sauf ses colonnes reste praticable : la place doit rester libre sous le verre)
    const cols = [];
    for (let k = 0; k < C.columns; k++) {
      const a = ((plan.colPhase + (k * 360) / C.columns) * Math.PI) / 180;
      cols.push([r.cx + Math.cos(a) * C.colCircle, r.cz + Math.sin(a) * C.colCircle, a]);
    }
    for (const [x, z] of cols) collision.addCircle(x, z, C.colRadius, C.height, -Infinity, 'wall'); // colonne : architecture
    out.columns.push(...cols.map(([x, z]) => [x, z]));
    out.rotundas.push({ cx: r.cx, cz: r.cz, R: r.R });

    // anneau de verre : forme extérieure = contour OSM, trou à 0,45 R, entre 8,65 et 9 m
    const shape = new THREE.Shape(r.pts.map(([x, z]) => new THREE.Vector2(x - r.cx, z - r.cz)));
    shape.holes.push(new THREE.Path(r.pts.map(([x, z]) => new THREE.Vector2((x - r.cx) * C.holeRatio, (z - r.cz) * C.holeRatio))));
    const glass = new THREE.ExtrudeGeometry(shape, { depth: C.thickness, bevelEnabled: false });
    glass.rotateX(Math.PI / 2); // (x, y, z) -> (x, -z, y) : l'épaisseur descend de 9 m
    glass.translate(r.cx, C.height, r.cz);
    meshOf(scene, glass, M.glass, { name: 'rotunda-glass' }); // castShadow off : le verre ne fait pas d'ombre

    // nervures radiales sous le verre (24) et colonnes (12) : InstancedMesh
    const rIn = r.R * C.holeRatio, rOut = r.R - 0.35, len = rOut - rIn;
    const ribGeo = colorize(new THREE.BoxGeometry(1, 1, 1), 0x8d969e);
    const ribs = new THREE.InstancedMesh(ribGeo, M.steel, C.ribs);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(len, 0.2, 0.14), up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < C.ribs; k++) {
      const a = ((plan.colPhase + (k * 360) / C.ribs) * Math.PI) / 180, rm = (rIn + rOut) / 2;
      q.setFromAxisAngle(up, -a);
      m4.compose(new THREE.Vector3(r.cx + Math.cos(a) * rm, C.height - C.thickness - 0.1, r.cz + Math.sin(a) * rm), q, sc);
      ribs.setMatrixAt(k, m4);
    }
    ribs.frustumCulled = false; ribs.instanceMatrix.needsUpdate = true;
    ribs.name = 'hdf:ribs'; scene.add(ribs);
    const colGeo = mergeParts([
      new THREE.CylinderGeometry(C.colRadius, C.colRadius * 1.15, C.height - C.thickness - 0.2, 10).translate(0, (C.height - C.thickness - 0.2) / 2 + 0.2, 0),
      new THREE.CylinderGeometry(C.colRadius * 1.6, C.colRadius * 1.6, 0.2, 10).translate(0, 0.1, 0),
      new THREE.CylinderGeometry(C.colRadius * 1.5, C.colRadius * 1.5, 0.16, 10).translate(0, C.height - C.thickness - 0.28, 0),
    ], 0x8d969e);
    const colMesh = new THREE.InstancedMesh(colGeo, M.steel, cols.length);
    cols.forEach(([x, z], k) => { m4.makeTranslation(x, 0, z); colMesh.setMatrixAt(k, m4); });
    colMesh.castShadow = true; colMesh.frustumCulled = false; colMesh.instanceMatrix.needsUpdate = true;
    colMesh.name = 'hdf:columns'; scene.add(colMesh);
    // couronne intérieure (autour du trou)
    const crown = new THREE.TorusGeometry(rIn, 0.1, 6, 40); crown.rotateX(Math.PI / 2); crown.translate(r.cx, C.height - C.thickness - 0.1, r.cz);
    steel.push(colorize(crown, 0x8d969e));
    // 6 sources de lumière froide sous le verre (réparties dans `lightSources`, aucune PointLight en plus)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      lightSources.push({ x: r.cx + Math.cos(a) * 10, y: 8.1, z: r.cz + Math.sin(a) * 10, color: 0xcfe6ff, intensity: 20, dist: 16 });
    }
  }

  // abris de quai : panneau vitré au dos, toit, poteaux, banc. Collision : panneau arrière et poteaux
  const glassParts = [];
  const ironShelter = [];
  for (const s of shelters) {
    const H = HDF.shelterHeight, nz = s.back; // z local = côté du dos (le repère local a +z = (-uz, ux))
    const theta = Math.atan2(-s.uz, s.ux);
    const place = (g) => { g.rotateY(theta); g.translate(s.x, 0, s.z); return g; };
    const panel = new THREE.BoxGeometry(s.len - 0.2, 2.4, 0.04); panel.translate(0, 1.3, nz * (s.dep / 2 - 0.08));
    glassParts.push(metricUV(place(panel), s.ux, s.uz));
    const add = (w, h, d, x, y, z, col) => ironShelter.push(place(boxAt(w, h, d, x, y, z, col)));
    add(s.len + 0.5, 0.1, s.dep + 0.4, 0, H - 0.05, 0, 0x4e565e);                     // toit
    add(s.len + 0.5, 0.14, 0.08, 0, H - 0.17, nz * (s.dep / 2 + 0.16), 0x4e565e);    // chéneau
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.1, H, 0.1, sx * (s.len / 2 - 0.15), H / 2, sz * (s.dep / 2 - 0.15), 0x5a636b); // 4 poteaux
    const n = Math.max(1, Math.round(s.len / 3));
    for (let k = 1; k < n; k++) add(0.06, 2.5, 0.06, -s.len / 2 + (s.len * k) / n, 1.3, nz * (s.dep / 2 - 0.08), 0x5a636b); // montants du panneau
    add(s.len, 0.08, 0.08, 0, 0.1, nz * (s.dep / 2 - 0.08), 0x5a636b);                // soubassement
    add(s.len * 0.5, 0.05, 0.4, 0, 0.45, nz * (s.dep / 2 - 0.4), 0x7a5a38);           // banc
    for (const sx of [-1, 1]) add(0.05, 0.42, 0.34, sx * s.len * 0.22, 0.22, nz * (s.dep / 2 - 0.4), 0x4e565e);
    out.shelters.push({ x: s.x, z: s.z });
  }
  if (glassParts.length) meshOf(scene, mergeParts(glassParts), M.glass, { name: 'shelter-glass' });
  steel.push(...ironShelter);
  if (steel.length) meshOf(scene, mergeParts(steel), M.steel, { shadow: true, receive: true, name: 'structures' });

  for (const s of shelters) { // collision : panneau arrière et deux poteaux
    const nx = -s.uz * s.back, nz = s.ux * s.back;
    const bx = s.x + (nx * s.dep) / 2, bz = s.z + (nz * s.dep) / 2;
    collision.addSegment(bx - (s.ux * s.len) / 2, bz - (s.uz * s.len) / 2, bx + (s.ux * s.len) / 2, bz + (s.uz * s.len) / 2, HDF.shelterHeight, -Infinity, 'prop'); // abri vitré : objet
    for (const k of [-1, 1]) collision.addCircle(s.x - (nx * s.dep) / 2 + s.ux * k * (s.len / 2 - 0.15), s.z - (nz * s.dep) / 2 + s.uz * k * (s.len / 2 - 0.15), 0.1, HDF.shelterHeight, -Infinity, 'prop');
  }
  return out;
}

// ====================================================================================================================
//  Rames Eurotram : profil en rectangle arrondi balayé le long de la rame, nez en demi-ellipsoïde aplati, soufflets noirs
// ====================================================================================================================
const YC = 1.85; // centre vertical du profil (pour réduire le nez)
// profil du côté +z, du bas (plancher) au sommet du toit, puis symétrique : [y, z]
const HALF = [[0.32, 1.2], [0.65, 1.2], [1.1, 1.2], [1.6, 1.2], [2.1, 1.2], [2.55, 1.2], [2.95, 1.2], [3.14, 1.03], [3.29, 0.62], [3.37, 0.0]];
const RING = [...HALF, ...HALF.slice(0, -1).reverse().map(([y, z]) => [y, -z])];
const WALL_TOP = 2.95;
const LIVERY_M = 33; // longueur (m) couverte par la largeur de la livrée

const tClamp = (y) => (y > WALL_TOP + 0.001 ? 0.985 : 0.02 + ((y - 0.32) / (WALL_TOP - 0.32)) * 0.93);
// canvas : ordonnée de la livrée (haut du canvas = toit) pour une hauteur y (m)
const liveryY = (y) => 256 - tClamp(y) * 256;

function sweep(stations, uvFn, colorHex = null) {
  const pos = [], uv = [], idx = [];
  const n = RING.length;
  for (const st of stations) for (const [y, z] of RING) {
    const yy = YC + (y - YC) * st.s, zz = z * st.s;
    pos.push(st.x, yy, zz);
    uv.push(...uvFn(st.x, yy, zz, st));
  }
  for (let i = 0; i + 1 < stations.length; i++) for (let j = 0; j + 1 < n; j++) {
    const a = i * n + j, b = a + 1, c = (i + 1) * n + j + 1, d = (i + 1) * n + j;
    idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return colorHex == null ? g : colorize(g, colorHex);
}

// Un cylindre entre deux points (pantographe)
function strut(a, b, r, color) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return colorize(g, color);
}

// Géométries d'une rame de n modules, repère local : x le long de la rame (nez avant en +x), y vers le haut, centrée en x = 0.
// Retourne { body: livrée (UV dans l'atlas), dark: pièces sombres (sommets colorés) }.
function tramGeometries(n) {
  const T = HDF.tram, L = n * T.module, body = [], dark = [];
  const sideUV = (x, y) => [(x + L / 2) / LIVERY_M, 0.5 + 0.5 * tClamp(y)];
  // projection plane du nez (vu de face : le texte ne doit pas être inversé ; le nez avant et le nez arrière se voient de côtés opposés)
  const noseUV = (flip) => (x, y, z) => [Math.min(0.49, Math.max(0.01, 0.25 + (flip * z / 2.4) * 0.5)), Math.min(0.49, Math.max(0.01, (y / 3.5) * 0.5))];
  const NOSE = 1.7, SEG = 6, half = T.module / 2 - 0.15;
  for (let i = 0; i < n; i++) {
    const c = -L / 2 + T.module / 2 + i * T.module;
    let x0 = c - half, x1 = c + half;
    if (i === 0) { // nez arrière
      const xs = x0 + NOSE, st = [];
      for (let k = SEG; k >= 0; k--) { const t = k / SEG; st.push({ x: xs - NOSE * t, s: Math.sqrt(Math.max(0, 1 - t * t)) }); }
      body.push(sweep(st, noseUV(1))); x0 = xs;
    }
    if (i === n - 1) { // nez avant
      const xs = x1 - NOSE, st = [];
      for (let k = 0; k <= SEG; k++) { const t = k / SEG; st.push({ x: xs + NOSE * t, s: Math.sqrt(Math.max(0, 1 - t * t)) }); }
      body.push(sweep(st, noseUV(-1))); x1 = xs;
    }
    body.push(sweep([{ x: x0, s: 1 }, { x: x1, s: 1 }], sideUV));
    // soufflet vers le module suivant
    if (i < n - 1) dark.push(sweep([{ x: c + half - 0.02, s: 0.97 }, { x: c + T.module / 2, s: 0.92 }, { x: c + T.module - half + 0.02, s: 0.97 }], () => [0, 0], 0x14161a));
    // bogies
    for (const k of [-1, 1]) dark.push(boxAt(1.3, 0.3, 1.9, c + k * 1.3, 0.2, 0, 0x1e2125));
  }
  dark.push(boxAt(L - 0.6, 0.05, 2.3, 0, 0.3, 0, 0x14161a)); // dessous
  // pantographes (modules 1 et n-2)
  for (const m of n >= 5 ? [1, n - 2] : [Math.floor(n / 2)]) {
    const px = -L / 2 + T.module / 2 + m * T.module;
    dark.push(boxAt(1.4, 0.08, 0.9, px, 3.44, 0, 0x2a2d31));
    for (const sx of [-1, 1]) dark.push(strut([px + sx * 0.7, 3.46, 0], [px, 4.1, 0], 0.03, 0x2a2d31));
    dark.push(boxAt(0.1, 0.06, 1.9, px, 4.12, 0, 0x2a2d31));
  }
  return { body: mergeParts(body), dark: mergeParts(dark) };
}

// ------------------------------------------------------------------ atlas de la livrée (1024 x 512) : flanc, nez, totem
let ATLAS = null;
function atlas() {
  if (ATLAS) return ATLAS;
  const draw = (x, emis) => {
    const rnd = mulberry(8128);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 512);
    const M = 1024 / LIVERY_M; // px par mètre le long de la rame
    // ---- flanc (moitié haute) : 7 modules
    if (!emis) {
      x.fillStyle = '#d9dde0'; x.fillRect(0, 0, 1024, 256);
      x.fillStyle = '#7b8189'; x.fillRect(0, 0, 1024, 9);                                         // arête de toit
      x.fillStyle = '#383c42'; x.fillRect(0, liveryY(0.66), 1024, 256 - liveryY(0.66));          // jupe
      x.fillStyle = '#8a9097'; x.fillRect(0, liveryY(0.84), 1024, liveryY(0.66) - liveryY(0.84)); // liseré
      x.fillStyle = '#3c424a'; x.fillRect(0, liveryY(2.52), 1024, liveryY(2.42) - liveryY(2.52)); // bandeau haut
    }
    for (let i = 0; i < 7; i++) {
      const X = i * HDF.tram.module;
      // bandeau vitré sombre (entre les portes) : 1,85..2,85 m du module
      if (!emis) {
        const g = x.createLinearGradient(0, liveryY(2.4), 0, liveryY(1.15)); g.addColorStop(0, '#202c38'); g.addColorStop(1, '#10161c');
        x.fillStyle = g; x.fillRect((X + 1.85) * M, liveryY(2.4), 1.0 * M, liveryY(1.15) - liveryY(2.4));
        x.fillStyle = 'rgba(140,170,190,0.14)'; x.beginPath(); x.moveTo((X + 1.95) * M, liveryY(2.4)); x.lineTo((X + 2.4) * M, liveryY(2.4)); x.lineTo((X + 2.1) * M, liveryY(1.15)); x.lineTo((X + 1.85) * M, liveryY(1.15)); x.fill();
      }
      // deux portes ouvertes : encadrement, vide sombre, éclairage intérieur, vantaux repliés
      for (const dx of [0.45, 2.95]) {
        const px = (X + dx) * M, pw = 1.3 * M, py = liveryY(2.35), ph = liveryY(0.45) - liveryY(2.35);
        if (!emis) {
          x.fillStyle = '#6b7279'; x.fillRect(px - 5, py - 5, pw + 10, ph + 5);
          x.fillStyle = '#07090b'; x.fillRect(px, py, pw, ph);
          x.fillStyle = '#c9ced2'; x.fillRect(px, py, 6, ph); x.fillRect(px + pw - 6, py, 6, ph);   // vantaux
          x.fillStyle = '#e8c04a'; x.fillRect(px, liveryY(0.5), pw, liveryY(0.45) - liveryY(0.5)); // marche jaune
        } else {
          const g = x.createLinearGradient(0, py, 0, py + ph); g.addColorStop(0, 'rgba(255,214,150,0.55)'); g.addColorStop(1, 'rgba(255,170,90,0.12)');
          x.fillStyle = g; x.fillRect(px + 8, py + 4, pw - 16, ph - 8);
        }
      }
    }
    // sang : coulures et éclaboussures autour des portes et sur le bas de caisse (tirage reproductible)
    if (!emis) {
      for (let k = 0; k < 46; k++) {
        const i = Math.floor(rnd() * 7), dx = rnd() < 0.5 ? 0.45 + rnd() * 1.3 : 2.95 + rnd() * 1.3;
        const px = (i * HDF.tram.module + dx) * M, py = liveryY(2.3 - rnd() * 1.7), a = 0.35 + rnd() * 0.4;
        x.fillStyle = `rgba(${95 + rnd() * 40 | 0},8,10,${a})`;
        x.beginPath(); x.ellipse(px, py, 3 + rnd() * 9, 2 + rnd() * 6, rnd() * 3, 0, 7); x.fill();
        if (rnd() < 0.6) x.fillRect(px - 1, py, 1.5 + rnd() * 2, 8 + rnd() * 36);
      }
      for (let k = 0; k < 220; k++) { x.fillStyle = `rgba(0,0,0,${rnd() * 0.07})`; x.fillRect(rnd() * 1024, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 9); } // saleté
    }
    // ---- nez (quart bas gauche) : repère physique en cm, 213,3 px/m en largeur, 73,14 px/m en hauteur
    x.save();
    x.beginPath(); x.rect(0, 256, 512, 256); x.clip();
    x.setTransform(2.133, 0, 0, 0.7314, 256, 512); // (Z cm, -Y cm)
    if (!emis) {
      x.fillStyle = '#d9dde0'; x.fillRect(-120, -350, 240, 350);
      x.fillStyle = '#383c42'; x.fillRect(-120, -60, 240, 60);
      x.fillStyle = '#7b8189'; x.fillRect(-120, -88, 240, 12);
      const g = x.createLinearGradient(0, -295, 0, -130); g.addColorStop(0, '#202b36'); g.addColorStop(1, '#0d1217');
      x.fillStyle = g; x.beginPath(); x.moveTo(-100, -130); x.lineTo(-92, -285); x.lineTo(92, -285); x.lineTo(100, -130); x.closePath(); x.fill();
      x.fillStyle = 'rgba(150,180,200,0.12)'; x.beginPath(); x.moveTo(-70, -285); x.lineTo(-20, -285); x.lineTo(-60, -130); x.lineTo(-100, -130); x.fill();
      x.fillStyle = '#0a0c0e'; x.fillRect(-85, -330, 170, 30);                                  // girouette
      for (const s of [-1, 1]) { x.fillStyle = '#d8d2b0'; x.fillRect(s * 85 - 15, -88 + 18, 30, 12); } // phares
      for (let k = 0; k < 14; k++) { x.fillStyle = `rgba(110,10,12,${0.3 + rnd() * 0.4})`; x.beginPath(); x.ellipse(-90 + rnd() * 180, -60 - rnd() * 200, 3 + rnd() * 10, 2 + rnd() * 8, rnd() * 3, 0, 7); x.fill(); }
    }
    x.font = 'bold 15px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = emis ? '#ffb22e' : '#ff9d1a';
    x.fillText('HOMME DE FER', 0, -315);
    if (emis) { for (const s of [-1, 1]) { x.fillStyle = 'rgba(255,240,200,0.25)'; x.fillRect(s * 85 - 15, -70, 30, 12); } }
    x.restore();
    // ---- totem (quart bas droit) : 40 cm de large, 2,80 m de haut ; la texture est couchée (x = hauteur, y = largeur)
    x.save();
    x.beginPath(); x.rect(512, 256, 512, 256); x.clip();
    x.setTransform(0, -6.4, 1.829, 0, 512, 512); // (X cm de largeur, Y cm de hauteur) -> pixels
    if (!emis) {
      x.fillStyle = '#26323f'; x.fillRect(0, 0, 40, 280);
      x.fillStyle = '#1a232d'; x.fillRect(0, 0, 40, 22);
      x.fillStyle = '#e9eef2'; x.fillRect(18, 22, 4, 130);                                  // liseré clair
    }
    // panneau lumineux du nom ; le repère est « Y vers le haut » : le texte est retourné pour rester à l'endroit
    const tx = (text, px, py) => { x.save(); x.translate(px, py); x.scale(1, -1); x.fillText(text, 0, 0); x.restore(); };
    x.fillStyle = emis ? 'rgba(255,255,255,0.55)' : '#eef2f5'; x.fillRect(3, 208, 34, 66);
    x.fillStyle = '#12161a'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 8.6px Arial';
    if (emis) x.fillStyle = '#000'; // le texte ne s'éclaire pas
    tx('HOMME', 20, 258); tx('DE FER', 20, 242); x.fillRect(6, 227, 28, 1.4); x.font = 'bold 6px Arial'; tx('TRAM', 20, 218);
    // pastilles des lignes (couleurs neutres : les teintes officielles ne sont pas reprises)
    [['A', 8, 195], ['B', 20, 195], ['C', 32, 195], ['D', 14, 181], ['F', 26, 181]].forEach(([l, px, py]) => {
      x.fillStyle = emis ? 'rgba(255,255,255,0.2)' : '#39414a'; x.beginPath(); x.arc(px, py, 5.2, 0, 7); x.fill();
      x.fillStyle = emis ? '#000' : '#fff'; x.font = 'bold 6.6px Arial'; tx(l, px, py + 0.4);
    });
    x.restore();
  };
  const mk = (emis) => canvasTex(1024, 512, (x) => draw(x, emis));
  ATLAS = { map: mk(false), emissive: mk(true) };
  ATLAS.mat = new THREE.MeshStandardMaterial({ map: ATLAS.map, emissiveMap: ATLAS.emissive, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.55, metalness: 0.2 });
  return ATLAS;
}

// Totem : boîte 0,4 x 2,8 x 0,15 m ; UV vers la zone « totem » de l'atlas (face avant ET arrière, texte à l'endroit des deux côtés)
function totemGeometry() {
  const g = new THREE.BoxGeometry(0.4, 2.8, 0.15);
  const p = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const nz = nrm.getZ(i), x = p.getX(i), y = p.getY(i);
    if (Math.abs(nz) > 0.5) { const wx = nz > 0 ? x : -x; uv.setXY(i, 0.5 + 0.5 * ((y + 1.4) / 2.8), 0.5 * ((wx + 0.2) / 0.4)); }
    else uv.setXY(i, 0.99, 0.01); // tranches : couleur du fond
  }
  g.translate(0, 1.4, 0);
  return g;
}

// ====================================================================================================================
//  Décor : rails, quais, rames, totems, statue
// ====================================================================================================================
const SIDE_SAMPLE = 1.5; // pas d'échantillonnage le long d'une rame (m)

// ctx : { scene, collision, lightSources, plan, zi (indice de la zone), zoneOf(x, z), doorDist(x, z), used [[x, z]...] (déjà posés),
//         obstacles [[x, z]...] (mobilier OSM à ne pas écraser), columns [[x, z]...] }
export function buildHdfDecor(ctx) {
  const { scene, collision, lightSources, plan, zi, zoneOf, doorDist } = ctx;
  const { cx, cz } = plan, T = HDF.tram, R = HDF.rail, M = mats();
  const used = ctx.used, cols = ctx.columns || [];
  const statueX = HDF.statue.x + HDF.statue.nx * HDF.statue.offset, statueZ = HDF.statue.z + HDF.statue.nz * HDF.statue.offset;
  const info = { axes: plan.axes.map((a) => ({ deg: a.deg })), trams: [], totems: [], statue: null };
  const steel = [];  // pièces d'acier / dallage (sommets colorés)

  const ax = plan.axes.map((a) => ({ ...a, reachF: Math.min(R.reach, a.f - 2), reachB: Math.min(R.reach, a.b - 2) }));

  // ---- rails : deux rails par axe (bandes d'acier, InstancedMesh) sur un lit sombre (aucun effet sur floorAt)
  {
    const railGeo = colorize(new THREE.BoxGeometry(1, 0.13, 0.07), 0xaab2ba);
    const rails = new THREE.InstancedMesh(railGeo, M.steel, ax.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (const a of ax) {
      const len = a.reachF + a.reachB, mid = (a.reachF - a.reachB) / 2, ang = Math.atan2(a.uz, a.ux);
      q.setFromAxisAngle(up, -ang);
      for (const s of [-1, 1]) {
        m4.compose(new THREE.Vector3(cx + a.ux * mid - a.uz * s * (R.gauge / 2), 0.065, cz + a.uz * mid + a.ux * s * (R.gauge / 2)), q, new THREE.Vector3(len, 1, 1));
        rails.setMatrixAt(k++, m4);
      }
      steel.push(boxAt(len, 0.03, R.bed, cx + a.ux * mid, 0.015, cz + a.uz * mid, 0x303133, -ang));
    }
    rails.frustumCulled = false; rails.instanceMatrix.needsUpdate = true; rails.receiveShadow = true;
    rails.name = 'hdf:rails'; scene.add(rails);
  }

  // ---- rames : 33 m (7 modules), sinon 14 m (3 modules), sinon abandon
  const lateralFree = (px, pz, dx, dz) => { // distance libre à partir d'un point, en ignorant les colonnes de la rotonde
    let d0 = 0;
    for (let k = 0; k < 4; k++) {
      const d = collision.rayHit(px + dx * d0, 1, pz + dz * d0, dx, 0, dz, 3.4 - d0);
      if (d0 + d >= 3.4 - 1e-3) return 3.4;
      const hx = px + dx * (d0 + d), hz = pz + dz * (d0 + d);
      if (cols.some(([qx, qz]) => Math.hypot(qx - hx, qz - hz) < 0.6)) { d0 += d + 0.5; continue; }
      return d0 + d;
    }
    return 3.4;
  };
  const tryTram = (a, sign, s0, L) => {
    const dx = sign * a.ux, dz = sign * a.uz, px = -dz, pz = dx;
    const free = sign > 0 ? a.f : a.b;
    if (s0 + L + 0.8 > free) return null;
    let minL = 9, minR = 9;
    const steps = Math.ceil(L / SIDE_SAMPLE);
    for (let k = 0; k <= steps; k++) {
      const s = s0 + (L * k) / steps, x = cx + dx * s, z = cz + dz * s;
      if (zoneOf(x, z) !== zi || zoneOf(x + px * 1.3, z + pz * 1.3) !== zi || zoneOf(x - px * 1.3, z - pz * 1.3) !== zi) return null;
      if (doorDist(x, z) < 8) return null;
      if (used.some(([ux, uz]) => Math.hypot(ux - x, uz - z) < 3.5)) return null;
      if (Math.hypot(x - statueX, z - statueZ) < 9) return null; // la rame ne doit pas masquer la statue
      const l = lateralFree(x, z, px, pz), r = lateralFree(x, z, -px, -pz);
      if (l < T.width / 2 + T.side || r < T.width / 2 + T.side) return null;
      minL = Math.min(minL, l); minR = Math.min(minR, r);
    }
    const ex = cx + dx * (s0 + L), ez = cz + dz * (s0 + L);
    if (collision.rayHit(ex, 1, ez, dx, 0, dz, 0.8) < 0.7) return null;
    for (const [ox, oz] of ctx.obstacles || []) { // mobilier OSM (bornes, bancs…) dans l'emprise
      const s = (ox - cx) * dx + (oz - cz) * dz, lat = (ox - cx) * px + (oz - cz) * pz;
      if (s > s0 - 0.5 && s < s0 + L + 0.5 && Math.abs(lat) < T.width / 2 + 0.6) return null;
    }
    return { axis: a, sign, s0, L, dx, dz, px, pz, minL, minR, modules: Math.round(L / T.module) };
  };
  const placements = [];
  for (const a of ax) {
    let found = null;
    for (const mods of [7, 3]) {
      const L = mods * T.module;
      for (let s0 = T.minReach; s0 + L <= T.maxReach + 1e-6 && !found; s0 += 1) for (const sign of [1, -1]) { found = tryTram(a, sign, s0, L); if (found) break; }
      if (found) break;
    }
    if (found) placements.push(found);
  }

  // géométries des rames : une pour chaque longueur ; copies placées dans le monde puis fusionnées (2 maillages en tout)
  const bodies = [], darks = [], geoCache = {};
  for (const t of placements) {
    const g = geoCache[t.modules] || (geoCache[t.modules] = tramGeometries(t.modules));
    const theta = Math.atan2(-t.dz, t.dx), sc = t.s0 + t.L / 2;
    const place = (geo) => { const c = geo.clone(); c.rotateY(theta); c.translate(cx + t.dx * sc, 0, cz + t.dz * sc); return c; };
    bodies.push(place(g.body)); darks.push(place(g.dark));
    // collision : une boîte orientée par module
    for (let i = 0; i < t.modules; i++) {
      const s = t.s0 + T.module / 2 + i * T.module;
      collision.addBox(cx + t.dx * s, cz + t.dz * s, T.body, T.width, Math.atan2(t.dz, t.dx), T.height);
    }
    // quais : dallage clair + ligne podotactile de chaque côté, au ras du sol, aussi larges que la rue le permet
    for (const side of [-1, 1]) {
      const free = side > 0 ? t.minL : t.minR, w = Math.min(2.6, free - 0.2 - (T.width / 2 + 0.25));
      if (w < 0.9) continue;
      const lat = T.width / 2 + 0.25 + w / 2, sMid = t.s0 + t.L / 2;
      const bx = cx + t.dx * sMid + t.px * side * lat, bz = cz + t.dz * sMid + t.pz * side * lat, ang = -Math.atan2(t.dz, t.dx);
      steel.push(boxAt(t.L + 2, 0.05, w, bx, 0.025, bz, 0xa9a8a0, ang));
      const ex = cx + t.dx * sMid + t.px * side * (T.width / 2 + 0.25 + 0.2);
      const ez = cz + t.dz * sMid + t.pz * side * (T.width / 2 + 0.25 + 0.2);
      steel.push(boxAt(t.L + 2, 0.058, 0.4, ex, 0.029, ez, 0xc9a93a, ang));
      t['w' + side] = { w, lat };
    }
    used.push(...[0, 0.25, 0.5, 0.75, 1].map((f) => [cx + t.dx * (t.s0 + t.L * f), cz + t.dz * (t.s0 + t.L * f)]));
    info.trams.push({ deg: t.axis.deg, sign: t.sign, s0: t.s0, L: t.L, modules: t.modules, x: cx + t.dx * sc, z: cz + t.dz * sc });
  }
  if (bodies.length) {
    const a = atlas();
    meshOf(scene, mergeParts(bodies), a.mat, { shadow: true, receive: true, name: 'tram-body' });
    meshOf(scene, mergeParts(darks), M.steel, { shadow: true, receive: true, name: 'tram-dark' });
  }

  // ---- totems « HOMME DE FER » : 2, sur le quai des rames (sinon près des rails)
  {
    const tg = totemGeometry();
    const list = [];
    const spots = placements.map((t) => {
      const side = (t.w1 && (!t['w-1'] || t.w1.w >= t['w-1'].w)) ? 1 : (t['w-1'] ? -1 : 0);
      if (!side) return null;
      const W = t['w' + side], s = t.s0 + t.L * 0.3, lat = T.width / 2 + 0.25 + W.w - 0.3;
      return { x: cx + t.dx * s + t.px * side * lat, z: cz + t.dz * s + t.pz * side * lat, dx: t.dx, dz: t.dz };
    }).filter(Boolean);
    for (const a of ax) { // complète avec des totems au bord des rails (côté de l'axe le plus dégagé)
      if (spots.length >= 2) break;
      for (const side of [1, -1]) {
        if (spots.length >= 2) break;
        const dx = a.ux, dz = a.uz, px = -dz, pz = dx;
        for (const s of [20, 24, 28]) {
          const x = cx + dx * s + px * side * 2.6, z = cz + dz * s + pz * side * 2.6;
          if (zoneOf(x, z) === zi && collision.rayHit(x, 1, z, px * side, 0, pz * side, 1.2) >= 1.2 && collision.rayHit(x, 1, z, dx, 0, dz, 1.2) >= 1.2 && used.every(([ux, uz]) => Math.hypot(ux - x, uz - z) > 3)) { spots.push({ x, z, dx, dz }); break; }
        }
      }
    }
    for (const sp of spots.slice(0, 2)) {
      const g = tg.clone();
      g.rotateY(Math.atan2(-sp.dz, sp.dx)); g.translate(sp.x, 0, sp.z);
      list.push(g);
      collision.addBox(sp.x, sp.z, 0.4, 0.15, Math.atan2(sp.dz, sp.dx), 2.8);
      used.push([sp.x, sp.z]);
      info.totems.push({ x: sp.x, z: sp.z });
    }
    if (list.length) meshOf(scene, mergeParts(list), atlas().mat, { shadow: true, name: 'totems' });
  }

  // ---- statue de l'Homme de Fer : hallebardier sur une console, à l'angle sud-ouest de la façade ouest
  {
    const S = HDF.statue, ang = Math.atan2(S.nx, S.nz);
    const px = S.x + S.nx * S.offset, pz = S.z + S.nz * S.offset;
    const { iron, brass } = halberdierGeometries();
    for (const g of [iron, brass]) {
      const mesh = meshOf(scene, g, g === iron ? M.iron : M.brass, { shadow: true, receive: true, name: g === iron ? 'statue-iron' : 'statue-brass' });
      mesh.position.set(px, S.consoleTop, pz); mesh.rotation.y = ang; mesh.scale.setScalar(S.scale);
    }
    // console (0,8 x 0,25 x 0,6 m) et corbeau de pierre en dessous
    const stone = 0x7a6b5b, cons = new THREE.BoxGeometry(0.8, 0.25, 0.6); cons.translate(0, S.consoleTop - 0.125, 0);
    const corbel = new THREE.CylinderGeometry(0.34, 0.12, 0.26, 4); corbel.rotateY(Math.PI / 4); corbel.translate(0, S.consoleTop - 0.38, 0);
    for (const g of [cons, corbel]) { g.rotateY(ang); g.translate(px, 0, pz); steel.push(colorize(g, stone)); }
    lightSources.push({ x: px + S.nx * 1.6, y: 3.4, z: pz + S.nz * 1.6, color: 0xffc890, intensity: 10, dist: 10 });
    info.statue = { x: px, z: pz, top: S.consoleTop + 2.55 * S.scale };
  }

  if (steel.length) meshOf(scene, mergeParts(steel), M.steel, { receive: true, name: 'decor-steel' });

  // zone occupée par le décor (rails, rames et quais, statue) : le mobilier OSM n'y est pas posé
  info.covers = (x, z) => {
    for (const a of ax) {
      const s = (x - cx) * a.ux + (z - cz) * a.uz, lat = -(x - cx) * a.uz + (z - cz) * a.ux;
      if (s > -a.reachB && s < a.reachF && Math.abs(lat) < R.bed / 2 + 0.2) return true;
    }
    for (const t of placements) {
      const s = (x - cx) * t.dx + (z - cz) * t.dz, lat = (x - cx) * t.px + (z - cz) * t.pz;
      if (s > t.s0 - 1.5 && s < t.s0 + t.L + 1.5 && Math.abs(lat) < T.width / 2 + 4.3) return true;
    }
    return Math.hypot(x - info.statue.x, z - info.statue.z) < 3;
  };
  return info;
}
